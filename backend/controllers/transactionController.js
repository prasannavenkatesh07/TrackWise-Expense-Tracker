/**
 * controllers/transactionController.js
 *
 * Transaction Controller — Phase A + AI Quick Add implementation.
 *
 * Route map:
 * GET    /api/transactions               → getAllTransactions  (filter / pagination / date range)
 * POST   /api/transactions               → createTransaction   (supports isRecurring)
 * PUT    /api/transactions/:id           → editTransaction     (Phase A)
 * DELETE /api/transactions/:id           → deleteTransaction
 * GET    /api/transactions/summary       → getSummary          (date-range aware)
 * GET    /api/transactions/insights      → getInsights         (locked to current month)
 * GET    /api/transactions/export        → exportCSV
 * GET    /api/transactions/titles        → getTitleSuggestions (Phase A — autocomplete)
 * GET    /api/transactions/monthly       → getMonthlyTrend     (Phase A — reports)
 * POST   /api/transactions/quick-add     → parseQuickAdd       (AI Quick Add — Gemini NLP)
 * GET    /api/transactions/ai-report     → generateAIReport    (Sprint 2 — Gemini monthly report)
 * POST   /api/transactions/scan-receipt  → parseReceiptImage   (Sprint 3 — Gemini vision OCR)
 *
 * ALL routes are PROTECTED — req.user is injected by authMiddleware.protect.
 */

const { validationResult } = require("express-validator");
const { GoogleGenAI } = require("@google/genai");
const Transaction = require("../models/Transaction");
const { TRANSACTION_CATEGORIES } = Transaction;

// ─── Gemini Client — lazy singleton ───────────────────────────────────────────
// Initialised on first AI request rather than at module load so that a missing
// GEMINI_API_KEY only breaks the AI endpoints, not the entire transaction router.
let _genai = null;
const getGenAI = () => {
  if (!process.env.GEMINI_API_KEY)
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  return (_genai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
};

// ─── extractAndParseJSON ───────────────────────────────────────────────────────
/**
 * Robustly extracts and parses a JSON object from a raw Gemini text response.
 *
 * Even with `responseMimeType: "application/json"` + `responseSchema`,
 * gemini-2.5-flash occasionally:
 *   - wraps the JSON in ```json ... ``` or ``` ... ``` code fences
 *   - prefixes/suffixes the JSON with conversational text ("Sure! Here's...")
 *   - adds trailing commentary after the closing brace
 *
 * This function defends against all of the above before calling JSON.parse.
 *
 * @param {string} rawText - The raw text returned by Gemini.
 * @returns {object} The parsed JSON object.
 * @throws {Error} If no valid JSON object can be extracted/parsed.
 */
const extractAndParseJSON = (rawText) => {
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new Error("extractAndParseJSON: empty or non-string input.");
  }

  // 1. Forcefully strip markdown code fences (```json ... ``` or ``` ... ```),
  //    wherever they appear — not just at the very start/end.
  let cleaned = rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // 2. Slice to the substring starting at the first "{". If a matching final
  //    "}" exists, slice up to (and including) it — but if the response was
  //    cut off mid-stream (e.g. hit maxOutputTokens) there may be NO closing
  //    "}" at all, so don't bail out yet; fall through to the repair step below.
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1) {
    throw new Error(
      `extractAndParseJSON: no JSON object found in response. Raw: ${rawText}`,
    );
  }

  const lastBrace = cleaned.lastIndexOf("}");
  cleaned =
    lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned.slice(firstBrace);

  // 3. Safe JSON.parse
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // 4. Repair fallback — the response may have been truncated mid-JSON
    //    (e.g. hit maxOutputTokens while writing a long string/array value).
    //    Attempt to close any open strings/brackets and re-parse before
    //    giving up entirely.
    try {
      return JSON.parse(repairTruncatedJSON(cleaned));
    } catch (repairErr) {
      throw new Error(
        `extractAndParseJSON: JSON.parse failed after cleaning and repair attempt. Cleaned: ${cleaned} | Original error: ${err.message} | Repair error: ${repairErr.message}`,
      );
    }
  }
};

// ─── repairTruncatedJSON ────────────────────────────────────────────────────────
/**
 * Best-effort repair for a JSON string that was cut off mid-stream (most
 * commonly because the model hit `maxOutputTokens` while still writing a
 * string value or an array/object of items).
 *
 * Strategy:
 *  - If we're inside an unterminated string literal, close the quote.
 *  - Strip any trailing dangling comma.
 *  - Append the correct closing brackets/braces to balance what's open,
 *    based on a simple stack walk of the original (unrepaired) string.
 *
 * This is intentionally conservative — it only ever appends characters,
 * never removes/rewrites content — so a successfully-parsed result still
 * faithfully reflects everything the model actually produced.
 *
 * @param {string} str - The cleaned (but possibly truncated) JSON string.
 * @returns {string} A string with appended closing characters, ready for
 *                    another JSON.parse attempt.
 */
const repairTruncatedJSON = (str) => {
  let result = str;
  const stack = [];
  let inString = false;
  let escapeNext = false;

  for (const char of result) {
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") stack.pop();
  }

  // If the response was cut off mid-string-literal, close the quote first.
  if (inString) result += '"';

  // Remove a trailing comma (with optional whitespace) that would otherwise
  // produce invalid JSON once we append closing brackets — e.g.
  // `"actionItems": ["one", "two",` → `"actionItems": ["one", "two"`.
  result = result.replace(/,\s*$/, "");

  // Close any still-open brackets/braces, innermost-first.
  for (let i = stack.length - 1; i >= 0; i--) {
    result += stack[i] === "{" ? "}" : "]";
  }

  return result;
};

// ─── extractGeminiText ──────────────────────────────────────────────────────────
/**
 * Safely extracts the text payload from a @google/genai response object.
 *
 * The new SDK exposes `response.text` as a convenience getter, but falls back
 * to the raw candidates path for older/edge-case response shapes.
 *
 * @param {object} response - The response object from `models.generateContent`.
 * @returns {string|undefined} The extracted text, or undefined if not present.
 */
const extractGeminiText = (response) => {
  if (typeof response?.text === "string" && response.text.length > 0) {
    return response.text;
  }
  return response?.candidates?.[0]?.content?.parts?.[0]?.text;
};

// ─── GET /api/transactions ────────────────────────────────────────────────────
const getAllTransactions = async (req, res, next) => {
  try {
    const filter = { user_id: req.user._id };

    if (req.query.type && ["Income", "Expense"].includes(req.query.type))
      filter.type = req.query.type;

    if (
      req.query.category &&
      TRANSACTION_CATEGORIES.includes(req.query.category)
    )
      filter.category = req.query.category;

    if (req.query.search && req.query.search.trim())
      filter.title = { $regex: req.query.search.trim(), $options: "i" };

    // Date range — History page date picker: ?from=YYYY-MM-DD&to=YYYY-MM-DD
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) {
        const to = new Date(req.query.to);
        to.setHours(23, 59, 59, 999);
        filter.date.$lte = to;
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const [transactions, totalCount] = await Promise.all([
      Transaction.find(filter)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      count: transactions.length,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      data: transactions,
    });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/transactions ───────────────────────────────────────────────────
const createTransaction = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
        errors: errors.array(),
      });

    const {
      title,
      amount,
      type,
      category,
      date,
      notes,
      isRecurring,
      recurringFrequency,
    } = req.body;

    if (isRecurring && !recurringFrequency)
      return res.status(400).json({
        success: false,
        message: "Recurring frequency is required when isRecurring is true.",
      });

    const transaction = await Transaction.create({
      title,
      amount,
      type,
      category,
      date: date || Date.now(),
      notes: notes || "",
      user_id: req.user._id, // From JWT — never from body
      isRecurring: !!isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : null,
      lastGeneratedAt: isRecurring ? new Date() : null,
    });

    res.status(201).json({
      success: true,
      message: "Transaction added successfully.",
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

// ─── PUT /api/transactions/:id  (Phase A) ─────────────────────────────────────
const editTransaction = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
        errors: errors.array(),
      });

    const {
      title,
      amount,
      type,
      category,
      date,
      notes,
      isRecurring,
      recurringFrequency,
    } = req.body;

    if (isRecurring && !recurringFrequency)
      return res.status(400).json({
        success: false,
        message: "Recurring frequency is required when isRecurring is true.",
      });

    // Build partial update — only include fields that were actually sent
    const upd = {};
    if (title !== undefined) upd.title = title;
    if (amount !== undefined) upd.amount = Number(amount);
    if (type !== undefined) upd.type = type;
    if (category !== undefined) upd.category = category;
    if (date !== undefined) upd.date = new Date(date);
    if (notes !== undefined) upd.notes = notes;
    if (isRecurring !== undefined) {
      upd.isRecurring = !!isRecurring;
      upd.recurringFrequency = isRecurring ? recurringFrequency : null;
    }

    const transaction = await Transaction.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id },
      { $set: upd },
      { new: true, runValidators: true },
    );

    if (!transaction)
      return res.status(404).json({
        success: false,
        message: "Transaction not found or you are not authorised to edit it.",
      });

    res.status(200).json({
      success: true,
      message: "Transaction updated successfully.",
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

// ─── DELETE /api/transactions/:id ─────────────────────────────────────────────
const deleteTransaction = async (req, res, next) => {
  try {
    const transaction = await Transaction.findOneAndDelete({
      _id: req.params.id,
      user_id: req.user._id,
    });

    if (!transaction)
      return res.status(404).json({
        success: false,
        message:
          "Transaction not found or you are not authorised to delete it.",
      });

    res.status(200).json({
      success: true,
      message: "Transaction deleted successfully.",
      data: { _id: transaction._id },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/transactions/summary ───────────────────────────────────────────
const getSummary = async (req, res, next) => {
  try {
    const options = {};
    if (req.query.from) options.from = req.query.from;
    if (req.query.to) options.to = req.query.to;

    const [summary, categoryBreakdown] = await Promise.all([
      Transaction.getSummaryForUser(req.user._id, options),
      Transaction.getCategoryBreakdownForUser(req.user._id, options),
    ]);

    const monthlyBudget = req.user.monthlyBudget || 50000;
    const budgetUsedPercent =
      monthlyBudget > 0
        ? Math.min(
            100,
            parseFloat(
              ((summary.totalExpense / monthlyBudget) * 100).toFixed(1),
            ),
          )
        : 0;

    res.status(200).json({
      success: true,
      data: { ...summary, monthlyBudget, budgetUsedPercent, categoryBreakdown },
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/transactions/insights ──────────────────────────────────────────
const getInsights = async (req, res, next) => {
  try {
    // ✦ Fix: Insights should always evaluate the CURRENT month's budget health
    const now = new Date();
    const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    const options = { from: fromDate.toISOString(), to: toDate.toISOString() };

    const [summary, breakdown] = await Promise.all([
      Transaction.getSummaryForUser(req.user._id, options),
      Transaction.getCategoryBreakdownForUser(req.user._id, options),
    ]);

    const insights = [];

    // Rule 1 — Food & Groceries > 40% of total expenses
    const food = breakdown.find((c) => c.category === "Food & Groceries");
    if (food && summary.totalExpense > 0) {
      const pct = (food.total / summary.totalExpense) * 100;
      if (pct > 40)
        insights.push({
          type: "warning",
          code: "FOOD_OVERSPEND",
          message: `⚠️ Food & Groceries is ${pct.toFixed(1)}% of your expenses — consider cutting dining out.`,
        });
    }

    // Rule 2 — Savings rate ≥ 20%
    if (summary.totalIncome > 0 && summary.totalExpense > 0) {
      const rate =
        ((summary.totalIncome - summary.totalExpense) / summary.totalIncome) *
        100;
      if (rate >= 20)
        insights.push({
          type: "success",
          code: "GOOD_SAVINGS",
          message: `🎉 You're saving ${rate.toFixed(1)}% of your income — great discipline!`,
        });
    }

    // Rule 3 — Budget exceeded
    const budget = req.user.monthlyBudget || 50000;
    if (summary.totalExpense > budget)
      insights.push({
        type: "danger",
        code: "BUDGET_EXCEEDED",
        message: `🚨 Monthly budget of ₹${budget.toLocaleString("en-IN")} exceeded by ₹${(summary.totalExpense - budget).toLocaleString("en-IN")}.`,
      });

    res.status(200).json({ success: true, data: { insights, summary } });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/transactions/export ────────────────────────────────────────────
const exportCSV = async (req, res, next) => {
  try {
    const transactions = await Transaction.find({ user_id: req.user._id })
      .sort({ date: -1 })
      .lean();

    if (transactions.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "No transactions to export." });

    const headers = [
      "Date",
      "Title",
      "Category",
      "Type",
      "Amount (₹)",
      "Notes",
      "Recurring",
      "Frequency",
      "Auto-Generated",
    ];

    const rows = transactions.map((t) =>
      [
        new Date(t.date).toLocaleDateString("en-IN"),
        `"${t.title.replace(/"/g, '""')}"`,
        t.category,
        t.type,
        t.amount,
        `"${(t.notes || "").replace(/"/g, '""')}"`,
        t.isRecurring ? "Yes" : "No",
        t.recurringFrequency || "",
        t.isGeneratedCopy ? "Yes" : "No",
      ].join(","),
    );

    const csv = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="trackwise_export_${Date.now()}.csv"`,
    );
    res.status(200).send(csv);
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/transactions/titles  (Phase A — autocomplete) ──────────────────
const getTitleSuggestions = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1)
      return res.status(200).json({ success: true, data: [] });

    const suggestions = await Transaction.getTitleSuggestions(
      req.user._id,
      q.trim(),
      8,
    );
    res.status(200).json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/transactions/monthly  (Phase A — reports charts) ───────────────
const getMonthlyTrend = async (req, res, next) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months) || 6));
    const trend = await Transaction.getMonthlyTrend(req.user._id, months);
    res.status(200).json({ success: true, months, data: trend });
  } catch (error) {
    next(error);
  }
};

// ─── POST /api/transactions/quick-add  (AI Quick Add — Gemini NLP) ────────────
/**
 * Accepts a natural language sentence from the user and uses Gemini to
 * parse it into a structured transaction object ready to auto-fill the form.
 *
 * Request body:
 *   { text: "I bought groceries at Spar for 1200 rupees today" }
 *
 * Response:
 *   {
 *     success: true,
 *     data: {
 *       title:    "Groceries at Spar",
 *       amount:   1200,
 *       type:     "Expense",
 *       category: "Food & Groceries",
 *       date:     "2025-07-14"
 *     }
 *   }
 */
const parseQuickAdd = async (req, res, next) => {
  try {
    const { text } = req.body;

    // ── Basic input validation ───────────────────────────────────────────────
    if (!text || typeof text !== "string" || text.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide a sentence describing your transaction (min 3 characters).",
      });
    }

    if (text.trim().length > 500) {
      return res.status(400).json({
        success: false,
        message:
          "Input too long. Please keep your description under 500 characters.",
      });
    }

    // ── Build today's date string for the prompt ─────────────────────────────
    const todayISO = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // ── Strict Gemini system prompt ──────────────────────────────────────────
    const systemPrompt = `You are a financial transaction parser for an Indian personal finance app called TrackWise. 
Your ONLY job is to extract structured transaction data from a natural language sentence and return it as a single valid JSON object with NO markdown, NO code fences, NO explanation text whatsoever — just raw JSON.

TODAY'S DATE: ${todayISO}

EXTRACTION RULES (follow these exactly, no exceptions):
1. "title": A concise description of the transaction in MAXIMUM 5 words. Capitalise the first word only. Remove filler words like "I bought", "I paid", "I spent". Example: "I bought groceries at Spar" → "Groceries at Spar".
2. "amount": A positive number ONLY (no currency symbols, no commas). Extract the numeric value from words like "1200 rupees", "₹500", "five hundred rupees" (→ 500), "2k" (→ 2000). If no amount is found, use null.
3. "type": MUST be exactly "Income" or "Expense". Purchases, bills, payments, spending = "Expense". Salary, received, earned, credited, got paid = "Income". Default to "Expense" if unclear.
4. "category": MUST be EXACTLY one of these strings (case-sensitive, match precisely):
   - "Housing"          → rent, mortgage, home maintenance, furniture
   - "Food & Groceries" → groceries, restaurant, food, dining, eating, snacks, supermarket
   - "Transport"        → petrol, fuel, Uber, Ola, auto, bus, train, metro, cab, taxi, flight, parking
   - "Utilities"        → electricity, water, internet, mobile bill, gas, broadband, recharge
   - "Entertainment"    → movies, Netflix, Spotify, games, concert, sports, subscription, Amazon Prime
   - "Healthcare"       → doctor, hospital, pharmacy, medicine, lab test, gym, fitness
   - "Salary"           → salary, wages, freelance income, bonus, stipend, paycheck
   - "Other"            → anything that does not clearly fit the above categories
5. "date": In YYYY-MM-DD format. "today" or no date mentioned = ${todayISO}. "yesterday" = subtract 1 day from today. Named days/months should be resolved relative to today's date. If the year is ambiguous, use the current year.

OUTPUT FORMAT — Return ONLY this JSON object, nothing else:
{"title":"string","amount":number_or_null,"type":"Income_or_Expense","category":"exact_enum_string","date":"YYYY-MM-DD"}`;

    // ── Call Gemini 2.5 Flash ────────────────────────────────────────────────
    const model = getGenAI().models;
    const response = await model.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [{ text: `Parse this transaction: "${text.trim()}"` }],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        // Keep temperature low for deterministic, structured output
        temperature: 0.1,
        maxOutputTokens: 256,
      },
    });

    // ── Extract raw text from Gemini response ────────────────────────────────
    const rawText = extractGeminiText(response);

    if (!rawText) {
      return res.status(502).json({
        success: false,
        message: "AI returned an empty response. Please try again.",
      });
    }

    // ── Robustly extract and parse JSON (strips code fences, slices to {...}) ─
    let parsed;
    try {
      parsed = extractAndParseJSON(rawText);
    } catch (err) {
      console.error(
        "[parseQuickAdd] extractAndParseJSON failed. Raw Gemini output:",
        rawText,
        "| Error:",
        err.message,
      );
      return res.status(422).json({
        success: false,
        message:
          "AI could not parse your sentence into a transaction. Try being more specific — e.g. 'Paid ₹500 for electricity bill today'.",
      });
    }

    // ── Validate and sanitise parsed fields ──────────────────────────────────
    const validCategories = [
      "Housing",
      "Food & Groceries",
      "Transport",
      "Utilities",
      "Entertainment",
      "Healthcare",
      "Salary",
      "Other",
    ];

    const title =
      typeof parsed.title === "string"
        ? parsed.title.trim().slice(0, 100)
        : null;

    const amount =
      typeof parsed.amount === "number" && parsed.amount > 0
        ? Math.round(parsed.amount * 100) / 100 // Round to 2 decimal places
        : null;

    const type = ["Income", "Expense"].includes(parsed.type)
      ? parsed.type
      : "Expense";

    const category = validCategories.includes(parsed.category)
      ? parsed.category
      : "Other";

    // Validate the date is a real date string
    const parsedDate = new Date(parsed.date);
    const date =
      parsed.date &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
      !isNaN(parsedDate.getTime())
        ? parsed.date
        : todayISO;

    // ── Guard: ensure we got at least a title or amount ─────────────────────
    if (!title && !amount) {
      return res.status(422).json({
        success: false,
        message:
          "Couldn't extract a title or amount from your input. Try again with more detail.",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Transaction parsed successfully. Please verify the fields before saving.",
      data: { title, amount, type, category, date },
    });
  } catch (error) {
    // Normalise status across @google/genai SDK error shapes
    const status =
      error?.status ?? error?.httpError?.status ?? error?.response?.status;
    if (status === 400 || status === 403) {
      return res.status(502).json({
        success: false,
        message: "AI service configuration error. Please contact support.",
      });
    }
    if (status === 429 || status === 503) {
      return res.status(429).json({
        success: false,
        message: "AI service is busy. Please wait a moment and try again.",
      });
    }
    next(error);
  }
};

// ─── GET /api/transactions/ai-report  (Sprint 2 — Gemini monthly report) ──────
/**
 * Pulls the authenticated user's current-month transaction data, feeds it to
 * Gemini 2.5 Flash, and returns a structured "Financial Roast & Report" JSON.
 *
 * Response shape:
 *   {
 *     success: true,
 *     month:   "June 2025",
 *     data: {
 *       score:       82,
 *       summary:     "You had a solid month overall…",
 *       roast:       "Your entertainment spend is basically a Netflix empire…",
 *       praise:      "Keeping housing under 30% of income? Rare discipline.",
 *       actionItems: ["Cut dining out by ₹2,000", "…", "…"]
 *     }
 *   }
 *
 * Returns 204 (no content) if the user has no transactions this month so the
 * frontend can show an empty-state prompt rather than a confusing AI error.
 */
const generateAIReport = async (req, res, next) => {
  try {
    // ── 1. Compute current-month date boundaries ─────────────────────────────
    const now = new Date();
    const fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    const options = {
      from: fromDate.toISOString(),
      to:   toDate.toISOString(),
    };

    // Human-readable month label for the response (e.g. "June 2025")
    const monthLabel = now.toLocaleString("en-IN", {
      month: "long",
      year:  "numeric",
    });

    // ── 2. Fetch summary + category breakdown in parallel ────────────────────
    const [summary, breakdown] = await Promise.all([
      Transaction.getSummaryForUser(req.user._id, options),
      Transaction.getCategoryBreakdownForUser(req.user._id, options),
    ]);

    // ── 3. Guard: no data this month → skip AI call, return 204 ─────────────
    if (summary.totalIncome === 0 && summary.totalExpense === 0) {
      return res.status(204).send();
    }

    // ── 4. Grab the user's monthly budget ───────────────────────────────────
    const monthlyBudget = req.user.monthlyBudget || 50000;
    const budgetStatus =
      summary.totalExpense > monthlyBudget ? "EXCEEDED" : "WITHIN";
    const budgetDelta = Math.abs(summary.totalExpense - monthlyBudget);

    // ── 5. Format category breakdown as a readable string for the prompt ─────
    //    e.g. "Food & Groceries: ₹8200 (38.4%), Transport: ₹3100 (14.5%), …"
    const breakdownStr =
      breakdown.length > 0
        ? breakdown
            .map((c) => {
              const pct =
                summary.totalExpense > 0
                  ? ((c.total / summary.totalExpense) * 100).toFixed(1)
                  : "0.0";
              return `${c.category}: ₹${c.total.toLocaleString("en-IN")} (${pct}%)`;
            })
            .join(", ")
        : "No expense categories recorded.";

    // ── 6. Build the data context string injected into the Gemini prompt ─────
    const financialContext = [
      `Month: ${monthLabel}`,
      `Total Income:  ₹${summary.totalIncome.toLocaleString("en-IN")}`,
      `Total Expense: ₹${summary.totalExpense.toLocaleString("en-IN")}`,
      `Net Balance:   ₹${summary.balance.toLocaleString("en-IN")}`,
      `Monthly Budget: ₹${monthlyBudget.toLocaleString("en-IN")} — ${budgetStatus} by ₹${budgetDelta.toLocaleString("en-IN")}`,
      `Savings Rate: ${summary.totalIncome > 0 ? (((summary.totalIncome - summary.totalExpense) / summary.totalIncome) * 100).toFixed(1) : "0.0"}%`,
      `Expense Breakdown: ${breakdownStr}`,
    ].join("\n");

    // ── 7. Strict Gemini system prompt ───────────────────────────────────────
    const systemPrompt = `You are a witty, sharp, and expert financial advisor for TrackWise, an Indian personal finance app. Your clients are salaried professionals in India. All monetary values are in Indian Rupees (₹).

You will be given one month of a user's real financial data. Analyse it carefully and return ONLY a single valid JSON object — absolutely NO markdown, NO code fences, NO explanation text before or after the JSON.

YOUR ANALYSIS MUST BE GROUNDED STRICTLY IN THE PROVIDED DATA:
- The "roast" must call out their actual highest expense category or worst spending pattern visible in the numbers. Do NOT invent habits not evidenced by the data.
- The "praise" must highlight something genuinely positive in the data (good savings rate, staying under budget, low spend in a category, etc.). Do NOT give hollow generic praise.
- The "score" must reflect the real financial picture: savings rate, budget adherence, and balance between income and expense all influence it.
- The "actionItems" must be specific to this user's actual spending — reference real category names and real rupee amounts from the data.

SCORING GUIDE (1–100):
- 90–100: Expenses well under budget, savings rate ≥ 30%, healthy balance across categories.
- 70–89:  Mostly on track; minor overspends in 1–2 categories.
- 50–69:  Budget exceeded OR savings rate < 10%; noticeable problem areas.
- 30–49:  Budget significantly exceeded OR negative balance.
- 1–29:   Severely over budget, near-zero or negative savings.

TONE: Witty and slightly sarcastic for the roast (like a brutally honest friend), warm and encouraging for the praise, and clear and actionable for the tips. Keep each field concise.

REQUIRED JSON STRUCTURE — return exactly these five keys, no more, no less:
{
  "score":       <integer 1–100>,
  "summary":     "<2–3 sentences: neutral month overview with key numbers>",
  "roast":       "<1–2 sentences: funny, pointed call-out of their worst habit based on actual data>",
  "praise":      "<1–2 sentences: genuine positive reinforcement from actual data>",
  "actionItems": ["<specific tip 1 with ₹ amounts>", "<specific tip 2>", "<specific tip 3>"]
}`;

    // ── 8. Call Gemini 2.5 Flash ─────────────────────────────────────────────
    const model = getGenAI().models;
    const response = await model.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Here is my financial data for ${monthLabel}. Generate my Financial Roast & Report:\n\n${financialContext}`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        temperature:     0.7, // Slightly higher than quick-add — we want personality
        // Raised from 600 → 6000. A detailed month (many categories, large
        // amounts, longer actionItems strings) can push the model past 600
        // tokens, causing it to be cut off mid-JSON (e.g. mid-string inside
        // "actionItems") and produce unparseable output. 6000 gives enough
        // headroom for the full 5-key JSON object even on verbose months.
        maxOutputTokens: 6000,
      },
    });

    // ── 9. Extract raw text from Gemini response ─────────────────────────────
    const rawText = extractGeminiText(response);

    if (!rawText) {
      return res.status(502).json({
        success: false,
        message: "AI returned an empty response. Please try again.",
      });
    }

    // ── 10. Robustly extract and parse JSON (strips code fences, slices to {...})
    let parsed;
    try {
      parsed = extractAndParseJSON(rawText);
    } catch (err) {
      console.error(
        "[generateAIReport] extractAndParseJSON failed. Raw Gemini output:",
        rawText,
        "| Error:",
        err.message,
      );
      return res.status(422).json({
        success: false,
        message:
          "AI returned an unexpected format. Please try again in a moment.",
      });
    }

    // ── 11. Validate and sanitise all five required fields ───────────────────
    const score =
      typeof parsed.score === "number" &&
      parsed.score >= 1 &&
      parsed.score <= 100
        ? Math.round(parsed.score)
        : null;

    // FIX: Renamed 'summary' to 'reportSummary' to avoid conflicting with the DB summary
    const reportSummary =
      typeof parsed.summary === "string" && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : null;

    const roast =
      typeof parsed.roast === "string" && parsed.roast.trim().length > 0
        ? parsed.roast.trim()
        : null;

    const praise =
      typeof parsed.praise === "string" && parsed.praise.trim().length > 0
        ? parsed.praise.trim()
        : null;

    // actionItems must be an array of 3 non-empty strings
    const actionItems =
      Array.isArray(parsed.actionItems) &&
      parsed.actionItems.length >= 3 &&
      parsed.actionItems.every((i) => typeof i === "string" && i.trim().length > 0)
        ? parsed.actionItems.slice(0, 3).map((i) => i.trim())
        : null;

    // If any required field is missing, reject cleanly rather than returning
    // a half-formed report that confuses the frontend
    if (!score || !reportSummary || !roast || !praise || !actionItems) {
      console.error(
        "[generateAIReport] Incomplete parsed fields:",
        { score, summary: !!reportSummary, roast: !!roast, praise: !!praise, actionItems: !!actionItems },
      );
      return res.status(422).json({
        success: false,
        message: "AI report was incomplete. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      month:   monthLabel,
      data:    { score, summary: reportSummary, roast, praise, actionItems },
    });
  } catch (error) {
    // Normalise status across @google/genai SDK error shapes
    const status =
      error?.status ?? error?.httpError?.status ?? error?.response?.status;
    if (status === 400 || status === 403) {
      return res.status(502).json({
        success: false,
        message: "AI service configuration error. Please contact support.",
      });
    }
    if (status === 429 || status === 503 ) {
      return res.status(429).json({
        success: false,
        message: "AI service is busy. Please wait a moment and try again.",
      });
    }
    next(error);
  }
};

// ─── POST /api/transactions/scan-receipt  (Sprint 3 — Gemini vision OCR) ────────
/**
 * Accepts a receipt image upload (multipart/form-data, field: "receiptImage"),
 * passes it to Gemini 2.5 Flash as inline base64 data, and returns a structured
 * transaction object ready to auto-fill the TransactionForm.
 *
 * multer (configured in routes/transactions.js) places the file in memory and
 * attaches it to req.file before this controller runs:
 *   req.file.buffer    — raw image bytes
 *   req.file.mimetype  — e.g. "image/jpeg", "image/png", "image/webp"
 *
 * Request:  multipart/form-data with field "receiptImage" (≤ 5 MB)
 * Response:
 *   {
 *     success: true,
 *     message: "Receipt scanned. Please verify the fields before saving.",
 *     data: {
 *       title:    "Groceries at Spar",   // max 5 words
 *       amount:   1249.00,               // final total, number only
 *       type:     "Expense",
 *       category: "Food & Groceries",    // strict enum match
 *       date:     "2025-06-14"           // YYYY-MM-DD, falls back to today
 *     }
 *   }
 */
const parseReceiptImage = async (req, res, next) => {
  try {
    // ── 1. Guard: multer must have attached a file ───────────────────────────
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message:
          "No image received. Please attach a receipt photo (JPEG, PNG, or WEBP, max 5 MB).",
      });
    }

    // ── 2. Convert buffer → base64 ───────────────────────────────────────────
    const base64Image = req.file.buffer.toString("base64");
    const mimeType    = req.file.mimetype; // e.g. "image/jpeg"

    // ── 3. Today's date for fallback resolution ──────────────────────────────
    const todayISO = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    // ── 4. Strict Gemini system prompt ───────────────────────────────────────
    const systemPrompt = `You are a receipt OCR parser for TrackWise, an Indian personal finance app. Your ONLY job is to extract structured transaction data from the receipt image and return it as a single valid JSON object.

TODAY'S DATE: ${todayISO}

EXTRACTION RULES — follow these exactly:
1. "title": A concise merchant or item description in MAXIMUM 5 words. Capitalise the first word only. Use the store/merchant name if visible (e.g. "Spar grocery bill", "Swiggy food order"). Omit receipt numbers, addresses, and cashier names.
2. "amount": The FINAL total amount paid, as a positive number ONLY — no currency symbols, no commas. Look for labels like "Total", "Grand Total", "Amount Due", "Net Payable", "Total Payable", or the largest amount at the bottom. If multiple totals appear, use the final payable amount (after taxes). If no amount is legible, return null.
3. "type": MUST be exactly "Expense" for receipts (purchases, bills, restaurant tabs). Return "Income" ONLY if the image is clearly a payment receipt or salary slip credited to the user.
4. "category": MUST be EXACTLY one of these strings (case-sensitive):
   - "Housing"          → rent receipts, home maintenance, furniture stores
   - "Food & Groceries" → supermarkets, grocery stores, restaurants, cafes, Swiggy, Zomato, food bills
   - "Transport"        → petrol pumps, fuel stations, Uber/Ola receipts, parking, toll, bus/train/metro tickets, flight boarding passes
   - "Utilities"        → electricity bills, water bills, internet/broadband, mobile recharge, gas bills
   - "Entertainment"    → movie tickets, event tickets, gaming, sports, streaming service receipts
   - "Healthcare"       → pharmacy receipts, hospital bills, clinic receipts, lab test reports, gym membership
   - "Salary"           → salary slips, payroll credits, freelance payment receipts
   - "Other"            → anything that does not clearly fit the above categories
5. "date": The transaction date from the receipt in YYYY-MM-DD format. Look for date fields labelled "Date", "Invoice Date", "Bill Date", or similar. If no date is visible or legible, use today: ${todayISO}.

CRITICAL RULES:
- Return ONLY the JSON object. No markdown, no code fences, no explanation text before or after.
- If the image is blurry, not a receipt, or completely illegible, still return the JSON with null for amount and "Other" for category, and use today's date.
- Never invent amounts. If the total is not clearly readable, return null for amount.
- The "amount" must be a number (e.g. 1249.50), never a string.

OUTPUT FORMAT — return exactly this JSON, nothing else:
{"title":"string","amount":number_or_null,"type":"Expense_or_Income","category":"exact_enum_string","date":"YYYY-MM-DD"}`;

    // ── 5. Call Gemini 2.5 Flash with inlineData vision ──────────────────────
    const model = getGenAI().models;
    const response = await model.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            // Text prompt first — keeps the instruction adjacent to the image
            {
              text: "Extract the transaction details from this receipt image and return the JSON object as instructed.",
            },
            // Base64 image as inlineData — the @google/genai SDK shape
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        temperature:      0.1,         // Low: we want deterministic extraction, not creativity
        responseMimeType: "application/json", // Force JSON-mode output
        // No maxOutputTokens — per Sprint 3 spec; the JSON is small enough
        // that the model will always complete it within its natural limit
      },
    });

    // ── 6. Extract raw text from Gemini response ─────────────────────────────
    const rawText = extractGeminiText(response);

    if (!rawText) {
      return res.status(502).json({
        success: false,
        message:
          "AI returned an empty response. Please try again with a clearer image.",
      });
    }

    // ── 7. Route through the shared extractAndParseJSON utility ──────────────
    //    This handles code fences, leading/trailing prose, and truncated JSON
    //    exactly as parseQuickAdd and generateAIReport do.
    let parsed;
    try {
      parsed = extractAndParseJSON(rawText);
    } catch (err) {
      console.error(
        "[parseReceiptImage] extractAndParseJSON failed. Raw Gemini output:",
        rawText,
        "| Error:",
        err.message,
      );
      return res.status(422).json({
        success: false,
        message:
          "Could not read the receipt. Try a clearer, well-lit photo with the total amount visible.",
      });
    }

    // ── 8. Validate and sanitise every field, apply safe fallbacks ───────────
    const VALID_CATEGORIES = [
      "Housing",
      "Food & Groceries",
      "Transport",
      "Utilities",
      "Entertainment",
      "Healthcare",
      "Salary",
      "Other",
    ];

    // title — max 100 chars to match the Transaction schema, strip excess
    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim().slice(0, 100)
        : null;

    // amount — must be a positive finite number; null if unreadable
    const amount =
      typeof parsed.amount === "number" &&
      isFinite(parsed.amount) &&
      parsed.amount > 0
        ? Math.round(parsed.amount * 100) / 100  // round to 2 dp (paise)
        : null;

    // type — receipts are almost always Expense; Income only if explicitly returned
    const type = ["Income", "Expense"].includes(parsed.type)
      ? parsed.type
      : "Expense";

    // category — must exactly match a schema enum; fall back to "Other"
    const category = VALID_CATEGORIES.includes(parsed.category)
      ? parsed.category
      : "Other";

    // date — must be a real YYYY-MM-DD string; fall back to today
    const parsedDate = new Date(parsed.date);
    const date =
      parsed.date &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
      !isNaN(parsedDate.getTime())
        ? parsed.date
        : todayISO;

    // ── 9. Soft guard — surface a warning if even the amount is missing ──────
    //    We still return 200 so the form can open pre-filled with what we got;
    //    the user can enter the amount manually. A hard 422 here would be poor UX
    //    for legitimately blurry images that still yield a useful title/category.
    const warning = !amount
      ? "Amount could not be read from the receipt — please enter it manually."
      : undefined;

    return res.status(200).json({
      success: true,
      message: warning || "Receipt scanned. Please verify the fields before saving.",
      data: { title, amount, type, category, date },
    });
  } catch (error) {
    // Normalise status across @google/genai SDK error shapes (same pattern as
    // parseQuickAdd and generateAIReport)
    const status =
      error?.status ?? error?.httpError?.status ?? error?.response?.status;
    if (status === 400 || status === 403) {
      return res.status(502).json({
        success: false,
        message: "AI service configuration error. Please contact support.",
      });
    }
    if (status === 429 || status === 503) {
      return res.status(429).json({
        success: false,
        message: "AI service is busy. Please wait a moment and try again.",
      });
    }
    next(error);
  }
};

module.exports = {
  getAllTransactions,
  createTransaction,
  editTransaction,
  deleteTransaction,
  getSummary,
  getInsights,
  exportCSV,
  getTitleSuggestions,
  getMonthlyTrend,
  parseQuickAdd,
  generateAIReport,
  parseReceiptImage,
};
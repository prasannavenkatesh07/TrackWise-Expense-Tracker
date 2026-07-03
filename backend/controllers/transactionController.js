/**
 * controllers/transactionController.js
 *
 * Handles all transaction operations - standard CRUD, data aggregations,
 * CSV export, and the three AI-powered endpoints (Quick Add, Monthly Report,
 * Receipt Scanner) that all run through Gemini.
 *
 * Routes:
 *   GET    /api/transactions               → getAllTransactions   (filter + pagination)
 *   POST   /api/transactions               → createTransaction
 *   PUT    /api/transactions/:id           → editTransaction
 *   DELETE /api/transactions/:id           → deleteTransaction
 *   GET    /api/transactions/summary       → getSummary          (supports date range)
 *   GET    /api/transactions/insights      → getInsights         (current month only)
 *   GET    /api/transactions/export        → exportCSV
 *   GET    /api/transactions/titles        → getTitleSuggestions (autocomplete)
 *   GET    /api/transactions/monthly       → getMonthlyTrend     (reports charts)
 *   POST   /api/transactions/quick-add     → parseQuickAdd       (Gemini NLP)
 *   GET    /api/transactions/ai-report     → generateAIReport    (Gemini monthly report)
 *   POST   /api/transactions/scan-receipt  → parseReceiptImage   (Gemini Vision OCR)
 *
 * ALL routes are protected - req.user is attached by authMiddleware.protect.
 */

const { validationResult } = require("express-validator");
const { GoogleGenAI } = require("@google/genai");
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");
const { TRANSACTION_CATEGORIES } = Transaction;

// --- Gemini Client ------------------------------------------------------------
// Initialised on the first AI request rather than at module load -
// that way a missing GEMINI_API_KEY only breaks the AI endpoints,
// not the entire transaction router. The ??= keeps it as a single instance.
let _genai = null;
const getGenAI = () => {
  if (!process.env.GEMINI_API_KEY)
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  return (_genai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
};

// --- extractAndParseJSON ------------------------------------------------------
/**
 * Pulls a JSON object out of a raw Gemini text response and parses it.
 *
 * Even with responseMimeType: "application/json", Gemini occasionally:
 *   - wraps the output in ```json ... ``` code fences
 *   - adds conversational text before/after the JSON ("Sure! Here's...")
 *   - truncates mid-stream if it hits maxOutputTokens
 *
 * This function strips all of that before calling JSON.parse,
 * and falls back to repairTruncatedJSON if the first parse attempt fails.
 *
 * @param {string} rawText - The raw string returned by Gemini
 * @returns {object} The parsed JSON object
 * @throws {Error} If no valid JSON can be extracted after cleaning + repair
 */
const extractAndParseJSON = (rawText) => {
  if (typeof rawText !== "string" || !rawText.trim())
    throw new Error("extractAndParseJSON: empty or non-string input.");

  // Strip markdown code fences wherever they appear (not just at the edges)
  let cleaned = rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // Slice to the substring that starts at the first "{" -
  // cuts off any conversational preamble Gemini added
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace === -1)
    throw new Error(
      `extractAndParseJSON: no JSON object found. Raw: ${rawText}`,
    );

  const lastBrace = cleaned.lastIndexOf("}");
  // If there's a closing brace, slice to include it.
  // If not (truncated output), take from the first brace and let repairTruncatedJSON handle it.
  cleaned =
    lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned.slice(firstBrace);

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // First parse failed - try to close any open brackets and re-parse
    try {
      return JSON.parse(repairTruncatedJSON(cleaned));
    } catch (repairErr) {
      throw new Error(
        `extractAndParseJSON: failed after cleaning and repair. ` +
          `Cleaned: ${cleaned} | Error: ${err.message} | Repair error: ${repairErr.message}`,
      );
    }
  }
};

// --- repairTruncatedJSON ------------------------------------------------------
/**
 * Best-effort fix for a JSON string that was cut off mid-stream -
 * most commonly because Gemini hit maxOutputTokens while writing a value.
 *
 * Strategy: walk the string to find any unclosed strings, arrays, or objects,
 * then append the right closing characters. Only ever adds characters,
 * never rewrites, so a successfully parsed result still reflects exactly
 * what Gemini produced.
 *
 * @param {string} str - Cleaned but possibly truncated JSON
 * @returns {string} The same string with closing brackets appended
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

  // If we were mid-string when it cut off, close the quote first
  if (inString) result += '"';

  // A trailing comma before the closing bracket would be invalid JSON - strip it
  result = result.replace(/,\s*$/, "");

  // Close any unclosed brackets from innermost to outermost
  for (let i = stack.length - 1; i >= 0; i--)
    result += stack[i] === "{" ? "}" : "]";

  return result;
};

// --- extractGeminiText --------------------------------------------------------
/**
 * Pulls the plain text out of a @google/genai response object.
 * The new SDK exposes response.text as a convenience getter, but not all
 * response shapes populate it - the candidates path is the fallback.
 *
 * @param {object} response - Response from models.generateContent
 * @returns {string|undefined}
 */
const extractGeminiText = (response) => {
  if (typeof response?.text === "string" && response.text.length > 0)
    return response.text;
  return response?.candidates?.[0]?.content?.parts?.[0]?.text;
};

// --- @route   GET /api/transactions ------------------------------------------
// @desc    Get all transactions for the logged-in user with optional filters
// @access  Private
// Query params: ?type= ?category= ?search= ?from= ?to= ?page= ?limit=
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

    // Case-insensitive partial match on the title field
    if (req.query.search && req.query.search.trim())
      filter.title = { $regex: req.query.search.trim(), $options: "i" };

    // Date range - used by the History page date picker
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) {
        const to = new Date(req.query.to);
        to.setHours(23, 59, 59, 999); // include the full last day
        filter.date.$lte = to;
      }
    }

    // Capping limit at 50 so nobody accidentally requests 10,000 documents
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    // Running count and fetch in parallel to avoid two sequential round trips
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

// --- @route   POST /api/transactions -----------------------------------------
// @desc    Create a new transaction
// @access  Private
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

    // Catch this before Mongoose does - the error message from the schema isn't
    // as clear as just telling them directly
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
      user_id: req.user._id, // always from the JWT, never from the request body
      isRecurring: !!isRecurring,
      recurringFrequency: isRecurring ? recurringFrequency : null,
      // Set lastGeneratedAt now so the cron job doesn't immediately duplicate it on startup
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

// --- @route   PUT /api/transactions/:id --------------------------------------
// @desc    Edit an existing transaction (partial update - only send changed fields)
// @access  Private
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

    // Build the update object with only the fields that were actually sent -
    // this way a PUT with just { amount: 500 } doesn't wipe out the other fields
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

    // Scoping the query by user_id so users can't edit each other's transactions
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

// --- @route   DELETE /api/transactions/:id -----------------------------------
// @desc    Delete a transaction by ID
// @access  Private
const deleteTransaction = async (req, res, next) => {
  try {
    // Scoping by user_id prevents one user from deleting another's transactions
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

// --- @route   GET /api/transactions/summary ----------------------------------
// @desc    Get total income, expenses, balance, and category breakdown
// @access  Private
// Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD (optional - returns all time if omitted)
const getSummary = async (req, res, next) => {
  try {
    const options = {};
    if (req.query.from) options.from = req.query.from;
    if (req.query.to) options.to = req.query.to;

    // Fetching summary and breakdown in parallel - both are aggregation queries
    const [summary, categoryBreakdown] = await Promise.all([
      Transaction.getSummaryForUser(req.user._id, options),
      Transaction.getCategoryBreakdownForUser(req.user._id, options),
    ]);

    const monthlyBudget = req.user.monthlyBudget || 50000;
    // Cap at 100 so the frontend progress bar doesn't overflow
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

// --- @route   GET /api/transactions/insights ---------------------------------
// @desc    Rule-based spending insights for the current month
// @access  Private
// Always locked to the current month - the dashboard shouldn't show stale insights
const getInsights = async (req, res, next) => {
  try {
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

    // Rule 1: Flag if Food & Groceries takes up more than 40% of total expenses
    const food = breakdown.find((c) => c.category === "Food & Groceries");
    if (food && summary.totalExpense > 0) {
      const pct = (food.total / summary.totalExpense) * 100;
      if (pct > 40)
        insights.push({
          type: "warning",
          code: "FOOD_OVERSPEND",
          message: `⚠️ Food & Groceries is ${pct.toFixed(1)}% of your expenses - consider cutting dining out.`,
        });
    }

    // Rule 2: Give a thumbs-up if they're saving 20% or more of income
    if (summary.totalIncome > 0 && summary.totalExpense > 0) {
      const rate =
        ((summary.totalIncome - summary.totalExpense) / summary.totalIncome) *
        100;
      if (rate >= 20)
        insights.push({
          type: "success",
          code: "GOOD_SAVINGS",
          message: `🎉 You're saving ${rate.toFixed(1)}% of your income - great discipline!`,
        });
    }

    // Rule 3: Warn if monthly budget is blown
    const budget = req.user.monthlyBudget || 50000;
    if (summary.totalExpense > budget)
      insights.push({
        type: "danger",
        code: "BUDGET_EXCEEDED",
        message: `🚨 Monthly budget of ₹${budget.toLocaleString("en-IN")} exceeded by ₹${(summary.totalExpense - budget).toLocaleString("en-IN")}.`,
      });

    // TODO: add a rule for when a single non-essential category (Entertainment, Other)
    // exceeds 25% of total expenses - spotted this as a useful signal during testing

    res.status(200).json({ success: true, data: { insights, summary } });
  } catch (error) {
    next(error);
  }
};

// --- @route   GET /api/transactions/export -----------------------------------
// @desc    Download all transactions as a CSV file
// @access  Private
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
        `"${t.title.replace(/"/g, '""')}"`, // escape any quotes inside the title
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

// --- @route   GET /api/transactions/titles -----------------------------------
// @desc    Return matching transaction titles for autocomplete (?q=search term)
// @access  Private
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

// --- @route   GET /api/transactions/monthly ----------------------------------
// @desc    Get income vs expense totals grouped by month for the reports chart
// @access  Private
// Query params: ?months=6 (default 6, max 24)
const getMonthlyTrend = async (req, res, next) => {
  try {
    // Cap at 24 so nobody accidentally requests 10 years of data
    const months = Math.min(24, Math.max(1, parseInt(req.query.months) || 6));
    const trend = await Transaction.getMonthlyTrend(req.user._id, months);
    res.status(200).json({ success: true, months, data: trend });
  } catch (error) {
    next(error);
  }
};

// --- @route   POST /api/transactions/quick-add -------------------------------
// @desc    Parse a natural language sentence into a transaction object via Gemini
// @access  Private
//
// Request:  { text: "bought groceries at Spar for 1200 rupees today" }
// Response: { success: true, data: { title, amount, type, category, date } }
//
// The response pre-fills the transaction form - the user reviews it and confirms.
// Nothing is saved to the DB here; that happens when they submit the form.
const parseQuickAdd = async (req, res, next) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== "string" || text.trim().length < 3)
      return res.status(400).json({
        success: false,
        message:
          "Please provide a sentence describing your transaction (min 3 characters).",
      });

    if (text.trim().length > 500)
      return res.status(400).json({
        success: false,
        message:
          "Input too long. Please keep your description under 500 characters.",
      });

    const todayISO = new Date().toISOString().split("T")[0];

    // The system prompt is very strict about output format - no markdown, no prose,
    // just raw JSON. Low temperature keeps it deterministic.
    const systemPrompt = `You are a financial transaction parser for an Indian personal finance app called TrackWise. 
Your ONLY job is to extract structured transaction data from a natural language sentence and return it as a single valid JSON object with NO markdown, NO code fences, NO explanation text whatsoever - just raw JSON.

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
6. GIBBERISH RULE: If the user's input is gibberish, conversational, or clearly does not describe a financial expense or income, return null for BOTH the title and the amount.

OUTPUT FORMAT - Return ONLY this JSON object, nothing else:
{"title":"string","amount":number_or_null,"type":"Income_or_Expense","category":"exact_enum_string","date":"YYYY-MM-DD"}`;

    const model = getGenAI().models;
    const response = await model.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: [
        {
          role: "user",
          parts: [{ text: `Parse this transaction: "${text.trim()}"` }],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1, // want consistent structured output, not creativity
        maxOutputTokens: 256,
      },
    });

    const rawText = extractGeminiText(response);

    if (!rawText)
      return res.status(502).json({
        success: false,
        message: "AI returned an empty response. Please try again.",
      });

    let parsed;
    try {
      parsed = extractAndParseJSON(rawText);
    } catch (err) {
      // console.log("[parseQuickAdd] raw Gemini output:", rawText); // left from debugging
      console.error(
        "[parseQuickAdd] extractAndParseJSON failed:",
        rawText,
        "|",
        err.message,
      );
      return res.status(422).json({
        success: false,
        message:
          "AI could not parse your sentence into a transaction. Try being more specific - e.g. 'Paid ₹500 for electricity bill today'.",
      });
    }

    // Validate and sanitise every field before sending back -
    // Gemini is pretty reliable here but I don't want weird data getting into the form
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
        ? Math.round(parsed.amount * 100) / 100 // rounding to 2 dp so the form input looks clean
        : null;
    const type = ["Income", "Expense"].includes(parsed.type)
      ? parsed.type
      : "Expense";
    const category = validCategories.includes(parsed.category)
      ? parsed.category
      : "Other";

    const parsedDate = new Date(parsed.date);
    const date =
      parsed.date &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
      !isNaN(parsedDate.getTime())
        ? parsed.date
        : todayISO;

    if (!title || !amount)
      return res.status(422).json({
        success: false,
        message:
          "Couldn't extract a clear title or amount from your input. Try again with more detail.",
      });

    return res.status(200).json({
      success: true,
      message:
        "Transaction parsed successfully. Please verify the fields before saving.",
      data: { title, amount, type, category, date },
    });
  } catch (error) {
    // Gemini SDK errors come back with different status shapes depending on the version -
    // this normalises them before responding
    const status =
      error?.status ?? error?.httpError?.status ?? error?.response?.status;
    if (status === 400 || status === 403)
      return res.status(502).json({
        success: false,
        message: "AI service configuration error. Please contact support.",
      });
    if (status === 429 || status === 503)
      return res.status(429).json({
        success: false,
        message: "AI service is busy. Please wait a moment and try again.",
      });
    next(error);
  }
};

// --- @route   GET /api/transactions/ai-report --------------------------------
// @desc    Generate a Gemini-powered "Financial Roast & Report" for the current month
// @access  Private
//
// Returns a JSON report with: score (1-100), summary, roast, praise, actionItems.
// Returns 204 if the user has no transactions this month - the frontend
// shows an empty-state prompt in that case instead of a confusing error.
const generateAIReport = async (req, res, next) => {
  try {
    // Step 1: compute current-month date boundaries
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

    const monthLabel = now.toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });

    // Step 2: fetch summary, category breakdown, and category budgets in parallel
    const [summary, breakdown, budgets] = await Promise.all([
      Transaction.getSummaryForUser(req.user._id, options),
      Transaction.getCategoryBreakdownForUser(req.user._id, options),
      Budget.find({
        user_id: req.user._id,
        month: now.getMonth() + 1,
        year: now.getFullYear(),
      }).lean(),
    ]);

    // Step 3: skip the AI call entirely if there's nothing to analyse
    if (summary.totalIncome === 0 && summary.totalExpense === 0)
      return res.status(204).send();

    const monthlyBudget = req.user.monthlyBudget || 50000;
    const budgetStatus =
      summary.totalExpense > monthlyBudget ? "EXCEEDED" : "WITHIN";
    const budgetDelta = Math.abs(summary.totalExpense - monthlyBudget);

    // Step 4: format context strings to inject into the prompt
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

    const budgetStr =
      budgets.length > 0
        ? budgets
            .map(
              (b) =>
                `- ${b.category}: Limit ₹${b.limit.toLocaleString("en-IN")}`,
            )
            .join("\n")
        : "No specific category budgets set.";

    const financialContext = [
      `Month: ${monthLabel}`,
      `Total Income:  ₹${summary.totalIncome.toLocaleString("en-IN")}`,
      `Total Expense: ₹${summary.totalExpense.toLocaleString("en-IN")}`,
      `Net Balance:   ₹${summary.balance.toLocaleString("en-IN")}`,
      `Monthly Global Budget: ₹${monthlyBudget.toLocaleString("en-IN")} - ${budgetStatus} by ₹${budgetDelta.toLocaleString("en-IN")}`,
      `Savings Rate: ${summary.totalIncome > 0 ? (((summary.totalIncome - summary.totalExpense) / summary.totalIncome) * 100).toFixed(1) : "0.0"}%`,
      `Expense Breakdown: ${breakdownStr}`,
      `Category Budgets:\n${budgetStr}`,
    ].join("\n");

    // Step 5: build the Gemini prompt - telling it to be data-grounded prevents hallucinations
    const systemPrompt = `You are a witty, sharp, and expert financial advisor for TrackWise, an Indian personal finance app. Your clients are salaried professionals in India. All monetary values are in Indian Rupees (₹).

You will be given one month of a user's real financial data. Analyse it carefully and return ONLY a single valid JSON object - absolutely NO markdown, NO code fences, NO explanation text before or after the JSON.

YOUR ANALYSIS MUST BE GROUNDED STRICTLY IN THE PROVIDED DATA:
- The "roast" must call out their actual highest expense category, worst spending pattern, or ANY category where they exceeded their individual category budget visible in the numbers. Do NOT invent habits not evidenced by the data.
- The "praise" must highlight something genuinely positive in the data (good savings rate, staying under global budget, staying within specific category limits, etc.). Do NOT give hollow generic praise.
- The "score" must reflect the real financial picture: savings rate, budget adherence, and balance between income and expense all influence it.
- The "actionItems" must be specific to this user's actual spending - reference real category names and real rupee amounts from the data.

SCORING GUIDE (1–100):
- 90–100: Expenses well under budget, savings rate ≥ 30%, healthy balance across categories.
- 70–89:  Mostly on track; minor overspends in 1–2 categories.
- 50–69:  Budget exceeded OR savings rate < 10%; noticeable problem areas.
- 30–49:  Budget significantly exceeded OR negative balance.
- 1–29:   Severely over budget, near-zero or negative savings.

TONE: Witty and slightly sarcastic for the roast (like a brutally honest friend), warm and encouraging for the praise, and clear and actionable for the tips. Keep each field concise.

REQUIRED JSON STRUCTURE - return exactly these five keys, no more, no less:
{
  "score":       <integer 1–100>,
  "summary":     "<2–3 sentences: neutral month overview with key numbers>",
  "roast":       "<1–2 sentences: funny, pointed call-out of their worst habit based on actual data>",
  "praise":      "<1–2 sentences: genuine positive reinforcement from actual data>",
  "actionItems": ["<specific tip 1 with ₹ amounts>", "<specific tip 2>", "<specific tip 3>"]
}`;

    // Step 6: call Gemini
    // maxOutputTokens is 6000 here - bumped up from 600 because a detailed month with
    // many categories can push the model past 600, causing it to be cut off mid-JSON.
    // 6000 is more than enough headroom for this 5-key response.
    const model = getGenAI().models;
    const response = await model.generateContent({
      model: "gemini-3.1-flash-lite",
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
        temperature: 0.7, // slightly higher than quick-add - we want some personality
        maxOutputTokens: 6000,
      },
    });

    const rawText = extractGeminiText(response);

    if (!rawText)
      return res.status(502).json({
        success: false,
        message: "AI returned an empty response. Please try again.",
      });

    let parsed;
    try {
      parsed = extractAndParseJSON(rawText);
    } catch (err) {
      console.error(
        "[generateAIReport] extractAndParseJSON failed:",
        rawText,
        "|",
        err.message,
      );
      return res.status(422).json({
        success: false,
        message:
          "AI returned an unexpected format. Please try again in a moment.",
      });
    }

    // Step 7: validate all five fields before returning -
    // better to return a clean error than a half-formed report that breaks the UI
    const score =
      typeof parsed.score === "number" &&
      parsed.score >= 1 &&
      parsed.score <= 100
        ? Math.round(parsed.score)
        : null;

    // Using reportSummary as the variable name here to avoid shadowing the DB summary above
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

    const actionItems =
      Array.isArray(parsed.actionItems) &&
      parsed.actionItems.length >= 3 &&
      parsed.actionItems.every(
        (i) => typeof i === "string" && i.trim().length > 0,
      )
        ? parsed.actionItems.slice(0, 3).map((i) => i.trim())
        : null;

    if (!score || !reportSummary || !roast || !praise || !actionItems) {
      console.error("[generateAIReport] Incomplete fields:", {
        score,
        summary: !!reportSummary,
        roast: !!roast,
        praise: !!praise,
        actionItems: !!actionItems,
      });
      return res.status(422).json({
        success: false,
        message: "AI report was incomplete. Please try again.",
      });
    }

    return res.status(200).json({
      success: true,
      month: monthLabel,
      data: { score, summary: reportSummary, roast, praise, actionItems },
    });
  } catch (error) {
    const status =
      error?.status ?? error?.httpError?.status ?? error?.response?.status;
    if (status === 400 || status === 403)
      return res.status(502).json({
        success: false,
        message: "AI service configuration error. Please contact support.",
      });
    if (status === 429 || status === 503)
      return res.status(429).json({
        success: false,
        message: "AI service is busy. Please wait a moment and try again.",
      });
    next(error);
  }
};

// --- @route   POST /api/transactions/scan-receipt ----------------------------
// @desc    Upload a receipt image and extract transaction data via Gemini Vision
// @access  Private
//
// multer (in routes/transactions.js) stores the file in memory and attaches it
// to req.file before this runs:
//   req.file.buffer   - raw image bytes
//   req.file.mimetype - e.g. "image/jpeg"
//
// The image is converted to base64 and sent as inlineData - no disk writes.
// Returns the extracted fields to pre-fill the form; doesn't save to DB.
const parseReceiptImage = async (req, res, next) => {
  try {
    // Guard: multer should have attached a file - if not, reject early
    if (!req.file)
      return res.status(400).json({
        success: false,
        message:
          "No image received. Please attach a receipt photo (JPEG, PNG, or WEBP, max 5 MB).",
      });

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype;
    const todayISO = new Date().toISOString().split("T")[0];

    // The prompt is very strict - it tells the model exactly what JSON shape to return
    // and explicitly forbids markdown or surrounding text, since we parse the output directly
    const systemPrompt = `You are a receipt OCR parser for TrackWise, an Indian personal finance app. Your ONLY job is to extract structured transaction data from the receipt image and return it as a single valid JSON object.

TODAY'S DATE: ${todayISO}

EXTRACTION RULES - follow these exactly:
1. "is_valid_receipt": Set this to true ONLY if the image is clearly a bill, invoice, receipt, or payment screenshot. If it is a random picture, diagram, selfie, or completely unrelated to finance, set this to false.
2. "title": A concise merchant or item description in MAXIMUM 5 words. Capitalise the first word only. Use the store/merchant name if visible (e.g. "Spar grocery bill", "Swiggy food order"). Omit receipt numbers, addresses, and cashier names.
3. "amount": The FINAL total amount paid, as a positive number ONLY - no currency symbols, no commas. Look for labels like "Total", "Grand Total", "Amount Due", "Net Payable", "Total Payable", or the largest amount at the bottom. If multiple totals appear, use the final payable amount (after taxes). If no amount is legible, return null.
4. "type": MUST be exactly "Expense" for receipts (purchases, bills, restaurant tabs). Return "Income" ONLY if the image is clearly a payment receipt or salary slip credited to the user.
5. "category": MUST be EXACTLY one of these strings (case-sensitive):
   - "Housing"          → rent receipts, home maintenance, furniture stores
   - "Food & Groceries" → supermarkets, grocery stores, restaurants, cafes, Swiggy, Zomato, food bills
   - "Transport"        → petrol pumps, fuel stations, Uber/Ola receipts, parking, toll, bus/train/metro tickets, flight boarding passes
   - "Utilities"        → electricity bills, water bills, internet/broadband, mobile recharge, gas bills
   - "Entertainment"    → movie tickets, event tickets, gaming, sports, streaming service receipts
   - "Healthcare"       → pharmacy receipts, hospital bills, clinic receipts, lab test reports, gym membership
   - "Salary"           → salary slips, payroll credits, freelance payment receipts
   - "Other"            → anything that does not clearly fit the above categories
6. "date": The transaction date from the receipt in YYYY-MM-DD format. Look for date fields labelled "Date", "Invoice Date", "Bill Date", or similar. If no date is visible or legible, use today: ${todayISO}.

CRITICAL RULES:
- Return ONLY the JSON object. No markdown, no code fences, no explanation text before or after.
- If the image is blurry but still recognizable as a receipt, set is_valid_receipt to true, return null for amount, "Other" for category, and use today's date.
- Never invent amounts. If the total is not clearly readable, return null for amount.
- The "amount" must be a number (e.g. 1249.50), never a string.

OUTPUT FORMAT - return exactly this JSON, nothing else:
{"is_valid_receipt":boolean,"title":"string","amount":number_or_null,"type":"Expense_or_Income","category":"exact_enum_string","date":"YYYY-MM-DD"}`;

    // Sending both a text instruction and the base64 image as parts -
    // the text instruction keeps the prompt adjacent to the image in the context
    const model = getGenAI().models;
    const response = await model.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: "Extract the transaction details from this receipt image and return the JSON object as instructed.",
            },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.1, // want deterministic extraction, not creativity
        responseMimeType: "application/json", // tell Gemini to return JSON mode output
        // No maxOutputTokens - the JSON is small enough that the model always completes it naturally
      },
    });

    const rawText = extractGeminiText(response);

    if (!rawText)
      return res.status(502).json({
        success: false,
        message:
          "AI returned an empty response. Please try again with a clearer image.",
      });

    let parsed;
    try {
      parsed = extractAndParseJSON(rawText);
    } catch (err) {
      console.error(
        "[parseReceiptImage] extractAndParseJSON failed:",
        rawText,
        "|",
        err.message,
      );
      return res.status(422).json({
        success: false,
        message:
          "Could not read the receipt. Try a clearer, well-lit photo with the total amount visible.",
      });
    }

    // Block non-receipt images
    if (parsed.is_valid_receipt === false) {
      return res.status(422).json({
        success: false,
        message:
          "This image does not appear to be a valid receipt or bill. Please upload a clear photo of a financial document.",
      });
    }

    // Validate and sanitise - same pattern as parseQuickAdd
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

    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim().slice(0, 100)
        : null;

    // Rounding to 2 decimal places (paise precision) so the form doesn't show floats like 1249.9999
    const amount =
      typeof parsed.amount === "number" &&
      isFinite(parsed.amount) &&
      parsed.amount > 0
        ? Math.round(parsed.amount * 100) / 100
        : null;

    const type = ["Income", "Expense"].includes(parsed.type)
      ? parsed.type
      : "Expense";
    const category = VALID_CATEGORIES.includes(parsed.category)
      ? parsed.category
      : "Other";

    const parsedDate = new Date(parsed.date);
    const date =
      parsed.date &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) &&
      !isNaN(parsedDate.getTime())
        ? parsed.date
        : todayISO;

    // If the amount is null we still return 200 and open the form pre-filled -
    // a hard 422 here would be frustrating for blurry-but-otherwise-readable receipts
    const warning = !amount
      ? "Amount could not be read from the receipt - please enter it manually."
      : undefined;

    return res.status(200).json({
      success: true,
      message:
        warning || "Receipt scanned. Please verify the fields before saving.",
      data: { title, amount, type, category, date },
    });
  } catch (error) {
    const status =
      error?.status ?? error?.httpError?.status ?? error?.response?.status;
    if (status === 400 || status === 403)
      return res.status(502).json({
        success: false,
        message: "AI service configuration error. Please contact support.",
      });
    if (status === 429 || status === 503)
      return res.status(429).json({
        success: false,
        message: "AI service is busy. Please wait a moment and try again.",
      });
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

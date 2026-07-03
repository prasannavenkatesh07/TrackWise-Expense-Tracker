/**
 * controllers/chatController.js
 *
 * Financial Copilot chatbot - powered by Gemini with RAG context injection,
 * sliding window conversation memory, and function calling for adding transactions.
 *
 * Route: POST /api/chat → handleChat
 *
 * How it works at a high level:
 *   1. On every message, fetch four slices of the user's financial data from MongoDB
 *      in parallel (current-month summary, category breakdown, last 15 transactions,
 *      active budgets) and inject them into the Gemini system prompt.
 *      This is the RAG part - the model answers based on real user data, not guesses.
 *
 *   2. The frontend sends the last few turns of conversation as `history`.
 *      We slice it to MAX_HISTORY_TURNS before passing it to Gemini so the
 *      per-request token cost stays bounded no matter how long the chat runs.
 *
 *   3. Gemini is given one tool - add_transaction. When the user says something like
 *      "I spent ₹200 on lunch today", the model calls the tool with extracted fields,
 *      this backend saves it to MongoDB, then sends the result back to Gemini
 *      so it can produce a natural-language confirmation.
 *
 * SDK note on function responses:
 *   The @google/genai SDK requires the functionResponse to be wrapped inside
 *   { message: [{ functionResponse: ... }] }, NOT passed as a raw array.
 *   Passing a raw array crashes the SDK with "ContentUnion is required".
 *   See step 12 below for the exact shape.
 *
 * ALL routes are protected - req.user is attached by authMiddleware.protect.
 */

const { GoogleGenAI } = require("@google/genai");
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");

// --- Gemini Client ------------------------------------------------------------
// Initialised on the first chat request - same pattern as transactionController.
// A missing GEMINI_API_KEY only breaks /api/chat, not the rest of the API.
let _genai = null;
const getGenAI = () => {
  if (!process.env.GEMINI_API_KEY)
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  return (_genai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
};

// --- extractGeminiText --------------------------------------------------------
// Same helper as in transactionController - the SDK surfaces text via response.text
// as a convenience getter, falling back to the candidates path for edge cases.
const extractGeminiText = (response) => {
  if (typeof response?.text === "string" && response.text.length > 0)
    return response.text;
  return response?.candidates?.[0]?.content?.parts?.[0]?.text;
};

// --- extractFunctionCall ------------------------------------------------------
/**
 * Checks a Gemini response for a function call and returns it if found.
 * Returns null if the model replied with plain text instead.
 *
 * Function calls come back as parts with { functionCall: { name, args } }
 * inside response.candidates[0].content.parts.
 *
 * @param {object} response - Response from chat.sendMessage
 * @returns {{ name: string, args: object } | null}
 */
const extractFunctionCall = (response) => {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (part?.functionCall?.name)
      return {
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
      };
  }
  return null;
};

// --- Constants ----------------------------------------------------------------
const MAX_HISTORY_TURNS = 6; // how many past messages we send to Gemini
const RECENT_TRANSACTIONS_LIMIT = 15; // how many transactions to include in the context

// Mirrors Transaction schema enum exactly - used both in the tool definition
// (so Gemini picks from the right list) and in the validation guard before saving
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
const VALID_TYPES = ["Income", "Expense"];

// --- Tool Definition: add_transaction ----------------------------------------
/**
 * The Gemini function declaration for the transaction-logging tool.
 *
 * Parameter descriptions are written to guide the model into auto-detecting
 * type and category from natural language - users never say "Expense, Food &
 * Groceries", they just say "bought coffee at Starbucks". The model maps it.
 *
 * The date field accepts YYYY-MM-DD with today as the default so relative
 * phrases like "yesterday" are resolved by Gemini before the value reaches us.
 */
const ADD_TRANSACTION_TOOL = {
  name: "add_transaction",
  description:
    "Saves a new financial transaction (income or expense) to the user's TrackWise account. " +
    "Call this whenever the user describes spending money, receiving money, or logging a purchase - " +
    "even if they use casual language like 'I spent ₹150 on coffee' or 'got my salary today'.",
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "A concise, human-readable title for the transaction in 3–5 words. " +
          "Derive it from what the user mentioned (e.g. 'Coffee at café', 'Monthly rent', 'Swiggy order'). " +
          "Capitalise the first word only. Do NOT include the amount or currency symbol.",
      },
      amount: {
        type: "number",
        description:
          "The transaction amount as a positive number without any currency symbol or commas. " +
          "Extract from the user's message (e.g. '₹1,500' → 1500, '50 rupees' → 50). " +
          "Must be greater than zero. If the user does not specify an exact number, do NOT guess - leave this blank.",
      },
      type: {
        type: "string",
        enum: ["Income", "Expense"],
        description:
          "Auto-detect from context. Use 'Expense' for anything the user SPENT money on " +
          "(purchases, bills, food, fuel, subscriptions, etc.). " +
          "Use 'Income' only for money the user RECEIVED " +
          "(salary, freelance payment, refund, gift received, etc.). " +
          "Never ask the user - infer it from the natural language.",
      },
      category: {
        type: "string",
        enum: VALID_CATEGORIES,
        description:
          "Auto-detect the best-matching category from the user's description. " +
          "NEVER ask the user to choose - always infer from context. " +
          "Mapping guide: " +
          "rent/home maintenance → 'Housing'; " +
          "food/groceries/restaurants/coffee/Swiggy/Zomato → 'Food & Groceries'; " +
          "fuel/petrol/Uber/Ola/auto/bus/train/metro/flight → 'Transport'; " +
          "electricity/water/internet/mobile recharge/gas bill → 'Utilities'; " +
          "movies/events/games/OTT subscriptions/sports → 'Entertainment'; " +
          "medicine/hospital/clinic/gym/pharmacy → 'Healthcare'; " +
          "salary/payroll/freelance income → 'Salary'; " +
          "anything that clearly doesn't fit the above → 'Other'.",
      },
      date: {
        type: "string",
        description:
          "The date of the transaction in YYYY-MM-DD format. " +
          "If the user says 'today', use today's date. " +
          "If the user says 'yesterday', subtract one day. " +
          "If no date is mentioned at all, default to today's date. " +
          "Never leave this blank.",
      },
      notes: {
        type: "string",
        description:
          "Optional short note with any extra context the user provided " +
          "(e.g. 'split with Rohan', 'reimbursable', 'anniversary dinner'). " +
          "Leave empty string if nothing additional was mentioned.",
      },
    },
    required: ["title", "type", "category", "date"],
  },
};

// --- @route   POST /api/chat --------------------------------------------------
// @desc    Send a message to the AI financial copilot and get a response
// @access  Private
//
// Request body:
//   { message: string, history?: Array<{ role: "user"|"model", parts: [{ text: string }] }> }
//
// Response:
//   { success: true, response: "<markdown string>", transactionAdded?: object }
const handleChat = async (req, res, next) => {
  try {
    // -- Step 1: validate the request body ------------------------------------
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string" || !message.trim())
      return res.status(400).json({
        success: false,
        message: "message is required and must be a non-empty string.",
      });

    if (message.trim().length > 1000)
      return res.status(400).json({
        success: false,
        message: "Message cannot exceed 1000 characters.",
      });

    if (!Array.isArray(history))
      return res
        .status(400)
        .json({ success: false, message: "history must be an array." });

    // -- Step 2: compute current-month date range ------------------------------
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
    const dateOptions = {
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
    };

    const monthLabel = now.toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
    });
    // Passed to the system prompt so Gemini can resolve "today" / "yesterday" in tool args
    const todayISO = now.toISOString().split("T")[0];

    // -- Step 3: fetch financial context in parallel ---------------------------
    // Running all four queries at once instead of sequentially - saves ~300ms per request.
    // Fetching fresh on every message so the copilot always reflects the latest data.
    const [summary, breakdown, recentTransactions, budgets] = await Promise.all(
      [
        Transaction.getSummaryForUser(req.user._id, dateOptions),
        Transaction.getCategoryBreakdownForUser(req.user._id, dateOptions),
        Transaction.find({ user_id: req.user._id })
          .sort({ date: -1 })
          .limit(RECENT_TRANSACTIONS_LIMIT)
          .lean(),
        Budget.find({
          user_id: req.user._id,
          month: now.getMonth() + 1,
          year: now.getFullYear(),
        }).lean(),
      ],
    );

    // -- Step 4: format context into readable strings for the prompt -----------
    const monthlyBudget = req.user.monthlyBudget || 50000;
    const budgetDelta = Math.abs(summary.totalExpense - monthlyBudget);
    const budgetStatus =
      summary.totalExpense > monthlyBudget
        ? `EXCEEDED by ₹${budgetDelta.toLocaleString("en-IN")}`
        : `within limit (₹${budgetDelta.toLocaleString("en-IN")} remaining)`;

    const savingsRate =
      summary.totalIncome > 0
        ? (
            ((summary.totalIncome - summary.totalExpense) /
              summary.totalIncome) *
            100
          ).toFixed(1)
        : "0.0";

    // e.g. "Food & Groceries: ₹8,200 (38.4%), Transport: ₹3,100 (14.5%)"
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
        : "No expense categories recorded this month.";

    const budgetStr =
      budgets.length > 0
        ? budgets
            .map(
              (b) =>
                `- ${b.category}: Limit ₹${b.limit.toLocaleString("en-IN")}`,
            )
            .join("\n")
        : "No specific category budgets set.";

    // One line per recent transaction so the model can reference specific entries
    const recentTxStr =
      recentTransactions.length > 0
        ? recentTransactions
            .map((t) => {
              const dateStr = new Date(t.date).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
              });
              const sign = t.type === "Income" ? "+" : "-";
              return `• ${dateStr} | ${sign}₹${t.amount.toLocaleString("en-IN")} | ${t.category} | "${t.title}"${t.notes ? ` (${t.notes})` : ""}`;
            })
            .join("\n")
        : "No recent transactions found.";

    // -- Step 5: build the RAG-enriched system prompt --------------------------
    const systemInstruction = `You are the TrackWise Financial Copilot, a smart, helpful, and concise personal finance assistant embedded in the TrackWise expense tracker app. You are speaking with a verified user and have exclusive access to their real financial data for the current month.

TODAY'S DATE: ${todayISO}

YOUR FINANCIAL CONTEXT (as of ${monthLabel}):
-------------------------------------------
Monthly Global Budget: ₹${monthlyBudget.toLocaleString("en-IN")} - ${budgetStatus}
Total Income:          ₹${summary.totalIncome.toLocaleString("en-IN")}
Total Expenses:        ₹${summary.totalExpense.toLocaleString("en-IN")}
Net Balance:           ₹${summary.balance.toLocaleString("en-IN")}
Savings Rate:          ${savingsRate}%

Spending by Category:
${breakdownStr}

Category Budget Limits:
${budgetStr}

Last ${recentTransactions.length} Transactions:
${recentTxStr}
-------------------------------------------

BEHAVIOUR RULES - follow these strictly:
1. BASE ALL ANSWERS ON THE CONTEXT ABOVE. Do not invent transactions, amounts, or categories not present in the data. If the user asks about something not in the context (e.g. a future month, a category with no spend), say so clearly.
2. LOGGING TRANSACTIONS: If the user's message describes spending or receiving money (e.g. "I spent ₹200 on lunch", "paid ₹5000 rent", "got my salary"), call the add_transaction tool immediately. Auto-detect the type (Income/Expense) and category - do NOT ask the user to clarify these.
3. FORMAT: Use Markdown - **bold** for amounts and key terms, bullet points for lists, short paragraphs. Never use tables (they don't render well in the chat UI).
4. AMOUNTS: Always format in Indian Rupees (₹) using the en-IN locale (e.g. ₹1,20,000 not ₹120,000).
5. TONE: Friendly, direct, and professional. Like a knowledgeable friend who happens to be a financial advisor. No unnecessary disclaimers.
6. CONCISENESS: Keep responses under 150 words unless the user explicitly asks for detail. Favour bullet points over long prose.
7. SCOPE: You can answer questions about spending patterns, budget health, savings rate, category breakdowns, specific transactions, and general personal finance advice. For tax, legal, or investment advice, recommend a qualified professional.
8. GROUNDING: If asked "how much did I spend on X?" and X doesn't appear in the breakdown or recent transactions, say "I don't see any X spend recorded this month" - never fabricate a figure.`;

    // -- Step 6: apply sliding window to conversation history ------------------
    // Slice to the last MAX_HISTORY_TURNS messages so the context doesn't grow unbounded.
    // Then drop any entries with the wrong shape - a corrupted history from the frontend
    // shouldn't crash this endpoint.
    let windowedHistory = history.slice(-MAX_HISTORY_TURNS);

    windowedHistory = windowedHistory
      .filter(
        (entry) =>
          (entry.role === "user" || entry.role === "model") &&
          Array.isArray(entry.parts) &&
          entry.parts.length > 0 &&
          typeof entry.parts[0]?.text === "string" &&
          entry.parts[0].text.trim().length > 0,
      )
      .map((entry) => ({
        role: entry.role,
        parts: [{ text: entry.parts[0].text.trim() }],
      }));

    // Gemini requires the history to start with a "user" turn -
    // drop the first entry if it's a "model" turn after sanitisation
    if (windowedHistory.length > 0 && windowedHistory[0].role === "model")
      windowedHistory = windowedHistory.slice(1);

    // -- Step 7: create the Gemini chat session --------------------------------
    // AUTO toolConfig lets the model decide when to call the tool vs. reply in text.
    // That's the right mode for a conversational assistant - we don't want to force
    // a function call on every message, only when the user is actually logging something.
    const chat = getGenAI().chats.create({
      model: "gemini-3.1-flash-lite",
      config: {
        systemInstruction,
        temperature: 0.5,
        maxOutputTokens: 1024,
        tools: [{ functionDeclarations: [ADD_TRANSACTION_TOOL] }],
        toolConfig: {
          functionCallingConfig: { mode: "AUTO" },
        },
      },
      history: windowedHistory,
    });

    // -- Step 8: send the user's message --------------------------------------
    const firstResponse = await chat.sendMessage({ message: message.trim() });

    // -- Step 9: check whether the model replied with text or a function call --
    const functionCall = extractFunctionCall(firstResponse);

    // -- Step 9a: plain text reply - return it directly ------------------------
    if (!functionCall) {
      const replyText = extractGeminiText(firstResponse);

      if (!replyText || !replyText.trim())
        return res.status(502).json({
          success: false,
          message: "AI returned an empty response. Please try again.",
        });

      return res
        .status(200)
        .json({ success: true, response: replyText.trim() });
    }

    // -- Step 9b: function call received - handle add_transaction --------------
    // We only registered one tool so this should always be "add_transaction",
    // but guard defensively in case something unexpected comes back
    if (functionCall.name !== "add_transaction") {
      console.error(
        "[chatController] Gemini called an unexpected tool:",
        functionCall.name,
      );
      return res.status(502).json({
        success: false,
        message: "AI attempted an unrecognised action. Please try again.",
      });
    }

    // -- Step 10: validate and sanitise the tool arguments ---------------------
    const args = functionCall.args;

    const title =
      typeof args.title === "string" && args.title.trim().length > 0
        ? args.title.trim().slice(0, 100)
        : "Untitled transaction";

    // Amount must be a positive finite number - round to 2 dp
    const rawAmount = Number(args.amount);
    const amount =
      isFinite(rawAmount) && rawAmount > 0
        ? Math.round(rawAmount * 100) / 100
        : null;

    // If Gemini couldn't extract a valid amount, send a failure back so it can
    // ask the user to clarify - better than saving a broken record to the DB
    if (!amount) {
      const failResponse = await chat.sendMessage({
        message: [
          {
            functionResponse: {
              name: "add_transaction",
              response: {
                success: false,
                error:
                  "Invalid or missing amount. The amount must be a positive number.",
              },
            },
          },
        ],
      });

      const failText = extractGeminiText(failResponse);
      return res.status(200).json({
        success: true,
        response:
          failText?.trim() ||
          "I couldn't detect a valid amount. Could you clarify how much it was?",
      });
    }

    const type = VALID_TYPES.includes(args.type) ? args.type : "Expense";
    const category = VALID_CATEGORIES.includes(args.category)
      ? args.category
      : "Other";

    // Validate the date string - fall back to today if it's malformed
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    const parsedDate = args.date ? new Date(args.date) : null;
    const date =
      args.date &&
      dateRegex.test(args.date) &&
      parsedDate &&
      !isNaN(parsedDate.getTime())
        ? args.date
        : todayISO;

    const notes =
      typeof args.notes === "string" ? args.notes.trim().slice(0, 500) : "";

    // -- Step 11: save the transaction to MongoDB ------------------------------
    // Wrapped in its own try/catch so a DB failure sends a structured functionResponse
    // back to Gemini (letting it tell the user gracefully) rather than throwing a 500
    let savedTransaction = null;
    let dbError = null;

    try {
      savedTransaction = await Transaction.create({
        title,
        amount,
        type,
        category,
        date: new Date(date),
        notes,
        user_id: req.user._id,
        isRecurring: false,
        recurringFrequency: null,
        lastGeneratedAt: null,
      });
    } catch (err) {
      console.error(
        "[chatController] Transaction.create() failed:",
        err.message,
      );
      dbError = err.message;
    }

    // -- Step 12: send the result back to Gemini as a functionResponse ---------
    //
    // IMPORTANT SDK SHAPE:
    // The @google/genai SDK requires the functionResponse to be wrapped in
    // { message: [{ functionResponse: { ... } }] } - NOT passed as a raw array.
    // Passing a raw array crashes the SDK with "ContentUnion is required".
    //
    const functionResponsePayload = dbError
      ? {
          success: false,
          error: `Database error - the transaction could not be saved: ${dbError}`,
        }
      : {
          success: true,
          savedTitle: savedTransaction.title,
          savedAmount: savedTransaction.amount,
          savedType: savedTransaction.type,
          savedCategory: savedTransaction.category,
          savedDate: new Date(savedTransaction.date)
            .toISOString()
            .split("T")[0],
          transactionId: savedTransaction._id.toString(),
        };

    const secondResponse = await chat.sendMessage({
      message: [
        {
          functionResponse: {
            name: "add_transaction",
            response: functionResponsePayload,
          },
        },
      ],
    });

    // -- Step 13: return Gemini's natural-language confirmation ----------------
    const confirmationText = extractGeminiText(secondResponse);

    if (!confirmationText || !confirmationText.trim()) {
      // Gemini gave us nothing after the function result - synthesise a fallback.
      // This path should be extremely rare but is worth handling cleanly.
      const fallback = dbError
        ? "Sorry, I wasn't able to save that transaction. Please try again."
        : `Got it! I've logged your **${type.toLowerCase()}** of **₹${amount.toLocaleString("en-IN")}** under **${category}** on ${date}.`;

      return res.status(200).json({
        success: true,
        response: fallback,
        transactionAdded: savedTransaction ?? undefined,
      });
    }

    // transactionAdded is only present on a successful save - the frontend
    // uses this to refresh its transaction list without a separate API call
    return res.status(200).json({
      success: true,
      response: confirmationText.trim(),
      transactionAdded: savedTransaction ?? undefined,
    });
  } catch (error) {
    // Normalise status across @google/genai SDK error shapes
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

module.exports = { handleChat };

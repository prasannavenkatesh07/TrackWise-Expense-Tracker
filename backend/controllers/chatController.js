/**
 * controllers/chatController.js
 *
 * Financial Copilot Chatbot Controller — Sprint 4
 *
 * Route map:
 * POST   /api/chat   → handleChat   (RAG chatbot — Gemini 2.5 Flash + sliding window memory)
 *
 * RAG Architecture:
 * On every message the controller fetches four fresh data slices from MongoDB in
 * parallel (current-month summary, category breakdown, last 15 transactions, AND budgets)
 * and injects them into the Gemini system prompt so the model can answer questions
 * about the user's private financial data without hallucinating figures.
 *
 * Sliding Window Memory:
 * req.body.history is sliced to the last MAX_HISTORY_TURNS pairs (6 messages)
 * before being passed to chats.create. This caps the per-request token cost
 * regardless of how long the conversation runs on the frontend.
 *
 * ALL routes are PROTECTED — req.user is injected by authMiddleware.protect.
 */

const { GoogleGenAI } = require("@google/genai");
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget"); // ✦ Added Budget Model

// ─── Gemini Client — lazy singleton ───────────────────────────────────────────
// Matches the pattern in transactionController.js exactly.
// Initialised on first chat request so a missing GEMINI_API_KEY only breaks
// the chat endpoint, not the rest of the API.
let _genai = null;
const getGenAI = () => {
  if (!process.env.GEMINI_API_KEY)
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  return (_genai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
};

// ─── extractGeminiText ─────────────────────────────────────────────────────────
/**
 * Safely extracts the plain-text payload from a @google/genai response object.
 *
 * For chat (chats.create + sendMessage) the SDK returns the same response shape
 * as models.generateContent, so this helper works identically to the one in
 * transactionController.js.
 *
 * @param {object} response - The response object returned by chat.sendMessage().
 * @returns {string|undefined} The extracted text, or undefined if not present.
 */
const extractGeminiText = (response) => {
  // response.text is a convenience getter on the new SDK — prefer it when present
  if (typeof response?.text === "string" && response.text.length > 0) {
    return response.text;
  }
  // Fall back to the raw candidates path for edge-case response shapes
  return response?.candidates?.[0]?.content?.parts?.[0]?.text;
};

// ─── Constants ────────────────────────────────────────────────────────────────
// Maximum number of messages from req.body.history to include in the Gemini
// context window. 6 messages = 3 full user↔model exchange pairs, which is
// enough to maintain coherent conversational context while keeping token costs
// predictable.
const MAX_HISTORY_TURNS = 6;

// Number of recent transactions to inject into the system prompt as concrete
// examples the model can reference when answering "what did I spend on X?"
const RECENT_TRANSACTIONS_LIMIT = 15;

// ─── POST /api/chat ────────────────────────────────────────────────────────────
/**
 * Retrieves the authenticated user's current-month financial data (RAG context),
 * builds a system prompt injecting that context, then starts a Gemini chat
 * session with the last N messages of conversation history and sends the new
 * user message.
 *
 * Request body:
 * {
 * message: string,          // The user's current chat message (required)
 * history: Array<{          // Prior turns from the frontend (optional)
 * role: "user" | "model",
 * parts: [{ text: string }]
 * }>
 * }
 *
 * Response:
 * { success: true, response: "<markdown string from Gemini>" }
 */
const handleChat = async (req, res, next) => {
  try {
    // ── 1. Validate request body ─────────────────────────────────────────────
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "message is required and must be a non-empty string.",
      });
    }

    if (message.trim().length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Message cannot exceed 1000 characters.",
      });
    }

    if (!Array.isArray(history)) {
      return res.status(400).json({
        success: false,
        message: "history must be an array.",
      });
    }

    // ── 2. Compute current-month date boundaries ──────────────────────────────
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
      to:   toDate.toISOString(),
    };

    // Human-readable label for the prompt (e.g. "June 2025")
    const monthLabel = now.toLocaleString("en-IN", {
      month: "long",
      year:  "numeric",
    });

    // ── 3. Selective context retrieval — FOUR Mongoose queries in parallel ────
    // Fetching here (per-request) rather than caching ensures the copilot always
    // reflects the user's latest transactions and active budgets.
    const [summary, breakdown, recentTransactions, budgets] = await Promise.all([
      Transaction.getSummaryForUser(req.user._id, dateOptions),
      Transaction.getCategoryBreakdownForUser(req.user._id, dateOptions),
      Transaction.find({ user_id: req.user._id })
        .sort({ date: -1 })
        .limit(RECENT_TRANSACTIONS_LIMIT)
        .lean(),
      Budget.find({ user_id: req.user._id }).lean(), // ✦ New Budget Query
    ]);

    // ── 4. Format retrieved data into readable prompt strings ─────────────────
    const monthlyBudget = req.user.monthlyBudget || 50000;
    const budgetDelta   = Math.abs(summary.totalExpense - monthlyBudget);
    const budgetStatus  = summary.totalExpense > monthlyBudget
      ? `EXCEEDED by ₹${budgetDelta.toLocaleString("en-IN")}`
      : `within limit (₹${budgetDelta.toLocaleString("en-IN")} remaining)`;

    const savingsRate = summary.totalIncome > 0
      ? (((summary.totalIncome - summary.totalExpense) / summary.totalIncome) * 100).toFixed(1)
      : "0.0";

    // Category breakdown: "Food & Groceries: ₹8,200 (38.4%), Transport: ₹3,100 (14.5%)"
    const breakdownStr = breakdown.length > 0
      ? breakdown
          .map((c) => {
            const pct = summary.totalExpense > 0
              ? ((c.total / summary.totalExpense) * 100).toFixed(1)
              : "0.0";
            return `${c.category}: ₹${c.total.toLocaleString("en-IN")} (${pct}%)`;
          })
          .join(", ")
      : "No expense categories recorded this month.";

    // ✦ Format Category Budgets (Fixed to use b.limit)
    const budgetStr = budgets.length > 0
      ? budgets.map((b) => `- ${b.category}: Limit ₹${b.limit.toLocaleString("en-IN")}`).join("\n")
      : "No specific category budgets set.";

    // Recent transactions: one line each for the model to reference directly
    const recentTxStr = recentTransactions.length > 0
      ? recentTransactions
          .map((t) => {
            const dateStr = new Date(t.date).toLocaleDateString("en-IN", {
              day:   "2-digit",
              month: "short",
            });
            const sign = t.type === "Income" ? "+" : "-";
            return `• ${dateStr} | ${sign}₹${t.amount.toLocaleString("en-IN")} | ${t.category} | "${t.title}"${t.notes ? ` (${t.notes})` : ""}`;
          })
          .join("\n")
      : "No recent transactions found.";

    // ── 5. Build the RAG-enriched system prompt ───────────────────────────────
    const systemInstruction = `You are the TrackWise Financial Copilot, a smart, helpful, and concise personal finance assistant embedded in the TrackWise expense tracker app. You are speaking with a verified user and have exclusive access to their real financial data for the current month.

YOUR FINANCIAL CONTEXT (as of ${monthLabel}):
───────────────────────────────────────────
Monthly Global Budget: ₹${monthlyBudget.toLocaleString("en-IN")} — ${budgetStatus}
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
───────────────────────────────────────────

BEHAVIOUR RULES — follow these strictly:
1. BASE ALL ANSWERS ON THE CONTEXT ABOVE. Do not invent transactions, amounts, or categories not present in the data. If the user asks about something not in the context (e.g. a future month, a category with no spend), say so clearly.
2. FORMAT: Use Markdown — **bold** for amounts and key terms, bullet points for lists, short paragraphs. Never use tables (they don't render well in the chat UI).
3. AMOUNTS: Always format in Indian Rupees (₹) using the en-IN locale (e.g. ₹1,20,000 not ₹120,000).
4. TONE: Friendly, direct, and professional. Like a knowledgeable friend who happens to be a financial advisor. No unnecessary disclaimers.
5. CONCISENESS: Keep responses under 150 words unless the user explicitly asks for detail. Favour bullet points over long prose.
6. SCOPE: You can answer questions about spending patterns, budget health, savings rate, category breakdowns, specific transactions, and general personal finance advice. For tax, legal, or investment advice, recommend a qualified professional.
7. GROUNDING: If asked "how much did I spend on X?" and X doesn't appear in the breakdown or recent transactions, say "I don't see any X spend recorded this month" — never fabricate a figure.`;

    // ── 6. Apply sliding window to conversation history ───────────────────────
    // Keep only the last MAX_HISTORY_TURNS messages. If the total is odd after
    // slicing (e.g. history starts with a model turn), drop the first element so
    // the session always starts with a user turn — the Gemini SDK requires this.
    let windowedHistory = history.slice(-MAX_HISTORY_TURNS);

    // Sanitise: each entry must have role ("user" | "model") and a parts array
    // with at least one string text. Malformed entries are dropped silently so a
    // corrupted history from the frontend doesn't crash the endpoint.
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
        role:  entry.role,
        parts: [{ text: entry.parts[0].text.trim() }],
      }));

    // Gemini requires history to start with a "user" role turn.
    // If after sanitisation the first entry is "model", drop it.
    if (windowedHistory.length > 0 && windowedHistory[0].role === "model") {
      windowedHistory = windowedHistory.slice(1);
    }

    // ── 7. Create the Gemini chat session and send the message ────────────────
    // chats.create() accepts { model, config, history } where config carries
    // systemInstruction and temperature — exactly as confirmed from SDK source.
    const chat = getGenAI().chats.create({
      model:   "gemini-2.5-flash",
      config:  {
        systemInstruction,
        temperature:     0.5,  // Balanced: factual enough for finance, natural enough for chat
        maxOutputTokens: 1024, // Keeps responses concise; the 150-word guideline fits ~200 tokens
      },
      history: windowedHistory,
    });

    // sendMessage({ message }) accepts a plain string — the SDK wraps it in the
    // correct content shape internally (via tContent).
    const response = await chat.sendMessage({ message: message.trim() });

    // ── 8. Extract and validate response text ─────────────────────────────────
    const replyText = extractGeminiText(response);

    if (!replyText || !replyText.trim()) {
      return res.status(502).json({
        success: false,
        message: "AI returned an empty response. Please try again.",
      });
    }

    return res.status(200).json({
      success:  true,
      response: replyText.trim(),
    });
  } catch (error) {
    // Normalise status across @google/genai SDK error shapes — matches the
    // identical pattern used in parseQuickAdd and generateAIReport.
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

module.exports = { handleChat };
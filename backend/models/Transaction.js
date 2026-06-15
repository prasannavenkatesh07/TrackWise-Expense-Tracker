/**
 * models/Transaction.js
 *
 * Mongoose Schema for the Transaction entity.
 * Extended in Phase A with:
 * - isRecurring + recurringFrequency fields (for the cron scheduler)
 * - lastGeneratedAt  (tracks when the cron last spawned a copy)
 * - getMonthlyTrend() static  (for the Reports page line/bar chart)
 * - getTitleSuggestions() static (for the search autocomplete endpoint)
 * - Updated getSummaryForUser() to support optional date range filtering
 *
 * MERN Data Flow note:
 * React's TransactionForm POSTs to /api/transactions.
 * The TransactionController creates a new Transaction document
 * linked to the authenticated user via `user_id` (populated from JWT).
 * The saved document is returned as JSON, and React updates its
 * local state — no full page reload required.
 */

const mongoose = require("mongoose");

// ─── Allowed Enum Values ──────────────────────────────────────────────────────
const TRANSACTION_TYPES = ["Income", "Expense"];

const TRANSACTION_CATEGORIES = [
  "Housing",
  "Food & Groceries",
  "Transport",
  "Utilities",
  "Entertainment",
  "Healthcare",
  "Salary",
  "Other",
];

// Recurring frequency options — used in the cron job and the frontend dropdown
const RECURRING_FREQUENCIES = ["Daily", "Weekly", "Monthly"];

// ─── Schema Definition ────────────────────────────────────────────────────────
const TransactionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Transaction title is required."],
      trim: true,
      minlength: [2, "Title must be at least 2 characters."],
      maxlength: [100, "Title cannot exceed 100 characters."],
    },

    amount: {
      type: Number,
      required: [true, "Amount is required."],
      min: [1, "Amount must be at least ₹1."],
    },

    type: {
      type: String,
      required: [true, "Transaction type is required."],
      enum: {
        values: TRANSACTION_TYPES,
        message: `Type must be one of: ${TRANSACTION_TYPES.join(", ")}.`,
      },
    },

    category: {
      type: String,
      required: [true, "Category is required."],
      enum: {
        values: TRANSACTION_CATEGORIES,
        message: `Category must be one of: ${TRANSACTION_CATEGORIES.join(", ")}.`,
      },
    },

    date: {
      type: Date,
      default: Date.now,
    },

    // Foreign key — links every transaction to exactly one User
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Transaction must belong to a user."],
      index: true,
    },

    // Optional note/description for the transaction
    notes: {
      type: String,
      trim: true,
      maxlength: [250, "Notes cannot exceed 250 characters."],
      default: "",
    },

    // ── Recurring Transaction Fields (Phase A) ────────────────────────────────
    /**
     * isRecurring — When true, the node-cron scheduler (jobs/recurringJob.js)
     * will automatically clone this transaction at the specified frequency.
     * The original "template" transaction is never deleted by the scheduler —
     * only new copies are generated from it.
     */
    isRecurring: {
      type: Boolean,
      default: false,
      index: true, // Indexed so the cron job can quickly find all recurring docs
    },

    recurringFrequency: {
      type: String,
      enum: {
        values: [...RECURRING_FREQUENCIES, null],
        message: `Frequency must be one of: ${RECURRING_FREQUENCIES.join(", ")}.`,
      },
      default: null,
      // Only meaningful when isRecurring is true — validated at controller level
    },

    /**
     * lastGeneratedAt — Timestamp of the last time the cron job fired a copy
     * of this recurring transaction. Used to prevent duplicate generation
     * within the same cycle (e.g., if the server restarts mid-day).
     */
    lastGeneratedAt: {
      type: Date,
      default: null,
    },

    /**
     * isGeneratedCopy — True on transactions auto-created by the cron scheduler.
     * Lets the UI optionally badge them as "Auto" and prevents them from being
     * treated as new recurring templates themselves.
     */
    isGeneratedCopy: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// ─── Compound Indexes ──────────────────────────────────────────────────────────
// Primary query: user's transactions sorted newest first
TransactionSchema.index({ user_id: 1, date: -1 });
// Cron job query: find recurring transactions that need processing
TransactionSchema.index({ isRecurring: 1, lastGeneratedAt: 1 });
// Reports query: user + date range aggregations
TransactionSchema.index({ user_id: 1, date: 1, type: 1 });

// ─── Virtual: formattedAmount ─────────────────────────────────────────────────
TransactionSchema.virtual("formattedAmount").get(function () {
  return `₹${this.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
});

TransactionSchema.set("toJSON", { virtuals: true });
TransactionSchema.set("toObject", { virtuals: true });

// ─── Static: getSummaryForUser ────────────────────────────────────────────────
/**
 * Aggregates total Income and Expense for a user.
 * Now supports optional `from` / `to` date range filtering for the Reports page.
 *
 * @param {ObjectId} userId
 * @param {Object}  [options]
 * @param {Date}    [options.from]  — Start of date range (inclusive)
 * @param {Date}    [options.to]    — End of date range (inclusive)
 */
TransactionSchema.statics.getSummaryForUser = async function (
  userId,
  options = {},
) {
  const matchStage = { user_id: new mongoose.Types.ObjectId(userId) };

  // Apply optional date range
  if (options.from || options.to) {
    matchStage.date = {};
    if (options.from) matchStage.date.$gte = new Date(options.from);
    if (options.to) matchStage.date.$lte = new Date(options.to);
  }

  const result = await this.aggregate([
    { $match: matchStage },
    { 
      $group: { 
        _id: "$type", 
        total: { $sum: "$amount" }, 
        // FIX: Tell MongoDB to also count the number of documents
        count: { $sum: 1 } 
      } 
    },
  ]);

  // FIX: Initialize totalTransactions
  const summary = { totalIncome: 0, totalExpense: 0, totalTransactions: 0 };
  
  result.forEach((item) => {
    if (item._id === "Income") summary.totalIncome = item.total;
    if (item._id === "Expense") summary.totalExpense = item.total;
    
    // Add the grouped counts together
    summary.totalTransactions += item.count;
  });
  
  summary.balance = summary.totalIncome - summary.totalExpense;
  return summary;
};

// ─── Static: getCategoryBreakdownForUser ──────────────────────────────────────
/**
 * Expense amounts grouped by category — supports date range filtering.
 *
 * @param {ObjectId} userId
 * @param {Object}  [options]
 * @param {Date}    [options.from]
 * @param {Date}    [options.to]
 */
TransactionSchema.statics.getCategoryBreakdownForUser = async function (
  userId,
  options = {},
) {
  const matchStage = {
    user_id: new mongoose.Types.ObjectId(userId),
    type: "Expense",
  };
  if (options.from || options.to) {
    matchStage.date = {};
    if (options.from) matchStage.date.$gte = new Date(options.from);
    if (options.to) matchStage.date.$lte = new Date(options.to);
  }

  return this.aggregate([
    { $match: matchStage },
    { $group: { _id: "$category", total: { $sum: "$amount" } } },
    { $project: { _id: 0, category: "$_id", total: 1 } },
    { $sort: { total: -1 } },
  ]);
};

// ─── Static: getMonthlyTrend ──────────────────────────────────────────────────
/**
 * Aggregates Income and Expense totals grouped by calendar month for the
 * Reports page's Line chart and Bar chart.
 *
 * Returns the last N months (default 6) sorted oldest-first so charts
 * render left→right chronologically.
 *
 * @param {ObjectId} userId
 * @param {number}  [months=6] — How many past months to include
 * @returns {Promise<Array<{ month: string, income: number, expense: number }>>}
 */
TransactionSchema.statics.getMonthlyTrend = async function (
  userId,
  months = 6,
) {
  // Calculate the start date (beginning of N months ago)
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - (months - 1));
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const result = await this.aggregate([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(userId),
        date: { $gte: startDate },
      },
    },
    {
      // Group by year + month + transaction type
      $group: {
        _id: {
          year: { $year: "$date" },
          month: { $month: "$date" },
          type: "$type",
        },
        total: { $sum: "$amount" },
      },
    },
    {
      // Re-group to combine Income and Expense into one document per month
      $group: {
        _id: { year: "$_id.year", month: "$_id.month" },
        income: {
          $sum: { $cond: [{ $eq: ["$_id.type", "Income"] }, "$total", 0] },
        },
        expense: {
          $sum: { $cond: [{ $eq: ["$_id.type", "Expense"] }, "$total", 0] },
        },
      },
    },
    { $sort: { "_id.year": 1, "_id.month": 1 } },
  ]);

  // Format the month label for the chart axis (e.g., "Jan 2025")
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return result.map((r) => ({
    month: `${monthNames[r._id.month - 1]} ${r._id.year}`,
    income: r.income,
    expense: r.expense,
    savings: r.income - r.expense,
  }));
};

// ─── Static: getTitleSuggestions ──────────────────────────────────────────────
/**
 * Returns distinct transaction titles that match a search query string.
 * Used by the autocomplete endpoint: GET /api/transactions/titles?q=
 *
 * @param {ObjectId} userId
 * @param {string}   query  — Partial title string to match
 * @param {number}   [limit=8] — Max suggestions to return
 * @returns {Promise<string[]>}
 */
TransactionSchema.statics.getTitleSuggestions = async function (
  userId,
  query,
  limit = 8,
) {
  if (!query || query.trim().length < 1) return [];

  const results = await this.aggregate([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(userId),
        title: { $regex: query.trim(), $options: "i" },
      },
    },
    // Get distinct titles (group + pick most recent occurrence for ranking)
    {
      $group: {
        _id: "$title",
        lastUsed: { $max: "$date" },
        count: { $sum: 1 },
      },
    },
    // Sort by most frequently used, then most recently used
    { $sort: { count: -1, lastUsed: -1 } },
    { $limit: limit },
    { $project: { _id: 0, title: "$_id", count: 1 } },
  ]);

  return results.map((r) => r.title);
};

// ─── Export ───────────────────────────────────────────────────────────────────
const Transaction = mongoose.model("Transaction", TransactionSchema);

module.exports = Transaction;
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
module.exports.TRANSACTION_CATEGORIES = TRANSACTION_CATEGORIES;
module.exports.RECURRING_FREQUENCIES = RECURRING_FREQUENCIES;
/**
 * models/Transaction.js
 *
 * Core schema for all income and expense records.
 *
 * Also includes recurring transaction fields so the cron job
 * (jobs/recurringJob.js) can automatically clone transactions
 * at the right frequency without any user intervention.
 *
 * Static methods on this model handle all the heavy aggregation work -
 * summaries, category breakdowns, monthly trends, and title autocomplete -
 * so the controllers stay thin and readable.
 *
 * MERN Data Flow:
 * React's TransactionForm POSTs to /api/transactions →
 * controller creates a Transaction document linked to the user via user_id →
 * saved doc is returned as JSON → React updates local state → UI re-renders
 */

const mongoose = require("mongoose");

// --- Allowed Enum Values ------------------------------------------------------
// Exporting these so the route validators can reuse them instead of
// hardcoding the same lists in multiple places
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

// Used both in the schema enum and in the cron job logic
const RECURRING_FREQUENCIES = ["Daily", "Weekly", "Monthly"];

// --- Schema -------------------------------------------------------------------
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

    // Every transaction belongs to exactly one user
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Transaction must belong to a user."],
      index: true,
    },

    notes: {
      type: String,
      trim: true,
      maxlength: [250, "Notes cannot exceed 250 characters."],
      default: "",
    },

    // -- Recurring Transaction Fields ------------------------------------------
    // When isRecurring is true, the cron job will clone this transaction
    // at the given frequency. The original document acts as a template -
    // the cron job never deletes or modifies it, only creates new copies from it.
    isRecurring: {
      type: Boolean,
      default: false,
      index: true, // indexed so the cron job can find all recurring docs quickly
    },

    recurringFrequency: {
      type: String,
      enum: {
        values: [...RECURRING_FREQUENCIES, null],
        message: `Frequency must be one of: ${RECURRING_FREQUENCIES.join(", ")}.`,
      },
      default: null,
      // Only meaningful when isRecurring is true - the controller validates this pairing
    },

    // Tracks the last time the cron job generated a copy from this template.
    // Used to make sure we don't accidentally generate duplicates if the
    // server restarts mid-cycle.
    lastGeneratedAt: {
      type: Date,
      default: null,
    },

    // Flags transactions that were auto-created by the cron job.
    // Lets the UI optionally show an "Auto" badge and prevents these copies
    // from being treated as new recurring templates themselves.
    isGeneratedCopy: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// --- Indexes ------------------------------------------------------------------
// Main dashboard query - user's transactions sorted newest first
TransactionSchema.index({ user_id: 1, date: -1 });
// Cron job query - find recurring transactions that are due
TransactionSchema.index({ isRecurring: 1, lastGeneratedAt: 1 });
// Reports/summary queries - filtering by user + date range + type
TransactionSchema.index({ user_id: 1, date: 1, type: 1 });

// --- Virtual: formattedAmount -------------------------------------------------
// Handy for debugging - not really used by the frontend since it formats
// amounts itself, but useful when logging transaction objects
TransactionSchema.virtual("formattedAmount").get(function () {
  return `₹${this.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
});

TransactionSchema.set("toJSON", { virtuals: true });
TransactionSchema.set("toObject", { virtuals: true });

// --- Static: getSummaryForUser ------------------------------------------------
/**
 * Returns total income, total expenses, balance, and transaction count
 * for a given user. Supports optional date range filtering for the Reports page.
 *
 * @param {ObjectId} userId
 * @param {Object}   [options]
 * @param {Date}     [options.from]  Start of date range (inclusive)
 * @param {Date}     [options.to]    End of date range (inclusive)
 */
TransactionSchema.statics.getSummaryForUser = async function (
  userId,
  options = {},
) {
  const matchStage = { user_id: new mongoose.Types.ObjectId(userId) };

  // Only add date filters if they were actually passed in
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
        count: { $sum: 1 }, // counting here so we don't need a separate query for totals
      },
    },
  ]);

  const summary = { totalIncome: 0, totalExpense: 0, totalTransactions: 0 };

  result.forEach((item) => {
    if (item._id === "Income") summary.totalIncome = item.total;
    if (item._id === "Expense") summary.totalExpense = item.total;
    summary.totalTransactions += item.count;
  });

  summary.balance = summary.totalIncome - summary.totalExpense;
  return summary;
};

// --- Static: getCategoryBreakdownForUser --------------------------------------
/**
 * Returns expense totals grouped by category, sorted highest to lowest.
 * Used by the insights/pie chart endpoint.
 *
 * @param {ObjectId} userId
 * @param {Object}   [options]
 * @param {Date}     [options.from]
 * @param {Date}     [options.to]
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

// --- Static: getMonthlyTrend --------------------------------------------------
/**
 * Returns income and expense totals grouped by month for the last N months.
 * Sorted oldest → newest so the chart renders left to right chronologically.
 *
 * The two-stage grouping is needed because MongoDB can't pivot Income/Expense
 * into separate columns in a single $group - we group by type first,
 * then re-group by month to combine them.
 *
 * @param {ObjectId} userId
 * @param {number}   [months=6]  How many past months to include
 * @returns {Promise<Array<{ month: string, income: number, expense: number, savings: number }>>}
 */
TransactionSchema.statics.getMonthlyTrend = async function (
  userId,
  months = 6,
) {
  // Start from the beginning of the earliest month we want to include
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
      // First group: year + month + type  →  gives us one row per type per month
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
      // Second group: year + month  →  collapses Income and Expense into one row per month
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

  // Format the month label for the chart axis (e.g. "Jan 2025")
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return result.map((r) => ({
    month: `${monthNames[r._id.month - 1]} ${r._id.year}`,
    income: r.income,
    expense: r.expense,
    savings: r.income - r.expense,
  }));
};

// --- Static: getTitleSuggestions ----------------------------------------------
/**
 * Returns distinct transaction titles that partially match a search string.
 * Sorted by how often the user has used that title, then by most recent.
 * Used by the autocomplete input on the transaction form.
 *
 * @param {ObjectId} userId
 * @param {string}   query    Partial title to search for
 * @param {number}   [limit=8]
 * @returns {Promise<string[]>}
 */
TransactionSchema.statics.getTitleSuggestions = async function (
  userId,
  query,
  limit = 8,
) {
  if (!query || query.trim().length < 1) return [];

  // console.log("getTitleSuggestions query:", query); // left from debugging autocomplete lag

  const results = await this.aggregate([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(userId),
        title: { $regex: query.trim(), $options: "i" }, // case-insensitive partial match
      },
    },
    {
      // Group by title to get distinct values and track usage frequency
      $group: {
        _id: "$title",
        lastUsed: { $max: "$date" },
        count: { $sum: 1 },
      },
    },
    // Show the most frequently used titles first, break ties by most recent
    { $sort: { count: -1, lastUsed: -1 } },
    { $limit: limit },
    { $project: { _id: 0, title: "$_id", count: 1 } },
  ]);

  return results.map((r) => r.title);
};

// --- Export -------------------------------------------------------------------
const Transaction = mongoose.model("Transaction", TransactionSchema);

module.exports = Transaction;
module.exports.TRANSACTION_TYPES = TRANSACTION_TYPES;
module.exports.TRANSACTION_CATEGORIES = TRANSACTION_CATEGORIES;
module.exports.RECURRING_FREQUENCIES = RECURRING_FREQUENCIES;

/**
 * models/Budget.js
 *
 * Schema for per-category monthly budget limits.
 *
 * Each document represents one category budget for one user for one month.
 * That means if a user sets a Food budget for May and June, that's two
 * separate documents - which makes querying and comparing months straightforward.
 *
 * Example document:
 *   {
 *     user_id:  ObjectId("..."),
 *     category: "Food & Groceries",
 *     limit:    8000,
 *     month:    5,     // May
 *     year:     2025,
 *   }
 *
 * The actual `spent` and `percentage` fields aren't stored here -
 * they're calculated on the fly by joining with the Transaction collection
 * in the getBudgetsWithSpend static method below.
 */

const mongoose = require("mongoose");
const { TRANSACTION_CATEGORIES } = require("./Transaction");

// --- Schema -------------------------------------------------------------------
const BudgetSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Budget must belong to a user."],
      index: true,
    },

    category: {
      type: String,
      required: [true, "Category is required."],
      enum: {
        values: TRANSACTION_CATEGORIES,
        message: `Category must be one of: ${TRANSACTION_CATEGORIES.join(", ")}.`,
      },
    },

    // The spending cap in ₹ for this category this month
    limit: {
      type: Number,
      required: [true, "Budget limit is required."],
      min: [1, "Budget limit must be at least ₹1."],
    },

    // Storing month and year separately makes querying a specific month much easier
    // than parsing date ranges every time
    month: {
      type: Number,
      required: [true, "Month is required."],
      min: [1, "Month must be between 1 and 12."],
      max: [12, "Month must be between 1 and 12."],
    },

    year: {
      type: Number,
      required: [true, "Year is required."],
      min: [2020, "Year must be 2020 or later."],
    },
  },
  {
    timestamps: true,
  },
);

// --- Compound Unique Index ----------------------------------------------------
// A user can only have one budget per category per month/year.
// This also makes it safe to do create-or-update in the controller
// without having to check for duplicates manually first.
BudgetSchema.index(
  { user_id: 1, category: 1, month: 1, year: 1 },
  { unique: true },
);

// --- Static Method: getBudgetsWithSpend --------------------------------------
/**
 * Fetches all budget documents for a user in a given month/year,
 * then calculates how much was actually spent in each category
 * by aggregating matching Transaction documents.
 *
 * Doing this in one aggregation instead of querying per-budget
 * so we don't hammer the DB with N separate queries.
 *
 * @param {ObjectId} userId
 * @param {number}   month  (1–12)
 * @param {number}   year
 * @returns {Promise<Array>}
 *
 * Each item in the returned array looks like:
 * {
 *   _id, category, limit, month, year,
 *   spent:        number,   // total ₹ spent in that category this month
 *   remaining:    number,   // limit - spent (negative means over budget)
 *   percentage:   number,   // (spent / limit) * 100
 *   isOverBudget: boolean
 * }
 */
BudgetSchema.statics.getBudgetsWithSpend = async function (
  userId,
  month,
  year,
) {
  const Transaction = mongoose.model("Transaction");

  // Step 1: get all budget documents for this user/month/year
  const budgets = await this.find({ user_id: userId, month, year }).lean();

  if (budgets.length === 0) return [];

  // Step 2: build a date range covering the full target month
  const startDate = new Date(year, month - 1, 1); // e.g. 2025-05-01 00:00:00
  const endDate = new Date(year, month, 0, 23, 59, 59); // e.g. 2025-05-31 23:59:59

  // Step 3: aggregate actual spend per category within that date range
  const spendByCategory = await Transaction.aggregate([
    {
      $match: {
        user_id: new mongoose.Types.ObjectId(userId),
        type: "Expense",
        date: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$category",
        spent: { $sum: "$amount" },
      },
    },
  ]);

  // Step 4: turn the aggregation result into a plain lookup object
  // so we can grab a category's spend in O(1) instead of searching the array each time
  const spendMap = {};
  spendByCategory.forEach((s) => {
    spendMap[s._id] = s.spent;
  });

  // Step 5: merge the spend data into each budget document and calculate derived fields
  return budgets.map((budget) => {
    const spent = spendMap[budget.category] || 0;
    const remaining = budget.limit - spent;
    // Rounding to 1 decimal place so the progress bar doesn't show weird floating point numbers
    const percentage =
      budget.limit > 0
        ? parseFloat(((spent / budget.limit) * 100).toFixed(1))
        : 0;

    return {
      ...budget,
      spent,
      remaining,
      percentage,
      isOverBudget: spent > budget.limit,
    };
  });
};

// --- Export -------------------------------------------------------------------
module.exports = mongoose.model("Budget", BudgetSchema);

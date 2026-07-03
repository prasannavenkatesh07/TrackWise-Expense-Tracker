/**
 * controllers/budgetController.js
 *
 * Handles all budget CRUD operations and the budget health summary.
 *
 * Routes:
 *   GET    /api/budgets          → getBudgets          (list budgets + actual spend for a month)
 *   POST   /api/budgets          → createOrUpdateBudget (create or update a category budget)
 *   DELETE /api/budgets/:id      → deleteBudget
 *   GET    /api/budgets/summary  → getBudgetSummary    (overall budget health stats)
 *
 * Design note on createOrUpdateBudget:
 *   Instead of having separate POST (create) and PUT/:id (update) routes, I'm using
 *   MongoDB's findOneAndUpdate with upsert:true, keyed on (user_id, category, month, year).
 *   This means the frontend just POSTs the desired limit and doesn't need to track
 *   whether a budget already exists - much simpler React state management.
 */

const { validationResult } = require("express-validator");
const Budget = require("../models/Budget");
const { TRANSACTION_CATEGORIES } = require("../models/Transaction");

// --- Helper -------------------------------------------------------------------
// Pulled into a helper so I don't repeat new Date() math in every controller
const getCurrentMonthYear = () => {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
};

// --- @route   GET /api/budgets ------------------------------------------------
// @desc    Get all budget entries for a given month with actual spend merged in
// @access  Private
// Query params: ?month=5&year=2025 (defaults to current month/year if not provided)
const getBudgets = async (req, res, next) => {
  try {
    const { month, year } = getCurrentMonthYear();
    const targetMonth = parseInt(req.query.month) || month;
    const targetYear = parseInt(req.query.year) || year;

    if (targetMonth < 1 || targetMonth > 12)
      return res
        .status(400)
        .json({ success: false, message: "Month must be between 1 and 12." });
    if (targetYear < 2020)
      return res
        .status(400)
        .json({ success: false, message: "Year must be 2020 or later." });

    // The static method handles the aggregation join with Transaction - no N+1 here
    const budgets = await Budget.getBudgetsWithSpend(
      req.user._id,
      targetMonth,
      targetYear,
    );

    res.status(200).json({
      success: true,
      month: targetMonth,
      year: targetYear,
      count: budgets.length,
      data: budgets,
    });
  } catch (error) {
    next(error);
  }
};

// --- @route   POST /api/budgets -----------------------------------------------
// @desc    Set a spending limit for a category. Creates it if new, updates if it exists.
// @access  Private
// Body: { category, limit, month?, year? }
const createOrUpdateBudget = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
        errors: errors.array(),
      });
    }

    const { month, year } = getCurrentMonthYear();
    const {
      category,
      limit,
      month: reqMonth = month,
      year: reqYear = year,
    } = req.body;

    // findOneAndUpdate with upsert - creates the document if it doesn't exist,
    // updates the limit field if it does. The unique index on (user_id, category, month, year)
    // in the Budget schema makes this safe.
    const budget = await Budget.findOneAndUpdate(
      {
        user_id: req.user._id,
        category,
        month: parseInt(reqMonth),
        year: parseInt(reqYear),
      },
      { limit: parseFloat(limit) },
      {
        new: true, // return the updated/created document
        upsert: true, // create if not found
        runValidators: true, // still run schema validators on update
        setDefaultsOnInsert: true,
      },
    );

    res.status(200).json({
      success: true,
      message: `Budget for ${category} ${budget.month}/${budget.year} saved.`,
      data: budget,
    });
  } catch (error) {
    // MongoDB throws 11000 on duplicate key violations - can happen in a race
    // condition if two requests arrive at exactly the same time
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A budget for this category and month already exists.",
      });
    }
    next(error);
  }
};

// --- @route   DELETE /api/budgets/:id ----------------------------------------
// @desc    Remove a budget entry by its MongoDB ObjectId
// @access  Private
const deleteBudget = async (req, res, next) => {
  try {
    // Scoping the delete by user_id so one user can't delete another's budget
    const budget = await Budget.findOneAndDelete({
      _id: req.params.id,
      user_id: req.user._id,
    });

    if (!budget) {
      return res.status(404).json({
        success: false,
        message: "Budget not found or you are not authorised to delete it.",
      });
    }

    res.status(200).json({
      success: true,
      message: `Budget for ${budget.category} deleted.`,
      data: { _id: budget._id },
    });
  } catch (error) {
    next(error);
  }
};

// --- @route   GET /api/budgets/summary ---------------------------------------
// @desc    Get overall budget health stats for a given month
// @access  Private
// Returns totals, over/under counts, and a health percentage for the BudgetsPage header
const getBudgetSummary = async (req, res, next) => {
  try {
    const { month, year } = getCurrentMonthYear();
    const targetMonth = parseInt(req.query.month) || month;
    const targetYear = parseInt(req.query.year) || year;

    const budgets = await Budget.getBudgetsWithSpend(
      req.user._id,
      targetMonth,
      targetYear,
    );

    const totalAllocated = budgets.reduce((s, b) => s + b.limit, 0);
    const totalSpent = budgets.reduce((s, b) => s + b.spent, 0);
    const overBudgetCount = budgets.filter((b) => b.isOverBudget).length;
    const underBudgetCount = budgets.length - overBudgetCount;

    // Making sure to round to 1 decimal so the progress bar doesn't show ugly floats
    const healthPercent =
      totalAllocated > 0
        ? parseFloat(((totalSpent / totalAllocated) * 100).toFixed(1))
        : 0;

    res.status(200).json({
      success: true,
      data: {
        month: targetMonth,
        year: targetYear,
        totalAllocated,
        totalSpent,
        totalRemaining: totalAllocated - totalSpent,
        overBudgetCount,
        underBudgetCount,
        budgetCount: budgets.length,
        healthPercent,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBudgets,
  createOrUpdateBudget,
  deleteBudget,
  getBudgetSummary,
};

/**
 * routes/budgets.js
 *
 * Budget routes - all mounted at /api/budgets (see server.js).
 * Every route here requires a valid JWT, enforced by router.use(protect).
 *
 * Important: /summary is defined before /:id because Express matches routes
 * in order - if /:id came first, "summary" would get treated as a MongoDB
 * ObjectId and the request would fail with a CastError.
 */

const express = require("express");
const { body } = require("express-validator");

const {
  getBudgets,
  createOrUpdateBudget,
  deleteBudget,
  getBudgetSummary,
} = require("../controllers/budgetController");

const { protect } = require("../middleware/authMiddleware");
const { TRANSACTION_CATEGORIES } = require("../models/Transaction");

const router = express.Router();

// Protect every route in this file - no unauthenticated access
router.use(protect);

// --- Validation ---------------------------------------------------------------
// Used only on POST - PUT isn't needed here since the controller handles
// updating an existing budget if one already exists for that category/month
const budgetValidation = [
  body("category")
    .notEmpty()
    .withMessage("Category is required.")
    .isIn(TRANSACTION_CATEGORIES)
    .withMessage("Invalid category."),

  body("limit")
    .notEmpty()
    .withMessage("Limit is required.")
    .isNumeric()
    .withMessage("Limit must be a number.")
    .isFloat({ min: 1 })
    .withMessage("Limit must be at least ₹1."),

  // month and year default to the current month/year in the controller
  // if not provided, so these are truly optional
  body("month")
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage("Month must be between 1 and 12."),

  body("year")
    .optional()
    .isInt({ min: 2020 })
    .withMessage("Year must be 2020 or later."),
];

// --- Routes -------------------------------------------------------------------

// @route   GET /api/budgets/summary
// @desc    Get overall budget health stats for a given month (?month=&year=)
// @access  Private
router.get("/summary", getBudgetSummary);

// @route   GET /api/budgets
// @desc    Get all category budgets with actual spend totals for a given month
// @access  Private
router.get("/", getBudgets);

// @route   POST /api/budgets
// @desc    Create a budget for a category, or update it if one already exists
// @access  Private
router.post("/", budgetValidation, createOrUpdateBudget);

// @route   DELETE /api/budgets/:id
// @desc    Delete a budget entry by its MongoDB ObjectId
// @access  Private
router.delete("/:id", deleteBudget);

module.exports = router;

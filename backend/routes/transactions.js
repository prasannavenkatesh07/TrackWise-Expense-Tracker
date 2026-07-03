/**
 * routes/transactions.js
 *
 * Transaction routes - all mounted at /api/transactions (see server.js).
 * Every route requires a valid JWT via router.use(protect).
 *
 * Route ordering matters here: named routes like /quick-add, /summary,
 * /export etc. MUST be declared before /:id - otherwise Express sees
 * "summary" as an ObjectId param and throws a CastError.
 */

const express = require("express");
const { body } = require("express-validator");
const multer = require("multer");

const {
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
} = require("../controllers/transactionController");

const { protect } = require("../middleware/authMiddleware");
const {
  TRANSACTION_CATEGORIES,
  RECURRING_FREQUENCIES,
} = require("../models/Transaction");

const router = express.Router();

// Protect every route in this file
router.use(protect);

// --- Shared Field Validation --------------------------------------------------
// All fields are optional here so this can be reused for PUT (partial updates).
// The createRequiredValidation array below adds the required checks for POST.
const coreTransactionValidation = [
  body("title")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty.")
    .isLength({ min: 2 })
    .withMessage("Title must be at least 2 characters.")
    .isLength({ max: 100 })
    .withMessage("Title cannot exceed 100 characters."),
  body("amount")
    .optional()
    .isNumeric()
    .withMessage("Amount must be a number.")
    .isFloat({ min: 1 })
    .withMessage("Amount must be at least Rs.1."),
  body("type")
    .optional()
    .isIn(["Income", "Expense"])
    .withMessage("Type must be Income or Expense."),
  body("category")
    .optional()
    .isIn(TRANSACTION_CATEGORIES)
    .withMessage("Invalid category."),
  body("date")
    .optional()
    .isISO8601()
    .withMessage("Date must be a valid ISO 8601 string."),
  body("notes")
    .optional()
    .trim()
    .isLength({ max: 250 })
    .withMessage("Notes cannot exceed 250 characters."),
  body("isRecurring")
    .optional()
    .isBoolean()
    .withMessage("isRecurring must be a boolean."),
  body("recurringFrequency")
    .optional()
    .isIn(RECURRING_FREQUENCIES)
    .withMessage(
      `Frequency must be one of: ${RECURRING_FREQUENCIES.join(", ")}.`,
    ),
];

// These make title/amount/type/category required - only used on POST
const createRequiredValidation = [
  body("title").notEmpty().withMessage("Transaction title is required."),
  body("amount").notEmpty().withMessage("Amount is required."),
  body("type").notEmpty().withMessage("Type is required."),
  body("category").notEmpty().withMessage("Category is required."),
];

// Just validates the text field - the AI controller handles parsing the rest
const quickAddValidation = [
  body("text")
    .trim()
    .notEmpty()
    .withMessage("Input text is required.")
    .isLength({ min: 3 })
    .withMessage("Please provide at least 3 characters.")
    .isLength({ max: 500 })
    .withMessage("Input cannot exceed 500 characters."),
];

// --- Multer Setup (Receipt Image Uploads) -------------------------------------
// Storing files in memory as Buffers instead of writing to disk -
// they get converted to base64 and sent straight to Gemini Vision.
// This means no temp files to clean up, which keeps things simple.
// TODO: add a check for corrupted image buffers before sending to Gemini
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // hard cap at 5 MB
  fileFilter: (_req, file, cb) => {
    const ACCEPTED = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (ACCEPTED.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Unsupported file type. Please upload a JPEG, PNG, or WEBP image.",
        ),
      );
    }
  },
});

// --- Named Routes (must come before /:id) ------------------------------------

// @route   POST /api/transactions/quick-add
// @desc    Parse a natural language string into a transaction using Gemini
// @access  Private
router.post("/quick-add", quickAddValidation, parseQuickAdd);

// @route   GET /api/transactions/ai-report
// @desc    Generate a Gemini-powered monthly spending analysis report
// @access  Private
router.get("/ai-report", generateAIReport);

// @route   POST /api/transactions/scan-receipt
// @desc    Upload a receipt image and extract transaction data via Gemini Vision
// @access  Private
router.post("/scan-receipt", upload.single("receiptImage"), parseReceiptImage);

// @route   GET /api/transactions/summary
// @desc    Get total income, expenses, and balance (supports ?from=&to= filters)
// @access  Private
router.get("/summary", getSummary);

// @route   GET /api/transactions/insights
// @desc    Get category-level expense breakdown for charts
// @access  Private
router.get("/insights", getInsights);

// @route   GET /api/transactions/export
// @desc    Download all transactions as a CSV file
// @access  Private
router.get("/export", exportCSV);

// @route   GET /api/transactions/titles
// @desc    Autocomplete - returns matching transaction titles for a search query
// @access  Private
router.get("/titles", getTitleSuggestions);

// @route   GET /api/transactions/monthly
// @desc    Get income vs expense totals grouped by month for the reports chart
// @access  Private
router.get("/monthly", getMonthlyTrend);

// --- Collection Routes --------------------------------------------------------

// @route   GET /api/transactions
// @desc    Get all transactions for the logged-in user (supports filters + pagination)
// @access  Private
router.get("/", getAllTransactions);

// @route   POST /api/transactions
// @desc    Create a new transaction
// @access  Private
router.post(
  "/",
  [...createRequiredValidation, ...coreTransactionValidation],
  createTransaction,
);

// --- Resource Routes (after named routes) -------------------------------------

// @route   PUT /api/transactions/:id
// @desc    Edit an existing transaction by ID
// @access  Private
router.put("/:id", coreTransactionValidation, editTransaction);

// @route   DELETE /api/transactions/:id
// @desc    Delete a transaction by ID
// @access  Private
router.delete("/:id", deleteTransaction);

module.exports = router;

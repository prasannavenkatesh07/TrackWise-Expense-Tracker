/**
 * routes/transactions.js
 *
 * Transaction Routes — Extended in Phase A + AI Quick Add
 * Mounted at: /api/transactions  (see server.js)
 *
 * ALL routes require JWT authentication via router.use(protect).
 *
 * ⚠️ Route ordering: named routes (/quick-add, /ai-report, /scan-receipt, /summary, /insights, /export, /titles, /monthly)
 *    MUST appear BEFORE /:id so Express doesn't interpret them as ObjectId params.
 */

const express = require("express");
const { body } = require("express-validator");
const multer  = require("multer");

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

// Apply JWT protect to ALL routes in this router
router.use(protect);

// ─── Shared validation (all fields optional — used by PUT) ────────────────────
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

// Extra required validators for POST only
const createRequiredValidation = [
  body("title").notEmpty().withMessage("Transaction title is required."),
  body("amount").notEmpty().withMessage("Amount is required."),
  body("type").notEmpty().withMessage("Type is required."),
  body("category").notEmpty().withMessage("Category is required."),
];

// Validation for AI Quick Add — text field only, enums are enforced by the controller
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

// ─── Multer — memory storage for receipt image uploads ───────────────────────────
// Files are held in RAM as Buffer objects (req.file.buffer) and passed directly
// to Gemini as base64 inlineData — no disk I/O, no temp file cleanup needed.
// Accepted MIME types are validated here so invalid uploads are rejected before
// reaching the controller.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB hard ceiling
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

// ─── Named routes (before /:id) ────────────────────────────────────────────────
router.post("/quick-add", quickAddValidation, parseQuickAdd); // AI Quick Add — Gemini NLP
router.get("/ai-report", generateAIReport);                   // Sprint 2 — Gemini monthly report
router.post(                                                  // Sprint 3 — Gemini vision OCR
  "/scan-receipt",
  upload.single("receiptImage"),
  parseReceiptImage,
);
router.get("/summary", getSummary);
router.get("/insights", getInsights);
router.get("/export", exportCSV);
router.get("/titles", getTitleSuggestions); // Phase A — autocomplete
router.get("/monthly", getMonthlyTrend); // Phase A — reports chart data

// ─── Collection routes ─────────────────────────────────────────────────────────
router.get("/", getAllTransactions);
router.post(
  "/",
  [...createRequiredValidation, ...coreTransactionValidation],
  createTransaction,
);

// ─── Resource routes (after named routes) ─────────────────────────────────────
router.put("/:id", coreTransactionValidation, editTransaction); // Phase A
router.delete("/:id", deleteTransaction);

module.exports = router;
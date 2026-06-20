/**
 * routes/chat.js
 *
 * Financial Copilot Chat Routes — Sprint 4
 * Mounted at: /api/chat  (see server.js)
 *
 * ALL routes require JWT authentication via router.use(protect).
 *
 * Route map:
 * POST   /   → handleChat   (RAG chatbot — Gemini 2.5 Flash + sliding window memory)
 */

const express  = require("express");
const { body } = require("express-validator");

const { handleChat } = require("../controllers/chatController");
const { protect }    = require("../middleware/authMiddleware");

const router = express.Router();

// Apply JWT protect to ALL routes in this router
router.use(protect);

// ─── Validation ────────────────────────────────────────────────────────────────
const chatValidation = [
  body("message")
    .trim()
    .notEmpty()
    .withMessage("message is required.")
    .isLength({ max: 1000 })
    .withMessage("Message cannot exceed 1000 characters."),

  // history is optional — if present it must be an array
  body("history")
    .optional()
    .isArray()
    .withMessage("history must be an array."),

  // Each history entry must have a valid role
  body("history.*.role")
    .optional()
    .isIn(["user", "model"])
    .withMessage("Each history entry role must be 'user' or 'model'."),

  // Each history entry must have a non-empty text part
  body("history.*.parts")
    .optional()
    .isArray({ min: 1 })
    .withMessage("Each history entry must have at least one part."),
];

// ─── Routes ────────────────────────────────────────────────────────────────────
router.post("/", chatValidation, handleChat);

module.exports = router;
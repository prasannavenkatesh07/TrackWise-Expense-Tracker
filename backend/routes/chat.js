/**
 * routes/chat.js
 *
 * Financial Copilot chatbot route - mounted at /api/chat (see server.js).
 * Uses Gemini 2.5 Flash with a sliding window conversation history
 * so the model has context from previous messages in the session.
 *
 * All routes require a valid JWT via router.use(protect).
 */

const express = require("express");
const { body } = require("express-validator");

const { handleChat } = require("../controllers/chatController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Every chat request must be from a logged-in user
router.use(protect);

// --- Validation ---------------------------------------------------------------
const chatValidation = [
  body("message")
    .trim()
    .notEmpty()
    .withMessage("message is required.")
    .isLength({ max: 1000 })
    .withMessage("Message cannot exceed 1000 characters."),

  // The frontend sends conversation history so the model has context -
  // it's optional on the first message of a new session
  body("history").optional().isArray().withMessage("history must be an array."),

  // Each history item needs a role so the model knows who said what
  body("history.*.role")
    .optional()
    .isIn(["user", "model"])
    .withMessage("Each history entry role must be 'user' or 'model'."),

  body("history.*.parts")
    .optional()
    .isArray({ min: 1 })
    .withMessage("Each history entry must have at least one part."),
];

// --- Routes -------------------------------------------------------------------

// @route   POST /api/chat
// @desc    Send a message to the AI financial copilot and get a response
// @access  Private
router.post("/", chatValidation, handleChat);

module.exports = router;

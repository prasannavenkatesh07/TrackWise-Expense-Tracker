/**
 * routes/auth.js  (OTP Upgrade)
 */

const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const {
  register,
  verifyEmail,     // ✦ Newly added for OTP
  resendOTP,       // ✦ Newly added for Resend Code
  login,
  forgotPassword,
  resetPassword,
  googleLogin,
  getMe,
  updateBudget,
  updateProfile,
  changePassword,
  deleteAccount,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

// ── Validation rule sets ───────────────────────────────────────────────────
const registerValidation = [
  body("name")
    .trim()
    .notEmpty()
    .withMessage("Full name is required.")
    .isLength({ min: 2 })
    .withMessage("Name must be at least 2 characters.")
    .isLength({ max: 60 })
    .withMessage("Name cannot exceed 60 characters."),
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required.")
    .isEmail()
    .withMessage("Please provide a valid email address.")
    .normalizeEmail(),
  body("password")
    .notEmpty()
    .withMessage("Password is required.")
    .isLength({ min: 6 })
    .withMessage("Password must be at least 6 characters."),
  body("monthlyBudget")
    .optional()
    .isNumeric()
    .withMessage("Monthly budget must be a number.")
    .isFloat({ min: 1 })
    .withMessage("Monthly budget must be at least 1."),
];

const loginValidation = [
  body("email")
    .trim()
    .notEmpty()
    .withMessage("Email is required.")
    .isEmail()
    .withMessage("Please provide a valid email address.")
    .normalizeEmail(),
  body("password").notEmpty().withMessage("Password is required."),
];

// ── Public routes ──────────────────────────────────────────────────────────
router.post("/register", registerValidation, register);
router.post("/verify-email", verifyEmail);             // ✦ New route to handle OTP verification
router.post("/resend-otp", resendOTP);                 // ✦ New route to handle OTP resending
router.post("/login", loginValidation, login);
router.post("/forgotpassword", forgotPassword);
router.put("/reset-password", resetPassword);          // ✦ Updated to remove :token from URL
router.post("/google-login", googleLogin);

// ── Protected routes ───────────────────────────────────────────────────────
router.get("/me", protect, getMe);
router.put("/budget", protect, updateBudget);
router.put("/profile", protect, updateProfile);
router.put("/password", protect, changePassword);
router.delete("/account", protect, deleteAccount);

module.exports = router;
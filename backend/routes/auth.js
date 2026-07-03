/**
 * routes/auth.js
 *
 * All authentication-related routes - registration, OTP verification,
 * login, password reset, Google OAuth, and account management.
 *
 * Public routes don't need a token.
 * Protected routes run through the `protect` middleware first,
 * which verifies the JWT and attaches req.user before the controller runs.
 */

const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const {
  register,
  verifyEmail,
  resendOTP,
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

// --- Validation Rules ---------------------------------------------------------
// Keeping these as arrays so they're easy to reuse or extend later

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

// --- Public Routes ------------------------------------------------------------

// @route   POST /api/auth/register
// @desc    Register a new user and send OTP verification email
// @access  Public
router.post("/register", registerValidation, register);

// @route   POST /api/auth/verify-email
// @desc    Verify the 6-digit OTP sent to the user's email after registration
// @access  Public
router.post("/verify-email", verifyEmail);

// @route   POST /api/auth/resend-otp
// @desc    Resend a fresh OTP if the previous one expired
// @access  Public
router.post("/resend-otp", resendOTP);

// @route   POST /api/auth/login
// @desc    Authenticate user and return a signed JWT
// @access  Public
router.post("/login", loginValidation, login);

// @route   POST /api/auth/forgotpassword
// @desc    Send a password reset OTP to the user's email
// @access  Public
router.post("/forgotpassword", forgotPassword);

// @route   PUT /api/auth/reset-password
// @desc    Validate the reset OTP and save the new password
// @access  Public
// Note: keeping the token out of the URL so it doesn't end up in server logs
router.put("/reset-password", resetPassword);

// @route   POST /api/auth/google-login
// @desc    Verify a Google ID token and log in (or auto-register) the user
// @access  Public
router.post("/google-login", googleLogin);

// --- Protected Routes ---------------------------------------------------------
// All of these require a valid JWT in the Authorization header

// @route   GET /api/auth/me
// @desc    Return the currently logged-in user's profile data
// @access  Private
router.get("/me", protect, getMe);

// @route   PUT /api/auth/budget
// @desc    Update the user's overall monthly budget cap
// @access  Private
router.put("/budget", protect, updateBudget);

// @route   PUT /api/auth/profile
// @desc    Update name, email, or avatar
// @access  Private
router.put("/profile", protect, updateProfile);

// @route   PUT /api/auth/password
// @desc    Change password - requires the current password to confirm
// @access  Private
router.put("/password", protect, changePassword);

// @route   DELETE /api/auth/account
// @desc    Permanently delete the user's account and all associated data
// @access  Private
router.delete("/account", protect, deleteAccount);

module.exports = router;

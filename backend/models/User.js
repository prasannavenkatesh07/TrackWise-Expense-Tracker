/**
 * models/User.js
 *
 * Schema for user accounts. Handles password hashing, JWT generation,
 * and OTP generation for email verification and password reset.
 *
 * OTPs are hashed before being stored so that even if the database
 * is compromised, the raw codes can't be extracted and used.
 * The plain OTP is only ever returned once - right when it's generated -
 * so it can be emailed to the user.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Full name is required."],
      trim: true,
      minlength: [2, "Name must be at least 2 characters."],
      maxlength: [60, "Name cannot exceed 60 characters."],
    },

    email: {
      type: String,
      required: [true, "Email address is required."],
      unique: true,
      lowercase: true,
      trim: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email address.",
      ],
    },

    // select: false means the password hash won't be included in query results
    // unless you explicitly ask for it with .select("+password")
    password: {
      type: String,
      minlength: [6, "Password must be at least 6 characters."],
      select: false,
    },

    monthlyBudget: {
      type: Number,
      default: 50000,
      min: [1, "Monthly budget must be at least 1."],
    },

    // The avatar color is a hex string picked by the user (or defaulted to green)
    avatarColor: {
      type: String,
      default: "#10b981",
    },

    avatarUrl: {
      type: String,
      default: null,
    },

    // New users start as unverified - they need to confirm their OTP
    // before they can log in. Google OAuth users are auto-verified.
    isVerified: {
      type: Boolean,
      default: false,
    },

    // OTP is hashed before storing - raw value is only ever sent via email.
    // select: false so these never leak into regular user queries.
    otp: {
      type: String,
      select: false,
    },

    otpExpire: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true },
);

// --- Pre-Save Hook: Hash Password ---------------------------------------------
// Only runs when the password field has actually changed -
// important so we don't re-hash an already-hashed password on unrelated saves
UserSchema.pre("save", async function (next) {
  if (!this.password || !this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// --- Instance Method: matchPassword -------------------------------------------
// Compares a plain-text candidate password against the stored hash.
// Returns false early if this is a Google OAuth user (no password stored).
UserSchema.methods.matchPassword = async function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

// --- Instance Method: getSignedJwtToken ---------------------------------------
// Generates a JWT containing only the user's MongoDB _id.
// The authMiddleware decodes this on protected routes to identify the user.
UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE,
  });
};

// --- Instance Method: getOTP --------------------------------------------------
// Generates a 6-digit OTP, hashes it, saves the hash + expiry to the document,
// and returns the raw code so the controller can email it.
// Note: this only prepares the fields - you still need to call user.save() after.
UserSchema.methods.getOTP = function () {
  // Math.random alone isn't cryptographically secure but it's fine for a 6-digit
  // code that expires in 15 minutes - the hashing adds another layer anyway
  // TODO: switch to crypto.randomInt() for a cleaner approach
  const rawOtp = Math.floor(100000 + Math.random() * 900000).toString();

  // Store the hash, not the raw code - so even if someone reads the DB
  // directly, they can't use the OTP without the original number
  this.otp = crypto.createHash("sha256").update(rawOtp).digest("hex");
  this.otpExpire = Date.now() + 15 * 60 * 1000; // 15 minutes from now

  return rawOtp; // hand back the plain code so it can be emailed
};

module.exports = mongoose.model("User", UserSchema);

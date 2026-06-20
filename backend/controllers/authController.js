/**
 * controllers/authController.js  (OTP Upgrade & Premium Dark Navy Emails)
 */

const crypto = require("crypto");
const { validationResult } = require("express-validator");
const { OAuth2Client } = require("google-auth-library");
const nodemailer = require("nodemailer"); 
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Budget = require("../models/Budget");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── Helper: Send Email via Nodemailer ─────────────────────────────────────────
const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    service: "Gmail", 
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS, 
    },
  });

  const mailOptions = {
    from: `TrackWise <${process.env.EMAIL_USER}>`,
    to: options.email,
    subject: options.subject,
    html: options.html,
  };

  await transporter.sendMail(mailOptions);
};

// ── Helper: build and send the JWT response ───────────────────────────────────
const sendTokenResponse = (user, statusCode, res) => {
  const token = user.getSignedJwtToken();
  res.status(statusCode).json({
    success: true,
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      avatarColor: user.avatarColor,
      avatarUrl: user.avatarUrl,
      monthlyBudget: user.monthlyBudget,
      isVerified: user.isVerified,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   POST /api/auth/register
// ─────────────────────────────────────────────────────────────────────────────
const register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ success: false, message: errors.array()[0].msg });

    const { name, email, password, monthlyBudget } = req.body;

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (user.isVerified) {
        return res.status(409).json({ success: false, message: "An account with this email already exists." });
      }
      user.name = name;
      user.password = password;
      user.monthlyBudget = monthlyBudget || 50000;
    } else {
      user = new User({
        name,
        email: email.toLowerCase(),
        password,
        monthlyBudget: monthlyBudget || 50000,
        isVerified: false,
      });
    }

    const otp = user.getOTP();
    await user.save();

    const message = `
      <div style="font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 50px 20px;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          
          <div style="background-color: #0f172a; padding: 30px 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 1px;">TrackWise</h1>
            <p style="color: #10b981; font-size: 11px; font-weight: 700; letter-spacing: 2px; margin: 5px 0 0 0; text-transform: uppercase;">Expense Tracker</p>
          </div>

          <div style="padding: 40px 30px; text-align: center;">
            <h2 style="color: #334155; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 10px;">Verify your email</h2>
            <p style="color: #64748b; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
              You are just one step away from taking control of your expenses. Enter the code below to verify your account.
            </p>
            <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 28px 24px 20px 24px; margin-bottom: 30px;">
              <span style="font-size: 36px; font-weight: bold; color: #10b981; letter-spacing: 12px; font-family: monospace; display: inline-block; padding-left: 12px; line-height: 1; vertical-align: middle;">${otp}</span>
            </div>
            <p style="color: #94a3b8; font-size: 14px; margin-bottom: 30px;">
              This code is valid for <strong>15 minutes</strong>.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px 0;" />
            <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0;">
              If you didn't request this email, you can safely ignore it.
            </p>
            <p style="color: #64748b; font-size: 12px; margin-top: 8px;">
              &copy; ${new Date().getFullYear()} TrackWise
            </p>
          </div>
        </div>
      </div>
    `;

    try {
      await sendEmail({ email: user.email, subject: "TrackWise - Verify your email", html: message });
      res.status(200).json({ success: true, message: "Verification OTP sent to email." });
    } catch (error) {
      user.otp = undefined;
      user.otpExpire = undefined;
      await user.save({ validateBeforeSave: false });
      console.error("Email failed to send:", error);
      return res.status(500).json({ success: false, message: "Email could not be sent." });
    }
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   POST /api/auth/verify-email
// ─────────────────────────────────────────────────────────────────────────────
const verifyEmail = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp)
      return res.status(400).json({ success: false, message: "Email and OTP are required." });

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await User.findOne({
      email: email.toLowerCase(),
      otp: hashedOtp,
      otpExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP." });
    }

    user.isVerified = true;
    user.otp = undefined;
    user.otpExpire = undefined;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   POST /api/auth/resend-otp
// ─────────────────────────────────────────────────────────────────────────────
const resendOTP = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) 
      return res.status(400).json({ success: false, message: "Email is required." });

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) 
      return res.status(400).json({ success: false, message: "Account not found." });
      
    if (user.isVerified) 
      return res.status(400).json({ success: false, message: "This account is already verified. Please log in." });

    const otp = user.getOTP();
    await user.save({ validateBeforeSave: false });

    const message = `
      <div style="font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 50px 20px;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          
          <div style="background-color: #0f172a; padding: 30px 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 1px;">TrackWise</h1>
            <p style="color: #10b981; font-size: 11px; font-weight: 700; letter-spacing: 2px; margin: 5px 0 0 0; text-transform: uppercase;">Expense Tracker</p>
          </div>

          <div style="padding: 40px 30px; text-align: center;">
            <h2 style="color: #334155; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 10px;">New Verification Code</h2>
            <p style="color: #64748b; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
              You requested a new verification code. Enter the code below to verify your account.
            </p>
            <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 28px 24px 20px 24px; margin-bottom: 30px;">
              <span style="font-size: 36px; font-weight: bold; color: #10b981; letter-spacing: 12px; font-family: monospace; display: inline-block; padding-left: 12px; line-height: 1; vertical-align: middle;">${otp}</span>
            </div>
            <p style="color: #94a3b8; font-size: 14px; margin-bottom: 30px;">
              This code is valid for <strong>15 minutes</strong>.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px 0;" />
            <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0;">
              If you didn't request this email, you can safely ignore it.
            </p>
            <p style="color: #64748b; font-size: 12px; margin-top: 8px;">
              &copy; ${new Date().getFullYear()} TrackWise
            </p>
          </div>
        </div>
      </div>
    `;

    try {
      await sendEmail({ email: user.email, subject: "TrackWise - New Verification Code", html: message });
      res.status(200).json({ success: true, message: "A new verification code has been sent." });
    } catch (error) {
      user.otp = undefined;
      user.otpExpire = undefined;
      await user.save({ validateBeforeSave: false });
      console.error("Email failed to send:", error);
      return res.status(500).json({ success: false, message: "Email could not be sent." });
    }
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ success: false, message: errors.array()[0].msg });

    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ success: false, message: "Invalid email or password." });

    if (!user.isVerified)
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message: "Please verify your email address before logging in.",
      });

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   POST /api/auth/forgotpassword
// ─────────────────────────────────────────────────────────────────────────────
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email)
      return res.status(400).json({ success: false, message: "Email is required." });

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");

    if (!user)
      return res.status(200).json({ success: true, message: "If an account with that email exists, an OTP has been sent." });

    if (!user.password)
      return res.status(400).json({ success: false, message: "This account uses Google Sign-In. Please log in with Google." });

    const otp = user.getOTP();
    await user.save({ validateBeforeSave: false });

    const message = `
      <div style="font-family: 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 50px 20px;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0;">
          
          <div style="background-color: #0f172a; padding: 30px 20px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 1px;">TrackWise</h1>
            <p style="color: #10b981; font-size: 11px; font-weight: 700; letter-spacing: 2px; margin: 5px 0 0 0; text-transform: uppercase;">Expense Tracker</p>
          </div>

          <div style="padding: 40px 30px; text-align: center;">
            <h2 style="color: #334155; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 10px;">Password Reset Request</h2>
            <p style="color: #64748b; font-size: 16px; line-height: 1.5; margin-bottom: 30px;">
              We received a request to reset your password. Enter the code below to securely change it.
            </p>
            <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 28px 24px 20px 24px; margin-bottom: 30px;">
              <span style="font-size: 36px; font-weight: bold; color: #3b82f6; letter-spacing: 12px; font-family: monospace; display: inline-block; padding-left: 12px; line-height: 1; vertical-align: middle;">${otp}</span>
            </div>
            <p style="color: #94a3b8; font-size: 14px; margin-bottom: 30px;">
              This code is valid for <strong>15 minutes</strong>.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 0 0 20px 0;" />
            <p style="color: #64748b; font-size: 12px; line-height: 1.5; margin: 0;">
              If you didn't request this email, your account is safe and you can safely ignore it.
            </p>
            <p style="color: #64748b; font-size: 12px; margin-top: 8px;">
              &copy; ${new Date().getFullYear()} TrackWise
            </p>
          </div>
        </div>
      </div>
    `;

    try {
      await sendEmail({ email: user.email, subject: "TrackWise - Password Reset Code", html: message });
      return res.status(200).json({ success: true, message: "If an account with that email exists, an OTP has been sent." });
    } catch (error) {
      user.otp = undefined;
      user.otpExpire = undefined;
      await user.save({ validateBeforeSave: false });
      console.error("Password reset email failed:", error);
      return res.status(500).json({ success: false, message: "Email could not be sent." });
    }
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   PUT /api/auth/reset-password
// ─────────────────────────────────────────────────────────────────────────────
const resetPassword = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    const user = await User.findOne({
      email: email.toLowerCase(),
      otp: hashedOtp,
      otpExpire: { $gt: Date.now() },
    }).select("+password");

    if (!user)
      return res.status(400).json({ success: false, message: "Reset code is invalid or has expired." });

    user.password = newPassword;
    user.otp = undefined;
    user.otpExpire = undefined;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   POST /api/auth/google-login
// ─────────────────────────────────────────────────────────────────────────────
const googleLogin = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token)
      return res.status(400).json({ success: false, message: "Google credential token is required." });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      return res.status(401).json({ success: false, message: "Invalid Google token. Please try again." });
    }

    const { email, name, picture } = payload;

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (picture && !user.avatarUrl) {
        user.avatarUrl = picture;
        await user.save({ validateBeforeSave: false });
      }
      if (!user.isVerified) {
        user.isVerified = true;
        await user.save({ validateBeforeSave: false });
      }
    } else {
      user = await User.create({
        name: name,
        email: email.toLowerCase(),
        avatarUrl: picture || null,
        isVerified: true, // Google emails are pre-verified
      });
    }

    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────
const getMe = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, user: req.user });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   PUT /api/auth/budget
// ─────────────────────────────────────────────────────────────────────────────
const updateBudget = async (req, res, next) => {
  try {
    const { monthlyBudget } = req.body;
    if (!monthlyBudget || monthlyBudget < 1)
      return res.status(400).json({
        success: false,
        message: "Monthly budget must be at least 1.",
      });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { monthlyBudget },
      { new: true, runValidators: true },
    );

    res.status(200).json({
      success: true,
      message: "Monthly budget updated.",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        monthlyBudget: user.monthlyBudget,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   PUT /api/auth/profile
// ─────────────────────────────────────────────────────────────────────────────
const updateProfile = async (req, res, next) => {
  try {
    const { name, email, avatarColor, monthlyBudget } = req.body;

    if (email && email.toLowerCase() !== req.user.email) {
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing)
        return res.status(409).json({ success: false, message: "That email is already in use." });
    }

    const updates = {};
    if (name) updates.name = name.trim();
    if (email) updates.email = email.toLowerCase().trim();
    if (avatarColor) updates.avatarColor = avatarColor;
    if (monthlyBudget) updates.monthlyBudget = Number(monthlyBudget);

    const user = await User.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Profile updated.",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl,
        monthlyBudget: user.monthlyBudget,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   PUT /api/auth/password
// ─────────────────────────────────────────────────────────────────────────────
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ success: false, message: "Both current and new password are required." });
    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters." });
    if (currentPassword === newPassword)
      return res.status(400).json({ success: false, message: "New password must differ from current." });

    const user = await User.findById(req.user._id).select("+password");

    if (!user.password)
      return res.status(400).json({ success: false, message: "This account uses Google Sign-In and has no password." });

    if (!(await user.matchPassword(currentPassword)))
      return res.status(401).json({ success: false, message: "Current password is incorrect." });

    user.password = newPassword;
    await user.save();

    res.status(200).json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// @route   DELETE /api/auth/account
// ─────────────────────────────────────────────────────────────────────────────
const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id).select("+password");

    if (user.password) {
      if (!password)
        return res.status(400).json({ success: false, message: "Password is required to delete your account." });
      if (!(await user.matchPassword(password)))
        return res.status(401).json({ success: false, message: "Incorrect password." });
    }

    await Promise.all([
      Transaction.deleteMany({ user_id: req.user._id }),
      Budget.deleteMany({ user_id: req.user._id }),
      User.findByIdAndDelete(req.user._id),
    ]);

    res.status(200).json({ success: true, message: "Account permanently deleted." });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
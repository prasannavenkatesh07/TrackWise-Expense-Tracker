/**
 * server.js - Entry point for the Smart Expense Tracker API
 *
 * Sets up Express, connects to MongoDB, registers all routes,
 * and kicks off the recurring transaction cron job.
 *
 * MERN Data Flow:
 * React (Frontend) → Axios HTTP Request
 * → Express Router → Controller → Mongoose → MongoDB
 * MongoDB Response → JSON → React setState → UI re-render
 */

// Fixes an IPv6 crash on Render when SendGrid tries to resolve DNS
require("dns").setDefaultResultOrder("ipv4first");

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const morgan = require("morgan");
const dotenv = require("dotenv");
const rateLimit = require("express-rate-limit");

dotenv.config();

// --- Route Modules ------------------------------------------------------------
const authRoutes = require("./routes/auth");
const transactionRoutes = require("./routes/transactions");
const budgetRoutes = require("./routes/budgets");
const chatRoutes = require("./routes/chat");

// --- Recurring Cron Job -------------------------------------------------------
const { startRecurringJob } = require("./jobs/recurringJob");

// --- App Setup ----------------------------------------------------------------
const app = express();

// Needed so express-rate-limit reads the real client IP behind Render's proxy
app.set("trust proxy", 1);

// --- Core Middleware ----------------------------------------------------------
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow requests from the React frontend (Vite dev or deployed Vercel URL)
app.use(
  cors({
    // Checking both env variable names because the name changed at some point
    // and I want both local dev and production to work without touching this
    origin:
      process.env.CLIENT_URL ||
      process.env.CLIENT_ORIGIN ||
      "http://localhost:5173",
    credentials: true,
  }),
);

// Only log HTTP requests outside of test runs
if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

// --- Security Headers ---------------------------------------------------------
// Doing this manually instead of adding helmet as a dependency -
// these three are the most important ones for this kind of app.
// TODO: swap this out for helmet() before deploying to a real production environment
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// --- Rate Limiters ------------------------------------------------------------

// Applied to /api/auth/* - stops brute-force attacks on login/register
// 15 requests per 15 minutes per IP felt like a reasonable threshold
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many requests from this IP. Please wait 15 minutes and try again.",
  },
  skip: () => process.env.NODE_ENV === "test", // don't want this blocking test runs
});

// Applied to /api/transactions/quick-add - protects the Gemini API quota
// 10 requests per minute should be more than enough for normal usage
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many AI requests. Please wait a moment and try again.",
  },
});

// --- Health Check -------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "TrackWise API is running 🚀",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// --- Routes -------------------------------------------------------------------

// Auth routes with rate limiting applied
app.use("/api/auth", authLimiter, authRoutes);

// Attach the AI limiter to the quick-add route before the main transaction router
app.use("/api/transactions/quick-add", aiLimiter);

// All transaction routes - JWT protection is handled inside the router
app.use("/api/transactions", transactionRoutes);

// Budget routes - JWT protection is handled inside the router
app.use("/api/budgets", budgetRoutes);

// Chatbot routes - JWT protection is handled inside the router
app.use("/api/chat", chatRoutes);

// --- 404 Handler -------------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

// --- Global Error Handler -----------------------------------------------------
// Express treats a 4-parameter function as an error handler.
// Controllers call next(error) to hand off here instead of duplicating
// error-handling logic everywhere.
app.use((err, req, res, next) => {
  // eslint-disable-line no-unused-vars
  console.error("🔥 Unhandled Error:", err.stack || err.message);

  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res
      .status(422)
      .json({ success: false, message: messages.join(", ") });
  }
  if (err.name === "CastError")
    return res
      .status(400)
      .json({ success: false, message: "Invalid resource identifier." });
  if (err.name === "JsonWebTokenError")
    return res.status(401).json({ success: false, message: "Invalid token." });
  if (err.name === "TokenExpiredError")
    return res.status(401).json({
      success: false,
      message: "Token has expired. Please log in again.",
    });
  if (err.code === 11000) {
    // MongoDB throws this when a unique index is violated (e.g. duplicate email)
    const field = Object.keys(err.keyValue || {})[0] || "field";
    return res.status(409).json({
      success: false,
      message: `Duplicate value for ${field}. Please use a different value.`,
    });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// --- Database Connection ------------------------------------------------------
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅  MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌  MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

// --- Bootstrap ----------------------------------------------------------------
const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀  Server running on http://localhost:${PORT}`);
  });

  // Start the cron job only after the DB is ready - the job queries MongoDB,
  // so starting it before connecting would just crash immediately.
  // It also fires once on startup to catch anything that was due while the server was down.
  startRecurringJob();
});

module.exports = app;

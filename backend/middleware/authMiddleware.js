/**
 * middleware/authMiddleware.js
 *
 * JWT authentication middleware - the `protect` function runs before any
 * route handler that needs a logged-in user.
 *
 * What it does:
 *   1. Reads the Bearer token from the Authorization header
 *   2. Verifies the signature and expiry against JWT_SECRET
 *   3. Looks up the user by the ID embedded in the token payload
 *   4. Attaches the full user document to req.user so controllers
 *      can access req.user._id, req.user.name, etc. without another DB call
 *
 * MERN Data Flow:
 *   React sends: Authorization: Bearer <token>
 *   → protect() verifies → attaches req.user → controller runs
 *
 * Usage in routes:
 *   router.get('/me', protect, authController.getMe);
 *   router.use(protect); // applied to every route in the router
 */

const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  // The Authorization header should look like: "Bearer eyJhbGci..."
  // Splitting on the space gives us ["Bearer", "<token>"]
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  )
    token = req.headers.authorization.split(" ")[1];

  if (!token)
    return res.status(401).json({
      success: false,
      message: "Access denied. No token provided. Please log in.",
    });

  try {
    // jwt.verify throws automatically if the token is expired or has an invalid signature -
    // no need to manually check the expiry date
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch the user to make sure the account still exists.
    // The password field is already select:false in the schema, but being explicit
    // here makes the intent clearer when someone reads this code later.
    const currentUser = await User.findById(decoded.id).select("-password");

    if (!currentUser)
      return res.status(401).json({
        success: false,
        message: "The user belonging to this token no longer exists.",
      });

    // Attach to req so every downstream controller can access the logged-in user
    // without making another DB call
    req.user = currentUser;
    next();
  } catch (error) {
    // Handle the two most common JWT errors with specific messages -
    // the global error handler in server.js would catch these too,
    // but specific messages here are clearer for the frontend to handle

    if (error.name === "TokenExpiredError")
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again.",
      });

    if (error.name === "JsonWebTokenError")
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token. Please log in again.",
      });

    // Fallback for anything unexpected - shouldn't really reach here
    return res
      .status(401)
      .json({ success: false, message: "Authentication failed." });
  }
};

module.exports = { protect };

/**
 * config/db.js
 *
 * Separates the MongoDB connection logic from server.js so that file
 * doesn't become a kitchen sink of setup code. Follows the MVC
 * separation of concerns principle covered in the module spec.
 *
 * Called once in server.js after dotenv loads the environment:
 *   const connectDB = require('./config/db');
 *   connectDB();
 */

const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅  MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌  MongoDB connection error: ${error.message}`);
    // Exit the process - there's no point running an API with no database
    process.exit(1);
  }
};

module.exports = connectDB;

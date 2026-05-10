const mongoose = require("mongoose");

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.warn("⚠️ MONGO_URI is missing. SaaS database features will not work.");
    return;
  }

  await mongoose.connect(uri);
  console.log("✅ MongoDB connected");
}

module.exports = connectDB;

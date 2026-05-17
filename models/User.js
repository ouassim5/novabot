const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      enum: ["free", "pro"],
      default: "free",
    },
    planExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userSchema.statics.createWithPassword = async function createWithPassword(email, password) {
  const passwordHash = await bcrypt.hash(password, 12);
  return this.create({ email, passwordHash });
};

userSchema.methods.comparePassword = function comparePassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

module.exports = mongoose.model("User", userSchema);

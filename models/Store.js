const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    storeName: {
      type: String,
      required: true,
      trim: true,
    },
    botName: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    whatsappPhone: {
      type: String,
      required: true,
      trim: true,
    },
    ultraMsgInstanceId: {
      type: String,
      trim: true,
      index: true,
      default: "",
    },
    whatsappStatus: {
      type: String,
      enum: ["not_configured", "qr", "authenticated", "disconnected", "unknown"],
      default: "not_configured",
    },
    prompt: {
      type: String,
      required: true,
    },
    suggestions: {
      type: [String],
      default: [],
    },
    colors: {
      primary: { type: String, default: "#d4af37" },
      background: { type: String, default: "#0a0800" },
    },
    emoji: {
      type: String,
      default: "🤖",
    },
    totalMessages: {
      type: Number,
      default: 0,
    },
    totalOrders: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Store", storeSchema);

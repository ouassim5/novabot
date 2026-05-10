const mongoose = require("mongoose");

const analyticsSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    date: {
      type: Date,
      required: true,
      index: true,
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    orderCount: {
      type: Number,
      default: 0,
    },
    conversationIds: {
      type: [String],
      default: [],
    },
    questionCounts: {
      type: Map,
      of: Number,
      default: {},
    },
  },
  { timestamps: true }
);

analyticsSchema.index({ storeId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Analytics", analyticsSchema);

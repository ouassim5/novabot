const Analytics = require("../models/Analytics");

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function startOfTomorrow() {
  const today = startOfToday();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
}

function normalizeQuestion(text) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 180);
}

function toSafeMapKey(value) {
  return value.replace(/[.$]/g, " ");
}

async function updateDailyAnalytics(storeId, options = {}) {
  const {
    conversationId,
    question,
    messageIncrement = 0,
    orderIncrement = 0,
  } = options;

  const date = startOfToday();
  const update = {
    $inc: {
      messageCount: messageIncrement,
      orderCount: orderIncrement,
    },
    $setOnInsert: { storeId, date },
  };

  if (conversationId) {
    update.$addToSet = { conversationIds: conversationId };
  }

  const cleanQuestion = normalizeQuestion(question);
  if (cleanQuestion) {
    update.$inc[`questionCounts.${toSafeMapKey(cleanQuestion)}`] = 1;
  }

  return Analytics.findOneAndUpdate(
    { storeId, date },
    update,
    { upsert: true, new: true }
  );
}

async function getTodayAnalytics(storeId) {
  return Analytics.findOne({
    storeId,
    date: startOfToday(),
  });
}

function getTopQuestion(analytics) {
  if (!analytics?.questionCounts) return "لا توجد أسئلة بعد";

  const entries = analytics.questionCounts instanceof Map
    ? [...analytics.questionCounts.entries()]
    : Object.entries(analytics.questionCounts);

  if (!entries.length) return "لا توجد أسئلة بعد";
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

module.exports = {
  startOfToday,
  startOfTomorrow,
  updateDailyAnalytics,
  getTodayAnalytics,
  getTopQuestion,
};

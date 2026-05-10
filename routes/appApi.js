const express = require("express");
const Store = require("../models/Store");
const Analytics = require("../models/Analytics");
const Order = require("../models/Order");
const { getTopQuestion, startOfToday } = require("../utils/analytics");
const slugify = require("../utils/slug");
const {
  getInstancePool,
  getInstanceStatus,
  getQrImage,
  updateWebhook,
} = require("../services/ultramsg");

const router = express.Router();

function requireApiAuth(req, res, next) {
  if (req.user) return next();
  return res.status(401).json({ error: "Authentication required" });
}

async function uniqueSlug(name, currentStoreId) {
  const base = slugify(name);
  let slug = base;
  let index = 2;

  while (await Store.exists({ slug, _id: { $ne: currentStoreId } })) {
    slug = `${base}-${index}`;
    index += 1;
  }

  return slug;
}

function parseSuggestions(value) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean).slice(0, 8);
  return String(value || "")
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

async function findOwnedStore(req, res, next) {
  const store = await Store.findOne({
    _id: req.params.storeId,
    userId: req.user._id,
  });
  if (!store) return res.status(404).json({ error: "Store not found" });
  req.store = store;
  next();
}

async function assignInstanceIfNeeded(store) {
  if (store.ultraMsgInstanceId) return store.ultraMsgInstanceId;

  const pool = getInstancePool();
  if (!pool.length) throw new Error("ULTRAMSG_INSTANCE_POOL is empty");

  const used = await Store.distinct("ultraMsgInstanceId", {
    ultraMsgInstanceId: { $in: pool },
    _id: { $ne: store._id },
  });
  const available = pool.find(instanceId => !used.includes(instanceId));
  if (!available) throw new Error("No free UltraMsg instance available");

  store.ultraMsgInstanceId = available;
  store.whatsappStatus = "qr";
  await store.save();
  return available;
}

function serializeStore(store, analytics) {
  return {
    id: store._id.toString(),
    slug: store.slug,
    storeName: store.storeName,
    botName: store.botName,
    whatsappPhone: store.whatsappPhone,
    ultraMsgInstanceId: store.ultraMsgInstanceId,
    whatsappStatus: store.whatsappStatus,
    prompt: store.prompt,
    suggestions: store.suggestions,
    colors: store.colors,
    emoji: store.emoji,
    totalMessages: store.totalMessages,
    totalOrders: store.totalOrders,
    todayMessages: analytics?.messageCount || 0,
    todayOrders: analytics?.orderCount || 0,
    todayConversations: analytics?.conversationIds?.length || 0,
    topQuestion: getTopQuestion(analytics),
  };
}

router.use(requireApiAuth);

router.get("/app", async (req, res) => {
  const stores = await Store.find({ userId: req.user._id }).sort({ createdAt: -1 });
  const analyticsRows = await Analytics.find({
    storeId: { $in: stores.map(store => store._id) },
    date: startOfToday(),
  });
  const analyticsByStore = new Map(analyticsRows.map(row => [row.storeId.toString(), row]));
  const orders = await Order.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(20);

  res.json({
    user: { email: req.user.email },
    stores: stores.map(store => serializeStore(store, analyticsByStore.get(store._id.toString()))),
    orders,
    baseUrl: process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`,
  });
});

router.post("/stores", async (req, res) => {
  const storeName = String(req.body.storeName || "متجري").trim();
  const botName = String(req.body.botName || "NovaBOT").trim();
  const whatsappPhone = String(req.body.whatsappPhone || "").trim();
  const prompt = String(req.body.prompt || "").trim();

  if (!storeName || !botName || !whatsappPhone || !prompt) {
    return res.status(400).json({ error: "اسم المتجر، اسم البوت، رقم واتساب والـ Prompt مطلوبة." });
  }

  const store = await Store.create({
    userId: req.user._id,
    storeName,
    botName,
    whatsappPhone,
    slug: await uniqueSlug(storeName),
    prompt,
    suggestions: parseSuggestions(req.body.suggestions),
    colors: {
      primary: req.body.primaryColor || "#d4af37",
      background: req.body.backgroundColor || "#050505",
    },
    emoji: req.body.emoji || "🤖",
  });

  res.status(201).json({ store: serializeStore(store) });
});

router.put("/stores/:storeId/settings", findOwnedStore, async (req, res) => {
  const storeName = String(req.body.storeName || req.store.storeName).trim();
  req.store.storeName = storeName;
  req.store.botName = String(req.body.botName || req.store.botName).trim();
  req.store.whatsappPhone = String(req.body.whatsappPhone || req.store.whatsappPhone).trim();
  req.store.prompt = String(req.body.prompt || req.store.prompt).trim();
  req.store.suggestions = parseSuggestions(req.body.suggestions);
  req.store.colors = {
    primary: req.body.primaryColor || req.store.colors?.primary || "#d4af37",
    background: req.body.backgroundColor || req.store.colors?.background || "#050505",
  };
  req.store.emoji = String(req.body.emoji || req.store.emoji || "🤖").trim();
  req.store.slug = await uniqueSlug(storeName, req.store._id);
  await req.store.save();
  res.json({ store: serializeStore(req.store) });
});

router.post("/stores/:storeId/whatsapp/sync", findOwnedStore, async (req, res) => {
  try {
    const instanceId = await assignInstanceIfNeeded(req.store);
    const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
    const webhookUrl = `${baseUrl}/webhook/instance/${encodeURIComponent(instanceId)}`;
    const result = await updateWebhook(instanceId, webhookUrl);
    res.json({ instanceId, webhookUrl, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/stores/:storeId/whatsapp/qr", findOwnedStore, async (req, res) => {
  try {
    const instanceId = await assignInstanceIfNeeded(req.store);
    const qr = await getQrImage(instanceId);
    res.set("Content-Type", qr.contentType);
    res.send(qr.buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/stores/:storeId/whatsapp/status", findOwnedStore, async (req, res) => {
  try {
    const instanceId = await assignInstanceIfNeeded(req.store);
    const rawStatus = await getInstanceStatus(instanceId);
    const status = rawStatus.status?.accountStatus?.status || rawStatus.status?.status || rawStatus.status || "unknown";
    req.store.whatsappStatus = ["qr", "authenticated", "disconnected"].includes(status) ? status : "unknown";
    await req.store.save();
    res.json({ instanceId, status: req.store.whatsappStatus, raw: rawStatus });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;

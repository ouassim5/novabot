// ============================================================
// NovaBOT — Unified Core Server
// ============================================================
// لإضافة ميزة جديدة للشات: ابحث عن تعليق "// ★ FEATURE SLOT"
// لإضافة route جديد: ابحث عن "// ★ ROUTE SLOT"
// لإضافة middleware: ابحث عن "// ★ MIDDLEWARE SLOT"
// ============================================================

const fetch        = require("node-fetch");
require("dotenv").config();
const express      = require("express");
const cors         = require("cors");
const path         = require("path");
const cookieParser = require("cookie-parser");
const { google }   = require("googleapis");

// ── Config & Models ──────────────────────────────────────────
const connectDB              = require("./config/db");
const Store                  = require("./models/Store");
const Order                  = require("./models/Order");

// ── Routes ───────────────────────────────────────────────────
const authRoutes      = require("./routes/auth");
const appApiRoutes    = require("./routes/appApi");
const dashboardRoutes = require("./routes/dashboard");

// ── Middleware ───────────────────────────────────────────────
const { attachUser }            = require("./middleware/auth");
const { updateDailyAnalytics }  = require("./utils/analytics");
const { incrementStoreMessages, incrementStoreOrders } = require("./middleware/storeAnalytics");
const { sendMessage: sendWhatsApp } = require("./services/ultramsg");

// ★ MIDDLEWARE SLOT — أضف هنا أي middleware إضافي

// ============================================================
const app = express();

// ── Core Middleware ───────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Static Files (Absolute Path — يعمل على Railway وLocally) ─
app.use(express.static(path.join(__dirname, "public")));

// ── View Engine (Absolute Path) ───────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ── Attach User ───────────────────────────────────────────────
app.use(attachUser);

// ── Routes ────────────────────────────────────────────────────
app.use("/auth", authRoutes);
app.use("/api",  appApiRoutes);
app.use("/dashboard", dashboardRoutes);

// ★ ROUTE SLOT — أضف هنا routes جديدة
// مثال: app.use("/billing", require("./routes/billing"));


// ============================================================
// Google Sheets
// ============================================================
const SHEET_ID   = process.env.SHEET_ID   || "";
const SHEET_NAME = process.env.SHEET_NAME || "جدول الطلبات";
const savedKeys  = new Set();

async function getSheets() {
  if (!process.env.GOOGLE_CREDENTIALS) return null;
  try {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, "\n");
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
  } catch { return null; }
}

async function saveOrderToSheets(data) {
  const key = `${data.phone}-${data.product}`;
  if (savedKeys.has(key)) return;
  savedKeys.add(key);
  setTimeout(() => savedKeys.delete(key), 30 * 60 * 1000);

  const sheets = await getSheets();
  if (!sheets || !SHEET_ID) return;

  try {
    const time = new Date().toLocaleString("ar-DZ", { timeZone: "Africa/Algiers" });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[time, data.phone, data.name, data.product, data.address, data.notes || "", data.storeName]],
      },
    });
    console.log(`📋 Sheets: ${data.name} — ${data.product}`);
  } catch (err) {
    console.error("Sheets error:", err.message);
  }
}

// ============================================================
// AI Core — Groq
// ============================================================
async function askGroq(systemPrompt, messages) {
  // ★ FEATURE SLOT — يمكن تغيير النموذج هنا
  // أو إضافة RAG / Context قبل الإرسال
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: 500,
      temperature: 0.7,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "عذراً، حاول مرة أخرى.";
}

// ============================================================
// Order Detection — كشف الطلبات تلقائياً
// ============================================================
async function detectOrder(storeName, phone, messages) {
  // ★ FEATURE SLOT — يمكن تحسين منطق الكشف هنا
  const last6 = messages.slice(-6);
  const convo  = last6.map(m => `${m.role === "user" ? "زبون" : "بوت"}: ${m.content}`).join("\n");

  const prompt = `تحليل المحادثة واستخراج معلومات الطلب إن وُجد طلب مكتمل.
أجب بـ JSON فقط: {"hasOrder":true/false,"name":"","product":"","address":"","notes":""}
إذا لم يكتمل: {"hasOrder":false}
المحادثة:\n${convo}`;

  try {
    const raw   = await askGroq(prompt, [{ role: "user", content: "استخرج الطلب" }]);
    const clean = raw.replace(/```json|```/g, "").trim();
    const order = JSON.parse(clean);
    if (order.hasOrder && order.name && order.product) {
      await saveOrderToSheets({ phone, storeName, ...order });
      return true;
    }
  } catch { /* تجاهل أخطاء الكشف */ }
  return false;
}

// ============================================================
// WhatsApp Webhook — استقبال الرسائل
// ============================================================
const conversations = {};

async function handleWebhook(req, res) {
  res.sendStatus(200);

  const raw  = req.body;
  const data = raw?.data || raw;

  // ★ FEATURE SLOT — يمكن إضافة فلاتر إضافية هنا
  if (!data || data.type !== "chat" || data.fromMe) return;
  if (data.from?.includes("@g.us")) return;

  const sender = data.from;
  const text   = (data.body || "").trim();
  if (!text) return;

  // ── تحديد المتجر حسب instanceId أو storeId ──
  const instanceId = req.params.instanceId || req.params.storeId;
  let store = null;

  if (instanceId) {
    store = await Store.findOne({ ultraMsgInstanceId: instanceId }).catch(() => null);
    if (!store) store = await Store.findById(instanceId).catch(() => null);
  }

  if (!store) {
    store = await Store.findOne({ ultraMsgInstanceId: { $exists: true, $ne: "" } })
      .sort({ updatedAt: -1 }).catch(() => null);
  }

  if (!store) { console.log("⚠️ No store found for webhook"); return; }

  console.log(`📨 [${store.storeName}] من ${sender}: ${text}`);

  // ── إدارة تاريخ المحادثة ──
  const convKey = `${store._id}-${sender}`;
  if (!conversations[convKey]) conversations[convKey] = [];
  conversations[convKey].push({ role: "user", content: text });
  if (conversations[convKey].length > 12) conversations[convKey] = conversations[convKey].slice(-12);

  // ── إحصائيات ──
  await incrementStoreMessages(store._id).catch(() => {});
  await updateDailyAnalytics(store._id, {
    conversationId: sender,
    question: text,
    messageIncrement: 1,
  }).catch(() => {});

  try {
    const reply = await askGroq(store.prompt, conversations[convKey]);
    conversations[convKey].push({ role: "assistant", content: reply });

    // ── كشف وحفظ الطلب ──
    const isOrder = await detectOrder(store.storeName, sender, conversations[convKey]);
    if (isOrder) {
      await incrementStoreOrders(store._id).catch(() => {});
      await updateDailyAnalytics(store._id, { orderIncrement: 1 }).catch(() => {});
    }

    // ── إرسال الرد ──
    await sendWhatsApp(store.ultraMsgInstanceId, sender, reply);
    console.log(`✅ [${store.storeName}] رد: ${reply.slice(0, 60)}...`);

    // ★ FEATURE SLOT — يمكن إضافة منطق بعد الرد هنا
    // مثال: إرسال إشعار لصاحب المتجر

  } catch (err) {
    console.error(`❌ Webhook error: ${err.message}`);
    await sendWhatsApp(store.ultraMsgInstanceId, sender, "عذراً، حدث خطأ مؤقت. حاول مرة أخرى.").catch(() => {});
  }
}

// ── Webhook Routes (الأكثر تحديداً أولاً) ────────────────────
app.post("/webhook/instance/:instanceId", handleWebhook);
app.post("/webhook/store/:storeId",       handleWebhook);
app.post("/webhook/:storeId",             handleWebhook);
app.post("/webhook",                      handleWebhook);

// ============================================================
// Chatbot Widget — /store/:slug (للموقع)
// ============================================================
app.post("/store/:slug/chat", async (req, res) => {
  // ★ FEATURE SLOT — يمكن إضافة rate limiting هنا
  const { messages, phone } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "messages required" });

  const store = await Store.findOne({ slug: req.params.slug }).catch(() => null);
  if (!store) return res.status(404).json({ error: "Store not found" });

  try {
    const reply = await askGroq(store.prompt, messages);
    const all   = [...messages, { role: "assistant", content: reply }];
    await detectOrder(store.storeName, phone || "web", all);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Pages
// ============================================================

// الصفحة الرئيسية — Landing Page
app.get("/", (req, res) => {
  res.render("landing", { user: req.user || null });
});

// لوحة التحكم — SPA
app.get("/app", (req, res) => {
  if (!req.user) return res.redirect("/auth/login");
  res.render("app", { user: req.user });
});

// Store Widget Page
app.get("/store/:slug", async (req, res) => {
  const store = await Store.findOne({ slug: req.params.slug }).catch(() => null);
  if (!store) return res.status(404).send("متجر غير موجود");
  res.render("store-widget", {
    storeName: store.storeName,
    botName:   store.botName,
    emoji:     store.emoji,
    color:     store.colors?.primary || "#d4af37",
    bg:        store.colors?.background || "#0a0800",
    suggestions: store.suggestions || [],
    slug:      store.slug,
  });
});

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

// ★ ROUTE SLOT — أضف صفحات جديدة هنا

// ============================================================
// Start
// ============================================================
const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n✅ NovaBOT SaaS — http://localhost:${PORT}`);
      console.log(`   /app       → لوحة التحكم`);
      console.log(`   /auth      → التسجيل والدخول`);
      console.log(`   /api       → API الرئيسي`);
      console.log(`   /webhook   → استقبال واتساب\n`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB failed:", err.message);
    process.exit(1);
  });
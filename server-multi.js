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
const Product                = require("./models/Product");

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

// ★ FEATURE SLOT — Transcribe Audio via Groq Whisper (Feature 1)
async function transcribeAudio(mediaUrl) {
  try {
    // استخدام fetch المدمج في Node.js لدعم FormData بشكل صحيح
    const mediaRes = await global.fetch(mediaUrl);
    const arrayBuffer = await mediaRes.arrayBuffer();
    
    const formData = new global.FormData();
    // رسائل الواتساب الصوتية عادة تكون بصيغة ogg
    const blob = new Blob([arrayBuffer], { type: 'audio/ogg' }); 
    formData.append("file", blob, "audio.ogg");
    formData.append("model", "whisper-large-v3");

    const groqRes = await global.fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: formData
    });

    const data = await groqRes.json();
    if (data.error) throw new Error(data.error.message);
    
    console.log(`🎙️ Transcription: ${data.text}`);
    return data.text || "";
  } catch (err) {
    console.error("❌ Transcribe error:", err.message);
    return "";
  }
}

// ★ FEATURE SLOT — اللهجة الجزائرية (Feature 2)
function enrichPromptWithDarija(prompt) {
  const darijaSuffix = `
تحدث دائماً بالدارجة الجزائرية الطبيعية.
فهم هذه الكلمات: واش=هل، كيفاه=كيف، 
بزاف=كثير، قداه=كم، شحال=كم، 
ماكانش=لا يوجد، كاين=يوجد، راني=أنا،
نحب=أريد، وين=أين، علاش=لماذا`;
  return prompt + "\n\n--- قواعد إضافية ---\n" + darijaSuffix;
}

async function getStoreCatalog(storeId) {
  try {
    const products = await Product.find({ storeId });
    if (!products.length) return "";
    return "\n\n--- قائمة المنتجات المتاحة ---\n" + products.map(p => `- المنتج: ${p.name} | السعر: ${p.price} دج | ${p.description}`).join("\n");
  } catch (err) {
    return "";
  }
}

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

// ★ FEATURE 4 — إشعار صاحب المتجر
async function notifyOwner(store, orderData) {
  if (!store.whatsappPhone || !store.ultraMsgInstanceId) return;
  
  let ownerPhone = store.whatsappPhone.trim().replace(/\+/g, "");
  if (!ownerPhone.endsWith("@c.us")) {
    ownerPhone += "@c.us";
  }

  const text = `🛍️ *طلب جديد!*\n\n👤 *الاسم:* ${orderData.name}\n📦 *المنتج:* ${orderData.product}\n📍 *العنوان:* ${orderData.address}\n📞 *رقم الزبون:* ${orderData.phone}\n📝 *ملاحظات:* ${orderData.notes || "لا توجد"}`;
  
  try {
    await sendWhatsApp(store.ultraMsgInstanceId, ownerPhone, text);
    console.log(`📲 إشعار مرسل للتاجر: ${store.storeName}`);
  } catch (err) {
    console.error("Owner notification error:", err.message);
  }
}

async function detectOrder(store, phone, messages) {
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
      await saveOrderToSheets({ phone, storeName: store.storeName, ...order });
      await notifyOwner(store, { phone, ...order });
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
  if (!data || data.fromMe) return;
  // دعم الرسائل النصية والصوتية (audio للرسائل الصوتية المرفوعة، ptt لرسائل الـ Voice Note)
  if (data.type !== "chat" && data.type !== "audio" && data.type !== "ptt") return;
  if (data.from?.includes("@g.us")) return;

  const sender = data.from;
  let text = "";

  if (data.type === "chat") {
    text = (data.body || "").trim();
  } else if (data.type === "audio" || data.type === "ptt") {
    // استخراج رابط الملف الصوتي المرسل من UltraMsg
    const mediaUrl = data.media;
    if (!mediaUrl) return;
    // تحويل الصوت إلى نص باستخدام Groq Whisper
    text = await transcribeAudio(mediaUrl);
  }

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
  const analytics = await updateDailyAnalytics(store._id, {
    conversationId: sender,
    question: text,
    messageIncrement: 1,
  }).catch(() => null);

  // ── فحص الحد الأقصى للرسائل (خطة مجانية) ──
  try {
    const User = require("./models/User");
    const user = await User.findById(store.userId);
    if (user && user.plan === "free" && analytics && analytics.messageCount > 100) {
      await sendWhatsApp(store.ultraMsgInstanceId, sender, "عذراً، استنفد هذا المتجر رصيد رسائله المجانية لليوم. يرجى من صاحب المتجر ترقية الاشتراك.");
      return;
    }
  } catch (err) {
    console.error("Plan check error:", err);
  }

  try {
    const catalog = await getStoreCatalog(store._id);
    const finalPrompt = enrichPromptWithDarija(store.prompt) + catalog;
    const reply = await askGroq(finalPrompt, conversations[convKey]);
    conversations[convKey].push({ role: "assistant", content: reply });

    // ── كشف وحفظ الطلب ──
    const isOrder = await detectOrder(store, sender, conversations[convKey]);
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
    const catalog = await getStoreCatalog(store._id);
    const finalPrompt = enrichPromptWithDarija(store.prompt) + catalog;
    const reply = await askGroq(finalPrompt, messages);
    const all   = [...messages, { role: "assistant", content: reply }];
    await detectOrder(store, phone || "web", all);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Pages
// ============================================================

// الصفحة الرئيسية الموحدة (التسويق أو لوحة التحكم)
app.get("/", (req, res) => {
  if (req.user) {
    res.render("app", { user: req.user });
  } else {
    const loginError = req.query.loginError || "";
    const signupError = req.query.signupError || "";
    res.render("landing", { user: null, loginError, signupError });
  }
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
// Telegram Bot Integration
// ============================================================
const TelegramBot = require('node-telegram-bot-api');
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

if (telegramToken) {
  const telegramBot = new TelegramBot(telegramToken, { polling: true });
  
  telegramBot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    
    if (!text) return;
    
    let store = await Store.findOne({ ultraMsgInstanceId: { $exists: true, $ne: "" } }).sort({ updatedAt: -1 }).catch(() => null);
    if (!store) {
      store = await Store.findOne().sort({ updatedAt: -1 }).catch(() => null);
    }
    if (!store) return telegramBot.sendMessage(chatId, "عذراً، البوت غير مرتبط بأي متجر حالياً.");
    
    console.log(`📨 [${store.storeName} - Telegram] من ${chatId}: ${text}`);

    const sender = `tg_${chatId}`;
    const convKey = `${store._id}-${sender}`;
    if (!conversations[convKey]) conversations[convKey] = [];
    conversations[convKey].push({ role: "user", content: text });
    if (conversations[convKey].length > 12) conversations[convKey] = conversations[convKey].slice(-12);

    try {
      const catalog = await getStoreCatalog(store._id);
      const finalPrompt = enrichPromptWithDarija(store.prompt) + catalog;
      const reply = await askGroq(finalPrompt, conversations[convKey]);
      conversations[convKey].push({ role: "assistant", content: reply });

      const isOrder = await detectOrder(store, sender, conversations[convKey]);
      if (isOrder) {
        await incrementStoreOrders(store._id).catch(() => {});
        await updateDailyAnalytics(store._id, { orderIncrement: 1 }).catch(() => {});
      }

      await telegramBot.sendMessage(chatId, reply);
      console.log(`✅ [${store.storeName} - Telegram] رد: ${reply.slice(0, 60)}...`);
    } catch (err) {
      console.error("Telegram bot error:", err.message);
      await telegramBot.sendMessage(chatId, "عذراً، حدث خطأ مؤقت. حاول مرة أخرى.");
    }
  });
}

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
      console.log(`   /webhook   → استقبال واتساب`);
      if (telegramToken) console.log(`   [Telegram] → يعمل وينتظر الرسائل`);
      console.log(`\n`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB failed:", err.message);
    process.exit(1);
  });
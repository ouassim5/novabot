const fetch = require("node-fetch");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// SYSTEM PROMPT للـ Chatbot والواتساب (نفس البيانات)
// ============================================================
const SYSTEM_PROMPT = `أنت مساعد آلي لمتجر "نور للعباءات". مهمتك الوحيدة هي مساعدة الزبائن.

قواعد صارمة:
1. أجب فقط بناءً على المعلومات أدناه
2. إذا سألك عن شيء غير موجود قل: "سأحيلك لصاحب المتجر"
3. لا تخترع معلومات
4. اكتب بالعربية دائماً
5. الردود قصيرة (3 أسطر max)

المنتجات والأسعار:
- عباءة سادة: 3500 دج (ألوان: أسود، كحلي، بني)
- عباءة مطرزة: 5500 دج (ألوان: أسود، بورجندي)
- عباءة كريب: 4200 دج (ألوان: أسود، رمادي)
- حجاب شيفون: 800 دج (ألوان متعددة)

المقاسات المتوفرة: S - M - L - XL - XXL

التوصيل:
- داخل الولاية: 400 دج ← يوم واحد
- خارج الولاية: 600 دج ← يومين
- مجاني عند الشراء فوق 10,000 دج

الدفع: نقداً عند الاستلام فقط

الطلب يكون هكذا:
الاسم + رقم الهاتف + العنوان + المنتج + المقاس + اللون

أوقات الرد: 8 صباحاً إلى 10 مساءً`;

// ============================================================
// إعدادات UltraMsg
// ============================================================
const ULTRAMSG_INSTANCE = process.env.ULTRAMSG_INSTANCE || "instance173663";
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN || "n3osndryrfnuowv8";

// تاريخ محادثات واتساب
const conversations = {};

// ---- دالة Groq مشتركة ----
async function askGroq(messages) {
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
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "عذراً، حاول مرة أخرى.";
}

// ---- دالة إرسال واتساب ----
async function sendWhatsApp(to, message) {
  await fetch(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE}/messages/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: ULTRAMSG_TOKEN, to, body: message }),
  });
}

// ============================================================
// 1. Website Chatbot API
// ============================================================
app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }
  try {
    const reply = await askGroq(messages);
    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

// ============================================================
// 2. WhatsApp Webhook
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const data = req.body?.data;
  if (!data || data.type !== "chat") return;
  if (data.fromMe) return;
  if (data.from?.includes("@g.us")) return;

  const sender = data.from;
  const text = data.body?.trim();
  if (!text) return;

  console.log(`📨 WhatsApp من ${sender}: ${text}`);

  if (!conversations[sender]) conversations[sender] = [];
  conversations[sender].push({ role: "user", content: text });
  if (conversations[sender].length > 10) {
    conversations[sender] = conversations[sender].slice(-10);
  }

  try {
    const reply = await askGroq(conversations[sender]);
    conversations[sender].push({ role: "assistant", content: reply });
    await sendWhatsApp(sender, reply);
    console.log(`✅ رد واتساب: ${reply}\n`);
  } catch (err) {
    console.error("WhatsApp error:", err.message);
    await sendWhatsApp(sender, "عذراً، حدث خطأ مؤقت. حاول مرة أخرى.");
  }
});

// ============================================================
// 3. الصفحة الرئيسية
// ============================================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", services: ["chatbot", "whatsapp"] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Chatbot: http://localhost:${PORT}`);
  console.log(`📱 WhatsApp Webhook: http://localhost:${PORT}/webhook`);
  console.log(`🤖 Using: Groq llama-3.1-8b-instant (Free)`);
});
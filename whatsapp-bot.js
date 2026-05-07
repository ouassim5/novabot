const fetch = require("node-fetch");
require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
const ULTRAMSG_INSTANCE = "instance173663";
const ULTRAMSG_TOKEN = "n3osndryrfnuowv8";

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

const conversations = {};

async function sendMessage(to, message) {
  const res = await fetch(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE}/messages/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: ULTRAMSG_TOKEN,
      to: to,
      body: message,
    }),
  });
  return res.json();
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
console.log("📥 RAW:", JSON.stringify(req.body));

const data = req.body?.data;
if (!data || data.type !== "chat") return;
if (data.fromMe) return;
if (data.from?.includes("@g.us")) return;
const sender = data.from;
const text = data.body?.trim();
  if (!text) return;

  console.log(`📨 من ${sender}: ${text}`);

  if (!conversations[sender]) conversations[sender] = [];
  conversations[sender].push({ role: "user", content: text });
  if (conversations[sender].length > 10) {
    conversations[sender] = conversations[sender].slice(-10);
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 300,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...conversations[sender],
        ],
      }),
    });

    const groqData = await response.json();
    const reply = groqData.choices?.[0]?.message?.content || "عذراً، حاول مرة أخرى.";

    conversations[sender].push({ role: "assistant", content: reply });
    await sendMessage(sender, reply);
    console.log(`✅ رد: ${reply}\n`);

  } catch (err) {
    console.error("خطأ:", err.message);
    await sendMessage(sender, "عذراً، حدث خطأ مؤقت. حاول مرة أخرى.");
  }
});

app.get("/", (req, res) => res.send("✅ WhatsApp Bot شغال!"));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Bot server: http://localhost:${PORT}`);
  console.log(`📡 Webhook: http://localhost:${PORT}/webhook`);
});

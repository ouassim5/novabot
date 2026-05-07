const fetch = require("node-fetch");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const SYSTEM_PROMPT = `أنت مساعد ذكي لمتجر "القميص الذهبي" للملابس الرجالية الفاخرة.
أجب فقط بناءً على هذه المعلومات. إذا لم تعرف قل: "سأحيلك لصاحب المتجر مباشرة".

=== المنتجات والأسعار ===

القمصان:
- القميص الأبيض السكري الفخم: 5,900 دج
- القميص الذهبي الفاخر (واحة): 290 ألف سنتيم = 2,900 دج (مقاسات: 52، 54، 56)
- القميص الأسود البلوني: فخم وهيبة — للسعر تواصل مع المتجر

العروض:
- عرض العيد "قنبلة السراج 2026": يشمل قميص + حزام Al Siraj الفاخر
  للسعر والتفاصيل: 0552769920

الألوان المتوفرة: أبيض، ذهبي، أسود، بني، أخضر زيتي

المقاسات: 52 — 54 — 56 (يرجى ذكر مقاسك عند الطلب)

=== الطلب والتوصيل ===
للطلب: 0552769920 أو 0671079766
التوصيل: متوفر لجميع ولايات الجزائر
الدفع: نقداً عند الاستلام

=== أسلوب الرد ===
- تحدث بالعربية الجزائرية الودية
- كن موجزاً (3 أسطر max)
- إذا طلب الزبون قميصاً كهدية، اسأله عن اللون المفضل
- دائماً اختم بـ "شكراً لاختيارك القميص الذهبي 👑"`;

const ULTRAMSG_INSTANCE = process.env.ULTRAMSG_INSTANCE || "";
const ULTRAMSG_TOKEN = process.env.ULTRAMSG_TOKEN || "";
const conversations = {};

async function askGroq(messages) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      max_tokens: 400,
      temperature: 0.7,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content || "عذراً، حاول مرة أخرى.";
}

async function sendWhatsApp(to, message) {
  if (!ULTRAMSG_INSTANCE || !ULTRAMSG_TOKEN) return;
  await fetch(`https://api.ultramsg.com/${ULTRAMSG_INSTANCE}/messages/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: ULTRAMSG_TOKEN, to, body: message }),
  });
}

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "messages array is required" });
  try {
    const reply = await askGroq(messages);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const data = req.body?.data;
  if (!data || data.type !== "chat" || data.fromMe || data.from?.includes("@g.us")) return;
  const sender = data.from;
  const text = data.body?.trim();
  if (!text) return;
  if (!conversations[sender]) conversations[sender] = [];
  conversations[sender].push({ role: "user", content: text });
  if (conversations[sender].length > 10)
    conversations[sender] = conversations[sender].slice(-10);
  try {
    const reply = await askGroq(conversations[sender]);
    conversations[sender].push({ role: "assistant", content: reply });
    await sendWhatsApp(sender, reply);
  } catch (err) {
    await sendWhatsApp(sender, "عذراً، حدث خطأ مؤقت.");
  }
});

app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index-9amis.html"))
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ القميص الذهبي Bot: http://localhost:${PORT}`);
});
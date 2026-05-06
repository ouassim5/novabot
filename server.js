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
// عدّل هذا الـ SYSTEM PROMPT ببيانات العميل الحقيقية
// ============================================================
const SYSTEM_PROMPT = `You are an AI assistant for "NovaTech Solutions", a B2B SaaS company.
Answer ONLY based on this company data. If you don't know, say so politely.

PRODUCTS:
- NovaDash Pro ($49/mo): Analytics dashboard, up to 10 users, 50GB storage
- NovaDash Enterprise ($199/mo): Unlimited users, 500GB, custom integrations, priority support
- NovaAPI ($29/mo): REST API access, 100k requests/month, webhooks

PRICING: Free 14-day trial, no credit card. 30-day money-back. 20% annual discount.
SUPPORT: support@novatech.io (4hr response). Live chat Mon-Fri 9am-6pm EST.
INTEGRATIONS: Slack, Zapier, HubSpot, Salesforce, Google Sheets, Notion
TECHNICAL: 99.9% uptime SLA, SOC 2 certified, GDPR compliant, AWS hosted

Keep answers concise (2-3 sentences). Be friendly and professional.`;
// ============================================================

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Groq API key not configured" });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 1000,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Groq error:", data.error);
      return res.status(500).json({ error: data.error.message });
    }

    const reply = data.choices?.[0]?.message?.content || "Sorry, try again.";
    res.json({ reply });

  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
  console.log(`🤖 Using: Groq llama-3.1-8b-instant (Free)`);
});
const fetch = require("node-fetch");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { google } = require("googleapis");

const app = express();
app.use(cors());
app.use(express.json());

// ============================================================
// Google Sheets Setup
// ============================================================
const SHEET_ID = process.env.SHEET_ID || "1H9F_rf4FRsUNom2L5vMMp_CWWl5NXH7rg7qOt-oa66s";
const SHEET_NAME = "جدول الطلبات";

async function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS || "{}");
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function saveOrder(storeId, storeName, phone, name, product, address, notes) {
  try {
    const sheets = await getSheets();
    const time = new Date().toLocaleString("ar-DZ", { timeZone: "Africa/Algiers" });
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A:G`,
      valueInputOption: "RAW",
      requestBody: {
        values: [[time, phone, name, product, address, notes, storeName]],
      },
    });
    console.log(`✅ طلب محفوظ: ${name} - ${product}`);
    return true;
  } catch (err) {
    console.error("Sheets error:", err.message);
    return false;
  }
}

// ============================================================
// المتاجر
// ============================================================
const STORES = JSON.parse(fs.readFileSync(path.join(__dirname, "stores.json"), "utf8"));

// ============================================================
// Groq
// ============================================================
async function askGroq(systemPrompt, messages) {
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
// كشف الطلب وحفظه في Sheets
// ============================================================
async function detectAndSaveOrder(storeId, storeName, phone, messages) {
  const lastMessages = messages.slice(-6);
  const conversation = lastMessages.map(m => `${m.role === "user" ? "زبون" : "بوت"}: ${m.content}`).join("\n");

  const detectionPrompt = `تحليل هذه المحادثة واستخراج معلومات الطلب إذا وُجد طلب مكتمل.
أجب بـ JSON فقط بهذا الشكل:
{"hasOrder": true/false, "name": "", "product": "", "address": "", "notes": ""}

إذا لم تكتمل المعلومات أجب: {"hasOrder": false}

المحادثة:
${conversation}`;

  try {
    const result = await askGroq(detectionPrompt, [{ role: "user", content: "استخرج معلومات الطلب" }]);
    const clean = result.replace(/```json|```/g, "").trim();
    const order = JSON.parse(clean);
    if (order.hasOrder && order.name && order.product) {
      await saveOrder(storeId, storeName, phone, order.name, order.product, order.address || "", order.notes || "");
      return true;
    }
  } catch (err) {
    console.log("Order detection skipped:", err.message);
  }
  return false;
}

// ============================================================
// تاريخ المحادثات
// ============================================================
const conversations = {};

// ============================================================
// WhatsApp
// ============================================================
async function sendWhatsApp(to, message) {
  const instance = process.env.ULTRAMSG_INSTANCE;
  const token = process.env.ULTRAMSG_TOKEN;
  if (!instance || !token) return;
  await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, to, body: message }),
  });
}

// ============================================================
// API - Website Chatbot
// ============================================================
app.post("/store/:storeId/chat", async (req, res) => {
  const { storeId } = req.params;
  const { messages, phone } = req.body;
  const store = STORES[storeId];
  if (!store) return res.status(404).json({ error: "Store not found" });
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "messages required" });
  try {
    const reply = await askGroq(store.prompt, messages);
    // كشف الطلب وحفظه
    const allMessages = [...messages, { role: "assistant", content: reply }];
    await detectAndSaveOrder(storeId, store.name, phone || "موقع الويب", allMessages);
    res.json({ reply, store: { name: store.name, emoji: store.emoji } });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================================
// WhatsApp Webhook
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const data = req.body?.data;
  if (!data || data.type !== "chat" || data.fromMe || data.from?.includes("@g.us")) return;
  const sender = data.from;
  const text = data.body?.trim();
  if (!text) return;
  console.log(`📨 واتساب من ${sender}: ${text}`);

  // افتراضياً استخدم أول متجر — يمكن تخصيصه لاحقاً
  const storeId = process.env.DEFAULT_STORE || "9amis";
  const store = STORES[storeId];
  if (!store) return;

  if (!conversations[sender]) conversations[sender] = [];
  conversations[sender].push({ role: "user", content: text });
  if (conversations[sender].length > 10)
    conversations[sender] = conversations[sender].slice(-10);

  try {
    const reply = await askGroq(store.prompt, conversations[sender]);
    conversations[sender].push({ role: "assistant", content: reply });
    // كشف الطلب وحفظه
    await detectAndSaveOrder(storeId, store.name, sender, conversations[sender]);
    await sendWhatsApp(sender, reply);
    console.log(`✅ رد: ${reply}\n`);
  } catch (err) {
    await sendWhatsApp(sender, "عذراً، حدث خطأ مؤقت.");
  }
});

// ============================================================
// صفحة كل متجر (نفس الكود السابق)
// ============================================================
app.get("/store/:storeId", (req, res) => {
  const { storeId } = req.params;
  const store = STORES[storeId];
  if (!store) return res.status(404).send("متجر غير موجود");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${store.name} — مساعد ذكي</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--accent:${store.color};--bg:${store.bg}}
body{font-family:'Cairo',sans-serif;background:var(--bg);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}
.wrap{width:100%;max-width:460px;position:relative;z-index:1}
.header{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-bottom:none;border-radius:18px 18px 0 0;padding:18px 22px;display:flex;align-items:center;justify-content:space-between}
.avatar{width:42px;height:42px;border-radius:11px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.hinfo{margin-right:12px}
.hname{color:var(--accent);font-weight:600;font-size:15px}
.hstatus{display:flex;align-items:center;gap:5px;margin-top:2px}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);animation:pulse 2s infinite}
.hstatus span{color:rgba(255,255,255,.6);font-size:12px}
.badge{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:4px 10px;color:rgba(255,255,255,.5);font-size:11px}
.msgs{background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.06);border-top:none;border-bottom:none;height:380px;overflow-y:auto;padding:18px 18px 10px;display:flex;flex-direction:column;gap:12px}
.msgs::-webkit-scrollbar{width:3px}.msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
.msg-row{display:flex;animation:up .3s ease forwards}
.msg-row.user{justify-content:flex-start}
.bot-avatar{width:28px;height:28px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:13px;margin-left:9px;margin-top:2px;flex-shrink:0}
.bubble{max-width:76%;padding:10px 14px;font-size:13.5px;line-height:1.7}
.bubble.user{background:var(--accent);border-radius:4px 16px 16px 16px;color:#fff;opacity:.9}
.bubble.bot{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:16px 4px 16px 16px;color:rgba(255,255,255,.85);text-align:right}
.typing{display:flex;gap:5px;align-items:center;padding:4px 0}
.typing span{width:7px;height:7px;border-radius:50%;background:var(--accent);display:inline-block;animation:bounce 1.2s ease-in-out infinite}
.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
.sug-pills{display:flex;flex-wrap:wrap;gap:6px;padding-right:37px;justify-content:flex-end;margin-top:8px}
.pill{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:5px 12px;color:rgba(255,255,255,.7);font-size:12px;cursor:pointer;font-family:'Cairo',sans-serif;transition:all .2s}
.pill:hover{background:rgba(255,255,255,.1)}
.input-bar{background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.08);border-top:none;border-radius:0 0 18px 18px;padding:14px 16px;display:flex;gap:10px;align-items:center;flex-direction:row-reverse}
input{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:11px;padding:10px 15px;color:rgba(255,255,255,.9);font-size:13.5px;outline:none;font-family:'Cairo',sans-serif;transition:border-color .2s;text-align:right}
input:focus{border-color:var(--accent)}
input::placeholder{color:rgba(255,255,255,.2)}
.send-btn{width:40px;height:40px;border-radius:11px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;color:white;transition:all .2s;flex-shrink:0}
.send-btn.active{background:var(--accent)}
.send-btn.inactive{background:rgba(255,255,255,.05);cursor:not-allowed}
.footer{text-align:center;margin-top:12px;color:rgba(255,255,255,.15);font-size:10px;letter-spacing:.5px}
@keyframes bounce{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-6px);opacity:1}}
@keyframes up{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div style="display:flex;align-items:center;flex-direction:row-reverse">
      <div class="avatar">${store.emoji}</div>
      <div class="hinfo">
        <div class="hname">${store.name}</div>
        <div class="hstatus"><div class="dot"></div><span>متصل الآن</span></div>
      </div>
    </div>
    <div class="badge">مساعد ذكي</div>
  </div>
  <div class="msgs" id="msgs"></div>
  <div class="input-bar">
    <input id="inp" type="text" placeholder="اكتب سؤالك هنا..." autocomplete="off"/>
    <button class="send-btn inactive" id="btn">↑</button>
  </div>
  <div class="footer">مساعد ذكي مخصص لـ ${store.name}</div>
</div>
<script>
const STORE_ID="${storeId}",API_URL="/store/"+STORE_ID+"/chat";
const SUGGESTED=${JSON.stringify(store.suggestions)};
let history=[],loading=false;
const msgsEl=document.getElementById("msgs"),inp=document.getElementById("inp"),btn=document.getElementById("btn");
function scroll(){msgsEl.scrollTop=msgsEl.scrollHeight}
function addMsg(role,text){
  const row=document.createElement("div");row.className="msg-row "+(role==="user"?"user":"bot");
  if(role==="assistant"){const av=document.createElement("div");av.className="bot-avatar";av.textContent="${store.emoji}";row.appendChild(av);}
  const b=document.createElement("div");b.className="bubble "+(role==="user"?"user":"bot");b.textContent=text;
  row.appendChild(b);msgsEl.appendChild(row);scroll();
}
function addTyping(){
  const row=document.createElement("div");row.className="msg-row bot";row.id="typing";
  const av=document.createElement("div");av.className="bot-avatar";av.textContent="${store.emoji}";row.appendChild(av);
  const b=document.createElement("div");b.className="bubble bot";
  b.innerHTML='<div class="typing"><span></span><span></span><span></span></div>';
  row.appendChild(b);msgsEl.appendChild(row);scroll();
}
function removeTyping(){const t=document.getElementById("typing");if(t)t.remove();}
function showSuggested(){
  const d=document.createElement("div");d.id="suggested";
  d.innerHTML='<div class="sug-pills">'+SUGGESTED.map(q=>'<button class="pill" onclick="sendMsg(\''+q+'\')">'+q+'</button>').join("")+'</div>';
  msgsEl.appendChild(d);
}
function updateBtn(){btn.className="send-btn "+(inp.value.trim()&&!loading?"active":"inactive");}
async function sendMsg(text){
  const msg=text||inp.value.trim();if(!msg||loading)return;
  inp.value="";const sug=document.getElementById("suggested");if(sug)sug.remove();updateBtn();
  history.push({role:"user",content:msg});addMsg("user",msg);loading=true;addTyping();
  try{
    const res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:history})});
    const data=await res.json();const reply=data.reply||"عذراً حاول مرة أخرى.";
    history.push({role:"assistant",content:reply});removeTyping();addMsg("assistant",reply);
  }catch{removeTyping();addMsg("assistant","خطأ في الاتصال.");}
  loading=false;updateBtn();inp.focus();
}
inp.addEventListener("input",updateBtn);
inp.addEventListener("keydown",e=>{if(e.key==="Enter")sendMsg();});
btn.addEventListener("click",()=>sendMsg());
addMsg("assistant","مرحباً بك في ${store.name} ${store.emoji}\\nأنا مساعدك الذكي — اسألني عن أي شيء!");
showSuggested();
</script>
</body>
</html>`;
  res.send(html);
});

// ---- الصفحة الرئيسية ----
app.get("/", (req, res) => {
  const list = Object.entries(STORES).map(([id, s]) =>
    `<a href="/store/${id}" style="display:block;padding:16px;margin:8px 0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;color:white;text-decoration:none;font-family:Cairo,sans-serif;">
      ${s.emoji} ${s.name} <span style="color:rgba(255,255,255,.4);font-size:13px;">/store/${id}</span>
    </a>`
  ).join("");
  res.send(`<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"/><title>المتاجر</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo&display=swap" rel="stylesheet"/>
<style>body{background:#0a0a0a;padding:40px;max-width:500px;margin:0 auto}</style>
</head><body><h2 style="color:white;font-family:Cairo;margin-bottom:20px;">🏪 المتاجر المتاحة</h2>${list}</body></html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Multi-Store + Google Sheets: http://localhost:${PORT}`);
  Object.entries(STORES).forEach(([id, s]) => {
    console.log(`  ${s.emoji} ${s.name}: /store/${id}`);
  });
});
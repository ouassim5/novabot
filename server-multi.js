const fetch = require("node-fetch");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const { google } = require("googleapis");
const connectDB = require("./config/db");
const Store = require("./models/Store");
const Order = require("./models/Order");
const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const appApiRoutes = require("./routes/appApi");
const { attachUser } = require("./middleware/auth");
const {
  updateDailyAnalytics,
  getTodayAnalytics,
  getTopQuestion: getAnalyticsTopQuestion,
} = require("./utils/analytics");
const {
  incrementStoreMessages,
  incrementStoreOrders,
} = require("./middleware/storeAnalytics");
const { sendMessage: sendUltraMsgMessage } = require("./services/ultramsg");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(attachUser);
app.use("/auth", authRoutes);
app.use("/api", appApiRoutes);
app.use("/dashboard", dashboardRoutes);

// ============================================================
// Google Sheets Setup
// ============================================================
const SHEET_ID = process.env.SHEET_ID || "1H9F_rf4FRsUNom2L5vMMp_CWWl5NXH7rg7qOt-oa66s";
const SHEET_NAME = "جدول الطلبات";
const savedOrderKeys = new Set();

async function getSheets() {
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error("GOOGLE_CREDENTIALS is missing");
  }

  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function normalizeOrderField(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function buildOrderKey(storeId, phone, order) {
  return [
    storeId,
    phone,
    normalizeOrderField(order.name).toLowerCase(),
    normalizeOrderField(order.product).toLowerCase(),
    normalizeOrderField(order.address).toLowerCase(),
  ].join("|");
}

function extractJsonObject(text) {
  const clean = String(text || "").replace(/```(?:json)?|```/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON object found in detection response");
  }
  return JSON.parse(clean.slice(start, end + 1));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
// المتاجر من MongoDB
// ============================================================
async function findStoreByParam(storeId) {
  const normalized = String(storeId || "").trim().toLowerCase();
  const query = mongoose.Types.ObjectId.isValid(normalized)
    ? { $or: [{ _id: normalized }, { slug: normalized }] }
    : { slug: normalized };

  return Store.findOne(query);
}

async function findStoreByWebhook(req) {
  const routeStoreId = req.params.storeId;
  const routeInstanceId = req.params.instanceId;
  const payloadInstanceId =
    req.body?.instanceId ||
    req.body?.instance_id ||
    req.body?.instance ||
    req.body?.data?.instanceId ||
    req.body?.data?.instance_id ||
    req.body?.data?.instance;

  if (routeStoreId) return findStoreByParam(routeStoreId);
  if (routeInstanceId) return Store.findOne({ ultraMsgInstanceId: routeInstanceId });
  if (payloadInstanceId) return Store.findOne({ ultraMsgInstanceId: payloadInstanceId });
  if (process.env.DEFAULT_STORE) return findStoreByParam(process.env.DEFAULT_STORE);
  return Store.findOne();
}

// ============================================================
// Groq
// ============================================================
async function askGroq(systemPrompt, messages, storeId) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing");
  await incrementStoreMessages(storeId);

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
async function detectAndSaveOrder(store, phone, messages, options = {}) {
  const lastMessages = messages.slice(-10);
  const conversation = lastMessages.map(m => `${m.role === "user" ? "زبون" : "بوت"}: ${m.content}`).join("\n");

  const detectionPrompt = `حلل هذه المحادثة واستخرج معلومات الطلب إذا وُجد طلب مكتمل.
لا تعتبر الطلب مكتملًا إلا إذا توفر اسم الزبون + المنتج المطلوب + عنوان التوصيل.
أجب بـ JSON صالح فقط بدون شرح وبدون Markdown.
أجب بـ JSON فقط بهذا الشكل:
{"hasOrder": true, "name": "", "phone": "", "product": "", "address": "", "notes": ""}

إذا لم تكتمل المعلومات أجب بهذا الشكل فقط: {"hasOrder": false}

المحادثة:
${conversation}`;

  try {
    const result = await askGroq(
      detectionPrompt,
      [{ role: "user", content: "استخرج معلومات الطلب المكتمل كـ JSON فقط" }],
      store._id
    );
    const order = extractJsonObject(result);
    const normalizedOrder = {
      name: normalizeOrderField(order.name),
      phone: normalizeOrderField(order.phone),
      product: normalizeOrderField(order.product),
      address: normalizeOrderField(order.address),
      notes: normalizeOrderField(order.notes),
    };

    if (order.hasOrder && normalizedOrder.name && normalizedOrder.product && normalizedOrder.address) {
      const orderPhone = normalizedOrder.phone || phone;
      const orderKey = buildOrderKey(store._id.toString(), orderPhone, normalizedOrder);
      if (savedOrderKeys.has(orderKey)) return false;

      const sheetSaved = await saveOrder(
        store._id.toString(),
        store.storeName,
        orderPhone,
        normalizedOrder.name,
        normalizedOrder.product,
        normalizedOrder.address,
        normalizedOrder.notes
      );
      if (!sheetSaved) console.warn("Order saved in MongoDB, but Google Sheets append failed.");

      savedOrderKeys.add(orderKey);
      await Order.create({
        storeId: store._id,
        userId: store.userId,
        customerName: normalizedOrder.name,
        phone: orderPhone,
        product: normalizedOrder.product,
        address: normalizedOrder.address,
        notes: normalizedOrder.notes,
        source: options.source || "web",
        conversationId: options.conversationId || "",
      });
      await updateDailyAnalytics(store._id, { orderIncrement: 1 });
      await incrementStoreOrders(store._id);
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
async function sendWhatsApp(store, to, message) {
  const instanceId = store?.ultraMsgInstanceId || process.env.ULTRAMSG_INSTANCE;
  if (!instanceId) return;
  await sendUltraMsgMessage(instanceId, to, message);
}

// ============================================================
// API - Website Chatbot
// ============================================================
app.post("/store/:storeId/chat", async (req, res) => {
  const { storeId } = req.params;
  const { messages, phone, sessionId } = req.body;
  const store = await findStoreByParam(storeId);
  if (!store) return res.status(404).json({ error: "Store not found" });
  if (!messages || !Array.isArray(messages))
    return res.status(400).json({ error: "messages required" });
  try {
    const conversationId = phone || sessionId || `web-${req.ip}`;
    const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content;
    await updateDailyAnalytics(store._id, {
      conversationId,
      question: lastUserMessage,
      messageIncrement: 1,
    });

    const reply = await askGroq(store.prompt, messages, store._id);
    // كشف الطلب وحفظه
    const allMessages = [...messages, { role: "assistant", content: reply }];
    await detectAndSaveOrder(store, phone || "موقع الويب", allMessages, {
      source: "web",
      conversationId,
    });
    res.json({ reply, store: { name: store.storeName, emoji: store.emoji } });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================================================
// WhatsApp Webhook
// ============================================================
async function handleWhatsAppWebhook(req, res) {
  res.sendStatus(200);
  const data = req.body?.data;
  if (!data || data.type !== "chat" || data.fromMe || data.from?.includes("@g.us")) return;
  const sender = data.from;
  const text = data.body?.trim();
  if (!text) return;
  console.log(`📨 واتساب من ${sender}: ${text}`);

  const store = await findStoreByWebhook(req);
  if (!store) return;
  await updateDailyAnalytics(store._id, {
    conversationId: sender,
    question: text,
    messageIncrement: 1,
  });

  const conversationKey = `${store._id}:${sender}`;
  if (!conversations[conversationKey]) conversations[conversationKey] = [];
  conversations[conversationKey].push({ role: "user", content: text });
  if (conversations[conversationKey].length > 10)
    conversations[conversationKey] = conversations[conversationKey].slice(-10);

  try {
    const reply = await askGroq(store.prompt, conversations[conversationKey], store._id);
    conversations[conversationKey].push({ role: "assistant", content: reply });
    // كشف الطلب وحفظه
    await detectAndSaveOrder(store, sender, conversations[conversationKey], {
      source: "whatsapp",
      conversationId: sender,
    });
    await sendWhatsApp(store, sender, reply);
    console.log(`✅ رد: ${reply}\n`);
  } catch (err) {
    console.error("WhatsApp webhook error:", err.message);
    await sendWhatsApp(store, sender, "عذراً، حدث خطأ مؤقت.");
  }
}

app.post("/webhook/instance/:instanceId", handleWhatsAppWebhook);
app.post("/webhook/store/:storeId", handleWhatsAppWebhook);
app.post("/webhook/:storeId", handleWhatsAppWebhook);
app.post("/webhook", handleWhatsAppWebhook);
// ============================================================
// صفحة كل متجر (نفس الكود السابق)
// ============================================================
app.get("/store/:storeId", async (req, res) => {
  const { storeId } = req.params;
  const store = await findStoreByParam(storeId);
  if (!store) return res.status(404).send("متجر غير موجود");
  const storeData = JSON.stringify({
    id: store.slug || store._id.toString(),
    name: store.storeName,
    emoji: store.emoji,
    suggestions: store.suggestions,
    color: store.colors?.primary || "#d4af37",
    bg: store.colors?.background || "#0a0800",
  }).replace(/</g, "\\u003c");
  const safeStoreName = escapeHtml(store.storeName);
  const safeStoreEmoji = escapeHtml(store.emoji);
  const primaryColor = escapeHtml(store.colors?.primary || "#d4af37");
  const backgroundColor = escapeHtml(store.colors?.background || "#0a0800");

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${safeStoreName} — مساعد ذكي</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--accent:${primaryColor};--bg:${backgroundColor}}
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
      <div class="avatar">${safeStoreEmoji}</div>
      <div class="hinfo">
        <div class="hname">${safeStoreName}</div>
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
  <div class="footer">مساعد ذكي مخصص لـ ${safeStoreName}</div>
</div>
<script>
const STORE=${storeData};
const STORE_ID=STORE.id,API_URL="/store/"+STORE_ID+"/chat";
const SUGGESTED=STORE.suggestions;
const SESSION_KEY="novabot-session-"+STORE_ID;
let SESSION_ID=localStorage.getItem(SESSION_KEY);
if(!SESSION_ID){SESSION_ID=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2);localStorage.setItem(SESSION_KEY,SESSION_ID);}
let history=[],loading=false;
const msgsEl=document.getElementById("msgs"),inp=document.getElementById("inp"),btn=document.getElementById("btn");
function scroll(){msgsEl.scrollTop=msgsEl.scrollHeight}
function addMsg(role,text){
  const row=document.createElement("div");row.className="msg-row "+(role==="user"?"user":"bot");
  if(role==="assistant"){const av=document.createElement("div");av.className="bot-avatar";av.textContent=STORE.emoji;row.appendChild(av);}
  const b=document.createElement("div");b.className="bubble "+(role==="user"?"user":"bot");b.textContent=text;
  row.appendChild(b);msgsEl.appendChild(row);scroll();
}
function addTyping(){
  const row=document.createElement("div");row.className="msg-row bot";row.id="typing";
  const av=document.createElement("div");av.className="bot-avatar";av.textContent=STORE.emoji;row.appendChild(av);
  const b=document.createElement("div");b.className="bubble bot";
  b.innerHTML='<div class="typing"><span></span><span></span><span></span></div>';
  row.appendChild(b);msgsEl.appendChild(row);scroll();
}
function removeTyping(){const t=document.getElementById("typing");if(t)t.remove();}
function showSuggested(){
  const d=document.createElement("div");d.id="suggested";
  const wrap=document.createElement("div");wrap.className="sug-pills";
  SUGGESTED.forEach(q=>{
    const pill=document.createElement("button");
    pill.className="pill";
    pill.type="button";
    pill.textContent=q;
    pill.addEventListener("click",()=>sendMsg(q));
    wrap.appendChild(pill);
  });
  d.appendChild(wrap);
  msgsEl.appendChild(d);
}
function updateBtn(){btn.className="send-btn "+(inp.value.trim()&&!loading?"active":"inactive");}
async function sendMsg(text){
  const msg=text||inp.value.trim();if(!msg||loading)return;
  inp.value="";const sug=document.getElementById("suggested");if(sug)sug.remove();updateBtn();
  history.push({role:"user",content:msg});addMsg("user",msg);loading=true;addTyping();
  try{
    const res=await fetch(API_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:history,sessionId:SESSION_ID})});
    const data=await res.json();const reply=data.reply||"عذراً حاول مرة أخرى.";
    history.push({role:"assistant",content:reply});removeTyping();addMsg("assistant",reply);
  }catch{removeTyping();addMsg("assistant","خطأ في الاتصال.");}
  loading=false;updateBtn();inp.focus();
}
inp.addEventListener("input",updateBtn);
inp.addEventListener("keydown",e=>{if(e.key==="Enter")sendMsg();});
btn.addEventListener("click",()=>sendMsg());
addMsg("assistant","مرحباً بك في "+STORE.name+" "+STORE.emoji+"\\nأنا مساعدك الذكي — اسألني عن أي شيء!");
showSuggested();
</script>
</body>
</html>`;
  res.send(html);
});

// ---- لوحة تحكم صاحب المتجر ----
app.get("/admin/:storeId", async (req, res) => {
  const { storeId } = req.params;
  const store = await findStoreByParam(storeId);
  if (!store) return res.status(404).send("متجر غير موجود");

  const adminToken = process.env.ADMIN_TOKEN;
  if (adminToken && req.query.token !== adminToken) {
    return res.status(401).send("غير مصرح");
  }

  const analytics = await getTodayAnalytics(store._id);
  const topQuestion = getAnalyticsTopQuestion(analytics);
  const todayOrders = analytics?.orderCount || 0;
  const conversations = analytics?.conversationIds?.length || 0;
  const safeStoreName = escapeHtml(store.storeName);
  const safeTopQuestion = escapeHtml(topQuestion);
  const primaryColor = escapeHtml(store.colors?.primary || "#d4af37");

  res.send(`<!DOCTYPE html><html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>لوحة تحكم ${safeStoreName}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet"/>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#090909;color:#fff;font-family:Cairo,sans-serif;padding:32px}
.wrap{max-width:980px;margin:0 auto}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:24px}
h1{font-size:24px;margin:0;color:${primaryColor}}.sub{color:rgba(255,255,255,.55);font-size:13px;margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:20px;min-height:130px}
.label{color:rgba(255,255,255,.58);font-size:13px;margin-bottom:10px}.num{font-size:38px;font-weight:700;color:#fff;line-height:1}
.question{font-size:18px;line-height:1.8;color:#fff}.count{color:rgba(255,255,255,.45);font-size:12px;margin-top:8px}
.link{color:rgba(255,255,255,.6);font-size:13px;text-decoration:none;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 12px}
@media(max-width:720px){body{padding:18px}.top{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:1fr}.num{font-size:32px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <h1>لوحة تحكم ${safeStoreName}</h1>
      <div class="sub">إحصائيات التشغيل الحالي للبوت</div>
    </div>
    <a class="link" href="/store/${encodeURIComponent(store.slug)}">فتح المتجر</a>
  </div>
  <div class="grid">
    <div class="card"><div class="label">عدد المحادثات</div><div class="num">${conversations}</div></div>
    <div class="card"><div class="label">الطلبات اليوم</div><div class="num">${todayOrders}</div></div>
    <div class="card"><div class="label">أكثر سؤال يُطرح</div><div class="question">${safeTopQuestion}</div><div class="count">${analytics ? "من بيانات اليوم" : "لا توجد بيانات بعد"}</div></div>
  </div>
</div>
</body></html>`);
});

// ---- التطبيق الموحد ----
app.get("/", (req, res) => {
  res.render("landing", { user: req.user || null });
});

app.get("/app", (req, res) => {
  res.render("app", { user: req.user || null });
});

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`✅ NovaBOT SaaS: http://localhost:${PORT}`);
      console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });

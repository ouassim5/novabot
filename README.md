# 🤖 Nova AI Chatbot

Chatbot احترافي مبني على Claude API مع backend آمن.

---

## 🚀 تشغيل محلي (على جهازك)

```bash
# 1. تثبيت الحزم
npm install

# 2. إنشاء ملف .env
cp .env.example .env

# 3. افتح .env وضع مفتاح API الخاص بك
# ANTHROPIC_API_KEY=sk-ant-...

# 4. تشغيل السيرفر
npm start

# 5. افتح المتصفح على
# http://localhost:3000
```

---

## ☁️ نشر مجاني على Railway

1. اذهب إلى [railway.app](https://railway.app)
2. اضغط "New Project" → "Deploy from GitHub"
3. ارفع الكود على GitHub أولاً، ثم اربطه
4. في Railway: اذهب إلى Variables → أضف:
   ```
   ANTHROPIC_API_KEY = sk-ant-...
   ```
5. Railway يعطيك رابط مجاني مثل: `https://novabot.up.railway.app`

---

## ☁️ نشر مجاني على Render

1. اذهب إلى [render.com](https://render.com)
2. New → Web Service → ارفع الكود
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Environment Variables: `ANTHROPIC_API_KEY=sk-ant-...`

---

## 🎨 تخصيص للعميل

افتح `server.js` وعدّل `SYSTEM_PROMPT`:

```javascript
const SYSTEM_PROMPT = `أنت مساعد AI لشركة [اسم العميل].
أجب فقط بناءً على هذه البيانات:

المنتجات: ...
الأسعار: ...
الدعم: ...`;
```

---

## 📦 هيكل المشروع

```
novabot/
├── server.js          ← الـ backend (API key هنا، آمن)
├── public/
│   └── index.html     ← الـ frontend (لا يحتوي API key)
├── .env               ← المفاتيح السرية (لا يُرفع على GitHub)
├── .env.example       ← نموذج للإعداد
├── .gitignore
└── package.json
```

---

## 💰 تكلفة التشغيل

- **Claude Haiku**: ~$0.001 لكل 1000 رسالة (رخيص جداً)
- **Railway/Render**: مجاني للاستخدام البسيط
- **API Key**: من [console.anthropic.com](https://console.anthropic.com)

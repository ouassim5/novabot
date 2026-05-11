const fetch = require("node-fetch");

function getUltraMsgToken() {
  return process.env.ULTRAMSG_TOKEN || "";
}

function getInstancePool() {
  const pool = process.env.ULTRAMSG_INSTANCE_POOL || process.env.ULTRAMSG_INSTANCE || "";
  return pool.split(",").map(item => item.trim()).filter(Boolean);
}

function requireUltraMsg(instanceId) {
  const token = getUltraMsgToken();
  if (!instanceId) throw new Error("UltraMsg instance is missing");
  if (!token) throw new Error("ULTRAMSG_TOKEN is missing");
  return token;
}

async function sendMessage(instanceId, to, message) {
  const token = requireUltraMsg(instanceId);
  const response = await fetch(`https://api.ultramsg.com/${instanceId}/messages/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, to, body: message }),
  });
  return response.json().catch(() => ({}));
}

async function getQrImage(instanceId) {
  const token = requireUltraMsg(instanceId);
  const response = await fetch(
    `https://api.ultramsg.com/${instanceId}/instance/qr?token=${token}`
  );
  const data = await response.json().catch(() => ({}));
  const qrData = data.qr || data.QRcode || data.qrCode || null;
  if (qrData && qrData.startsWith("data:image")) {
    const base64Data = qrData.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    return { contentType: "image/png", buffer, ok: true };
  }
  if (qrData) {
    const buffer = Buffer.from(qrData, "base64");
    return { contentType: "image/png", buffer, ok: true };
  }
  throw new Error(data.error || data.message || "QR not available");
}

async function getInstanceStatus(instanceId) {
  const token = requireUltraMsg(instanceId);
  const response = await fetch(
    `https://api.ultramsg.com/${instanceId}/instance/status?${new URLSearchParams({ token })}`
  );
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { return { status: text.trim() || "unknown" }; }
}

async function updateWebhook(instanceId, webhookUrl) {
  const token = requireUltraMsg(instanceId);
  const response = await fetch(`https://api.ultramsg.com/${instanceId}/instance/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, webhook_url: webhookUrl, webhook_message_received: "true" }),
  });
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { return { ok: response.ok, body: text }; }
}

async function logoutInstance(instanceId) {
  const token = requireUltraMsg(instanceId);
  const response = await fetch(`https://api.ultramsg.com/${instanceId}/instance/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
  return response.json().catch(() => ({}));
}

module.exports = {
  getInstancePool,
  getInstanceStatus,
  getQrImage,
  logoutInstance,
  sendMessage,
  updateWebhook,
};
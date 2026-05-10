const fetch = require("node-fetch");

function getUltraMsgToken() {
  return process.env.ULTRAMSG_TOKEN || "";
}

function getInstancePool() {
  const pool = process.env.ULTRAMSG_INSTANCE_POOL || process.env.ULTRAMSG_INSTANCE || "";
  return pool
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
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
    `https://api.ultramsg.com/${instanceId}/instance/qr_image?${new URLSearchParams({ token })}`
  );
  const contentType = response.headers.get("content-type") || "image/png";
  const buffer = await response.buffer();
  return { contentType, buffer, ok: response.ok };
}

async function getInstanceStatus(instanceId) {
  const token = requireUltraMsg(instanceId);
  const response = await fetch(
    `https://api.ultramsg.com/${instanceId}/instance/qr?${new URLSearchParams({ token })}`
  );
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: text.trim() || "unknown" };
  }
}

async function updateWebhook(instanceId, webhookUrl) {
  const token = requireUltraMsg(instanceId);
  const response = await fetch(`https://api.ultramsg.com/${instanceId}/instance/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      webhook_url: webhookUrl,
      webhook_message_received: "true",
    }),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, body: text };
  }
}

module.exports = {
  getInstancePool,
  getInstanceStatus,
  getQrImage,
  sendMessage,
  updateWebhook,
};

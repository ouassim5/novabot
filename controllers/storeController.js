const Store = require("../models/Store");
const slugify = require("../utils/slug");

async function uniqueSlug(name) {
  const base = slugify(name);
  let slug = base;
  let index = 2;

  while (await Store.exists({ slug })) {
    slug = `${base}-${index}`;
    index += 1;
  }

  return slug;
}

function showNewStore(req, res) {
  res.render("dashboard/new-store", { error: "", values: {} });
}

async function createStore(req, res) {
  const values = {
    storeName: String(req.body.storeName || "").trim(),
    botName: String(req.body.botName || "").trim(),
    whatsappPhone: String(req.body.whatsappPhone || "").trim(),
    prompt: String(req.body.prompt || "").trim(),
    suggestions: String(req.body.suggestions || "").trim(),
    primaryColor: String(req.body.primaryColor || "#d4af37").trim(),
    backgroundColor: String(req.body.backgroundColor || "#0a0800").trim(),
    emoji: String(req.body.emoji || "🤖").trim(),
  };

  if (!values.storeName || !values.botName || !values.whatsappPhone || !values.prompt) {
    return res.status(400).render("dashboard/new-store", {
      error: "اسم المتجر، اسم البوت، رقم واتساب المتجر والـ System Prompt مطلوبة.",
      values,
    });
  }

  const suggestions = values.suggestions
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 8);

  const store = await Store.create({
    userId: req.user._id,
    storeName: values.storeName,
    botName: values.botName,
    slug: await uniqueSlug(values.storeName),
    whatsappPhone: values.whatsappPhone,
    prompt: values.prompt,
    suggestions,
    colors: {
      primary: values.primaryColor,
      background: values.backgroundColor,
    },
    emoji: values.emoji,
  });

  res.redirect(`/dashboard?created=${store.slug}`);
}

module.exports = {
  createStore,
  showNewStore,
};

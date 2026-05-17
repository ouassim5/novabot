const express = require("express");
const User = require("../models/User");
const { signToken } = require("../middleware/auth");

const router = express.Router();

function setAuthCookie(res, token) {
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

router.get("/signup", (req, res) => {
  res.redirect("/#signup");
});

router.post("/signup", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || password.length < 6) {
    return res.redirect("/?signupError=" + encodeURIComponent("أدخل بريد صحيح وكلمة مرور من 6 أحرف على الأقل.") + "#signup");
  }

  try {
    const user = await User.createWithPassword(email, password);
    setAuthCookie(res, signToken(user));
    res.redirect("/");
  } catch (err) {
    res.redirect("/?signupError=" + encodeURIComponent("هذا البريد مستعمل أو حدث خطأ في التسجيل.") + "#signup");
  }
});

router.get("/login", (req, res) => {
  res.redirect("/#login");
});

router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password))) {
    return res.redirect("/?loginError=" + encodeURIComponent("البريد أو كلمة المرور غير صحيحة.") + "#login");
  }

  setAuthCookie(res, signToken(user));
  res.redirect("/");
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/");
});

module.exports = router;

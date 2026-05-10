const jwt = require("jsonwebtoken");
const User = require("../models/User");

function getToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.cookies?.token;
}

async function attachUser(req, res, next) {
  try {
    const token = getToken(req);
    if (!token || !process.env.JWT_SECRET) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(payload.userId).select("_id email");
  } catch {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect("/auth/login");
}

function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

module.exports = {
  attachUser,
  requireAuth,
  signToken,
};

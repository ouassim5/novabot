const express = require("express");
const Store = require("../models/Store");
const Analytics = require("../models/Analytics");
const Order = require("../models/Order");
const { requireAuth } = require("../middleware/auth");
const { startOfToday, getTopQuestion } = require("../utils/analytics");
const { createStore, showNewStore } = require("../controllers/storeController");

const router = express.Router();

router.use(requireAuth);

router.get("/", async (req, res) => {
  const stores = await Store.find({ userId: req.user._id }).sort({ createdAt: -1 });
  const storeIds = stores.map(store => store._id);
  const analyticsRows = await Analytics.find({
    storeId: { $in: storeIds },
    date: startOfToday(),
  });
  const orders = await Order.find({ userId: req.user._id })
    .populate("storeId", "storeName")
    .sort({ createdAt: -1 })
    .limit(40);

  const analyticsByStore = new Map(
    analyticsRows.map(row => [row.storeId.toString(), row])
  );

  res.render("dashboard/index", {
    user: req.user,
    stores,
    orders,
    analyticsByStore,
    getTopQuestion,
    baseUrl: process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`,
  });
});

router.get("/stores/new", showNewStore);
router.post("/stores", createStore);

module.exports = router;

const Store = require("../models/Store");

async function incrementStoreMessages(storeId, amount = 1) {
  if (!storeId) return;
  await Store.updateOne({ _id: storeId }, { $inc: { totalMessages: amount } });
}

async function incrementStoreOrders(storeId, amount = 1) {
  if (!storeId) return;
  await Store.updateOne({ _id: storeId }, { $inc: { totalOrders: amount } });
}

async function countIncomingMessage(req, res, next) {
  try {
    if (req.store?._id) {
      await incrementStoreMessages(req.store._id);
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  countIncomingMessage,
  incrementStoreMessages,
  incrementStoreOrders,
};

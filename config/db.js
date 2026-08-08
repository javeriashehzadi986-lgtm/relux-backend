const mongoose = require("mongoose");

async function removeLegacyProductIndexes() {
  try {
    const collection = mongoose.connection.db.collection("products");
    const indexes = await collection.indexes();
    const legacyIndex = indexes.find((index) => index.name === "productId_1");

    if (!legacyIndex) return;

    await collection.dropIndex("productId_1");
    console.log("Removed legacy products index: productId_1");
  } catch (error) {
    if (error.codeName !== "IndexNotFound") {
      console.warn("Could not remove legacy products index:", error.message);
    }
  }
}

async function backfillMissingOrderIds() {
  try {
    const Order = require("../models/Order");
    const orders = await Order.find({
      $or: [{ orderId: null }, { orderId: "" }, { orderId: { $exists: false } }],
    }).limit(200);

    if (!orders.length) return;

    for (const order of orders) {
      order.orderId = undefined;
      await order.save();
    }

    console.log(`Backfilled orderId for ${orders.length} legacy order(s)`);
  } catch (error) {
    console.warn("Could not backfill legacy order ids:", error.message);
  }
}

const connectDB = async () => {
  const mongoUrl = process.env.MONGODB_URL;

  if (!mongoUrl) {
    throw new Error("MONGODB_URL is not defined in environment variables");
  }

  try {
    const conn = await mongoose.connect(mongoUrl, {
      serverSelectionTimeoutMS: 10000,
    });
    await conn.connection.db.admin().ping();
    console.log(`MongoDB connected: ${conn.connection.host}`);
    console.log(`Database: ${conn.connection.name}`);
    await removeLegacyProductIndexes();
    await backfillMissingOrderIds();
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    process.exit(1);
  }

  mongoose.connection.on("error", (error) => {
    console.error("MongoDB runtime error:", error.message);
  });
};

module.exports = connectDB;

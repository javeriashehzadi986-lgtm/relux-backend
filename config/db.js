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

async function mergeDuplicateConversations() {
  try {
    const Conversation = require("../models/Conversation");
    const Message = require("../models/Message");

    const duplicateGroups = await Conversation.aggregate([
      {
        $group: {
          _id: { buyerId: "$buyerId", sellerId: "$sellerId" },
          ids: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    if (!duplicateGroups.length) return;

    for (const group of duplicateGroups) {
      const conversations = await Conversation.find({ _id: { $in: group.ids } }).sort({
        createdAt: 1,
      });
      const [primary, ...extras] = conversations;

      for (const extra of extras) {
        await Message.updateMany(
          { conversationId: extra._id },
          { conversationId: primary._id },
        );

        primary.unreadBuyer += extra.unreadBuyer || 0;
        primary.unreadSeller += extra.unreadSeller || 0;

        if (extra.lastMessageAt > primary.lastMessageAt) {
          primary.lastMessageAt = extra.lastMessageAt;
          primary.lastMessageText = extra.lastMessageText;
        }
      }

      await primary.save();
      await Conversation.deleteMany({ _id: { $in: extras.map((extra) => extra._id) } });
    }

    console.log(
      `Merged duplicate conversations for ${duplicateGroups.length} buyer/seller pair(s)`,
    );
  } catch (error) {
    console.warn("Could not merge duplicate conversations:", error.message);
  }
}

async function removeLegacyConversationIndex() {
  try {
    const collection = mongoose.connection.db.collection("conversations");
    const indexes = await collection.indexes();
    const legacyIndex = indexes.find(
      (index) => index.name === "buyerId_1_sellerId_1_listingKey_1",
    );

    if (!legacyIndex) return;

    await collection.dropIndex("buyerId_1_sellerId_1_listingKey_1");
    console.log("Removed legacy conversations index: buyerId_1_sellerId_1_listingKey_1");
  } catch (error) {
    if (error.codeName !== "IndexNotFound") {
      console.warn("Could not remove legacy conversations index:", error.message);
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
    await mergeDuplicateConversations();
    await removeLegacyConversationIndex();
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

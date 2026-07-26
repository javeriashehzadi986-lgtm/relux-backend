const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    listingKey: { type: String, required: true, trim: true },
    listingTitle: { type: String, trim: true, default: "" },
    listingImage: { type: String, default: "" },
    lastMessageText: { type: String, trim: true, default: "" },
    lastMessageAt: { type: Date, default: Date.now },
    unreadBuyer: { type: Number, default: 0, min: 0 },
    unreadSeller: { type: Number, default: 0, min: 0 },
    mutedByBuyer: { type: Boolean, default: false },
    mutedBySeller: { type: Boolean, default: false },
    blockedByBuyer: { type: Boolean, default: false },
    blockedBySeller: { type: Boolean, default: false },
  },
  { timestamps: true },
);

conversationSchema.index({ buyerId: 1, sellerId: 1, listingKey: 1 }, { unique: true });

module.exports = mongoose.model("Conversation", conversationSchema);

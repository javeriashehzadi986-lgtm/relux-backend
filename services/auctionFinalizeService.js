const Product = require("../models/Product");
const Bid = require("../models/Bid");
const {
  notifyAuctionWon,
  notifyAuctionEnded,
} = require("./notificationService");

function parseAmount(value) {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function formatRs(amount) {
  return `Rs. ${Math.round(amount).toLocaleString("en-PK")}`;
}

function getAuctionEndDate(product) {
  if (product.auctionEndDate) {
    const parsed = new Date(product.auctionEndDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const fallback = new Date(product.createdAt ?? Date.now());
  fallback.setDate(fallback.getDate() + 14);
  return fallback;
}

async function finalizeAuction(product) {
  if (!product || product.listingType !== "sale") return false;
  if (product.auctionEndNotifiedAt) return false;

  const endDate = getAuctionEndDate(product);
  if (Date.now() < endDate.getTime()) return false;

  const claimed = await Product.findOneAndUpdate(
    {
      _id: product._id,
      listingType: "sale",
      auctionEndNotifiedAt: null,
      status: { $in: ["active", "pending"] },
    },
    { $set: { auctionEndNotifiedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!claimed) return false;

  const highestBid = await Bid.findOne({ productId: claimed._id }).sort({
    amount: -1,
    createdAt: -1,
  });

  const amountFormatted = highestBid ? formatRs(highestBid.amount) : "";
  const productTitle = claimed.title;
  const productId = String(claimed._id);

  if (highestBid) {
    // Keep listing available for winner checkout — mark sold only after Stripe payment.
    notifyAuctionWon({
      buyerId: highestBid.userId,
      productTitle,
      productId,
      amountFormatted,
    });

    notifyAuctionEnded({
      sellerId: claimed.sellerId,
      productTitle,
      productId,
      amountFormatted,
      hasWinner: true,
    });
  } else {
    notifyAuctionEnded({
      sellerId: claimed.sellerId,
      productTitle,
      productId,
      amountFormatted: "",
      hasWinner: false,
    });
  }

  return true;
}

async function finalizeEndedAuctions({ limit = 40 } = {}) {
  const products = await Product.find({
    listingType: "sale",
    status: "active",
    verificationStatus: "approved",
    auctionEndNotifiedAt: null,
  })
    .sort({ updatedAt: -1 })
    .limit(limit);

  let finalized = 0;
  for (const product of products) {
    const endDate = getAuctionEndDate(product);
    if (Date.now() < endDate.getTime()) continue;
    const ok = await finalizeAuction(product);
    if (ok) finalized += 1;
  }

  return finalized;
}

async function maybeFinalizeProduct(product) {
  if (!product) return false;
  return finalizeAuction(product);
}

module.exports = {
  finalizeAuction,
  finalizeEndedAuctions,
  maybeFinalizeProduct,
  getAuctionEndDate,
  parseAmount,
};

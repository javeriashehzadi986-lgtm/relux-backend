const Product = require("../models/Product");
const Bid = require("../models/Bid");
const Notification = require("../models/Notification");
const Order = require("../models/Order");
const User = require("../models/User");
const {
  notifyAuctionWon,
  notifyAuctionEnded,
} = require("./notificationService");

const DEFAULT_DELIVERY_PKR = 300;

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

async function findExistingAuctionNotification({ userId, titles, productId, productTitle }) {
  if (!userId) return null;

  return Notification.findOne({
    userId,
    title: Array.isArray(titles) ? { $in: titles } : titles,
    $or: [
      { link: { $regex: String(productId) } },
      ...(productTitle ? [{ highlight: productTitle }] : []),
    ],
  }).lean();
}

/**
 * Creates the winner's unpaid "sale" order as soon as the auction ends so the
 * won item shows in the buyer's My Orders list with an "Awaiting Payment"
 * status — not only after they open Stripe checkout.
 *
 * Idempotent: an atomic claim on `product.winnerOrderCreatedAt` guarantees the
 * order is created at most once even under concurrent calls.
 */
async function ensureWinnerSaleOrder(product, highestBid) {
  if (!product || product.listingType !== "sale") return null;
  if (!highestBid || !highestBid.userId || !product.sellerId) return null;

  // Any non-cancelled sale order (incl. an already-paid one) means we're done.
  const existing = await Order.findOne({
    productId: product._id,
    type: "sale",
    status: { $nin: ["cancelled", "rejected"] },
  }).lean();
  if (existing) return existing;

  const claimed = await Product.findOneAndUpdate(
    {
      _id: product._id,
      $or: [
        { winnerOrderCreatedAt: null },
        { winnerOrderCreatedAt: { $exists: false } },
      ],
    },
    { $set: { winnerOrderCreatedAt: new Date() } },
    { new: true },
  );
  if (!claimed) return null;

  const winningBid =
    parseAmount(highestBid.amount) ||
    parseAmount(product.startingBid) ||
    parseAmount(product.salePrice) ||
    0;
  const deliveryChargesPkr = DEFAULT_DELIVERY_PKR;

  try {
    const buyer = await User.findById(highestBid.userId).select("name").lean();
    return await Order.create({
      buyerId: highestBid.userId,
      sellerId: product.sellerId,
      productId: product._id,
      type: "sale",
      status: "pending",
      size: product.listingSize || "M",
      buyerName: buyer?.name || "Buyer",
      amountPkr: winningBid + deliveryChargesPkr,
      itemAmountPkr: winningBid,
      deliveryChargesPkr,
      paymentStatus: "unpaid",
      paymentProvider: "stripe",
    });
  } catch (error) {
    // Release the claim so a later run can retry.
    await Product.updateOne(
      { _id: product._id },
      { $set: { winnerOrderCreatedAt: null } },
    ).catch(() => {});
    throw error;
  }
}

/**
 * Sends win / auction-ended notifications if missing.
 * Safe to call repeatedly (idempotent) — fixes cases where the product
 * already shows "Won" but the in-app notification never arrived.
 */
async function ensureAuctionNotifications(product) {
  if (!product || product.listingType !== "sale") return false;

  const endDate = getAuctionEndDate(product);
  if (Date.now() < endDate.getTime()) return false;

  const highestBid = await Bid.findOne({ productId: product._id }).sort({
    amount: -1,
    createdAt: -1,
  });

  const productTitle = product.title;
  const productId = String(product._id);
  const amountFormatted = highestBid ? formatRs(highestBid.amount) : "";
  let sent = false;

  if (highestBid) {
    await ensureWinnerSaleOrder(product, highestBid).catch(() => {});

    const existingWon = await findExistingAuctionNotification({
      userId: highestBid.userId,
      titles: "You Won the Auction",
      productId,
      productTitle,
    });

    if (!existingWon) {
      await notifyAuctionWon({
        buyerId: highestBid.userId,
        productTitle,
        productId,
        amountFormatted,
      });
      sent = true;
    }
  }

  const existingEnded = await findExistingAuctionNotification({
    userId: product.sellerId,
    titles: ["Auction Ended — Sold", "Auction Ended — No Bids"],
    productId,
    productTitle,
  });

  if (!existingEnded) {
    await notifyAuctionEnded({
      sellerId: product.sellerId,
      productTitle,
      productId,
      amountFormatted,
      hasWinner: Boolean(highestBid),
    });
    sent = true;
  }

  if (!product.auctionEndNotifiedAt) {
    await Product.updateOne(
      {
        _id: product._id,
        $or: [{ auctionEndNotifiedAt: null }, { auctionEndNotifiedAt: { $exists: false } }],
      },
      { $set: { auctionEndNotifiedAt: new Date() } },
    );
  }

  return sent;
}

async function finalizeAuction(product) {
  if (!product || product.listingType !== "sale") return false;

  const endDate = getAuctionEndDate(product);
  if (Date.now() < endDate.getTime()) return false;

  // Always backfill missing notifications (even if flag was set earlier).
  if (product.auctionEndNotifiedAt) {
    return ensureAuctionNotifications(product);
  }

  const claimed = await Product.findOneAndUpdate(
    {
      _id: product._id,
      listingType: "sale",
      $or: [{ auctionEndNotifiedAt: null }, { auctionEndNotifiedAt: { $exists: false } }],
      status: { $in: ["active", "pending", "sold"] },
    },
    { $set: { auctionEndNotifiedAt: new Date() } },
    { new: true },
  );

  // Another process claimed it, or status blocked the claim — still try to notify.
  if (!claimed) {
    return ensureAuctionNotifications(product);
  }

  const highestBid = await Bid.findOne({ productId: claimed._id }).sort({
    amount: -1,
    createdAt: -1,
  });

  const amountFormatted = highestBid ? formatRs(highestBid.amount) : "";
  const productTitle = claimed.title;
  const productId = String(claimed._id);

  if (highestBid) {
    // Keep listing available for winner checkout — mark sold only after Stripe payment.
    await ensureWinnerSaleOrder(claimed, highestBid).catch(() => {});

    await notifyAuctionWon({
      buyerId: highestBid.userId,
      productTitle,
      productId,
      amountFormatted,
    });

    await notifyAuctionEnded({
      sellerId: claimed.sellerId,
      productTitle,
      productId,
      amountFormatted,
      hasWinner: true,
    });
  } else {
    await notifyAuctionEnded({
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
    status: { $in: ["active", "sold"] },
    verificationStatus: "approved",
    $or: [{ auctionEndNotifiedAt: null }, { auctionEndNotifiedAt: { $exists: false } }],
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

  // Also retry recently ended auctions that were flagged but may have missed notifies.
  const recentlyFlagged = await Product.find({
    listingType: "sale",
    status: { $in: ["active", "sold"] },
    verificationStatus: "approved",
    auctionEndNotifiedAt: { $ne: null },
    updatedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  })
    .sort({ auctionEndNotifiedAt: -1 })
    .limit(20);

  for (const product of recentlyFlagged) {
    const endDate = getAuctionEndDate(product);
    if (Date.now() < endDate.getTime()) continue;
    await ensureAuctionNotifications(product);
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
  ensureAuctionNotifications,
  ensureWinnerSaleOrder,
  getAuctionEndDate,
  parseAmount,
};

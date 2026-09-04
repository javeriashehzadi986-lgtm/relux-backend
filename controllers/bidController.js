const mongoose = require("mongoose");
const Bid = require("../models/Bid");
const Product = require("../models/Product");
const User = require("../models/User");
const {
  notifyNewBid,
  notifyBidPlaced,
  notifyOutbid,
} = require("../services/notificationService");
const {
  emitAuctionUpdate,
  emitAuctionViewerUpdate,
} = require("../services/auctionSocketService");
const { maybeFinalizeProduct } = require("../services/auctionFinalizeService");

const PUBLIC_LISTING_FILTER = {
  verificationStatus: "approved",
  status: "active",
};

const DEFAULT_BID_INCREMENT = 2500;

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function parseAmount(value) {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function formatRs(amount) {
  return `Rs. ${Math.round(amount).toLocaleString("en-PK")}`;
}

function formatBidderLabel(name) {
  const parts = String(name ?? "Bidder").trim().split(/\s+/);
  if (parts.length === 1) {
    return `${parts[0].slice(0, 1)}***`;
  }
  return `${parts[0].slice(0, 1)}.${parts[parts.length - 1].slice(0, 1)}.`;
}

function formatRelativeTime(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTimeRemaining(endDate) {
  if (!endDate) return "24h 00m";

  const diffMs = Math.max(0, new Date(endDate).getTime() - Date.now());
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function getCountdown(endDate) {
  if (!endDate) {
    return { hours: 24, minutes: 0, seconds: 0 };
  }

  const diffMs = Math.max(0, new Date(endDate).getTime() - Date.now());
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
  return { hours, minutes, seconds };
}

function isAuctionProduct(product) {
  return product.listingType === "sale";
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

function getStartingBid(product) {
  return (
    parseAmount(product.startingBid) ||
    parseAmount(product.salePrice) ||
    0
  );
}

function getBidIncrement(product) {
  return parseAmount(product.minBid) || DEFAULT_BID_INCREMENT;
}

async function getHighestBid(productId) {
  return Bid.findOne({ productId }).sort({ amount: -1, createdAt: -1 });
}

async function getBidderCount(productId) {
  const bidders = await Bid.distinct("userId", { productId });
  return bidders.length;
}

async function buildAuctionSummary(product, userId) {
  const highestBid = await getHighestBid(product._id);
  const startingBid = getStartingBid(product);
  const increment = getBidIncrement(product);
  const currentBid = highestBid?.amount ?? startingBid;
  const minimumNextBid = highestBid ? currentBid + increment : startingBid;
  const bidderCount = await getBidderCount(product._id);
  const auctionEndDate = getAuctionEndDate(product);
  const auctionEnded = Date.now() >= auctionEndDate.getTime();
  const timeRemainingMs = Math.max(0, auctionEndDate.getTime() - Date.now());

  let viewer = null;
  if (userId) {
    const userHighest = await Bid.findOne({ productId: product._id, userId })
      .sort({ amount: -1, createdAt: -1 })
      .lean();

    const isWinning = Boolean(
      userHighest &&
        highestBid &&
        String(userHighest._id) === String(highestBid._id),
    );
    const hasWon = Boolean(auctionEnded && isWinning);

    let bidStatus = "Open";
    if (auctionEnded) {
      bidStatus = hasWon ? "Won" : userHighest ? "Expired" : "Open";
    } else if (userHighest) {
      bidStatus = isWinning ? "Winning" : "Outbid";
    }

    viewer = {
      yourHighestBid: userHighest?.amount ?? null,
      yourHighestBidFormatted: userHighest ? formatRs(userHighest.amount) : null,
      isWinning,
      hasWon,
      bidStatus,
    };
  }

  return {
    currentBid,
    currentBidFormatted: formatRs(currentBid),
    minimumNextBid,
    minimumNextBidFormatted: formatRs(minimumNextBid),
    bidderCount,
    bidStatus: auctionEnded ? "Ended" : "Active",
    auctionEndDate: auctionEndDate.toISOString(),
    timeRemainingMs,
    timeRemaining: formatTimeRemaining(auctionEndDate),
    countdown: getCountdown(auctionEndDate),
    auctionEnded,
    isAuction: isAuctionProduct(product),
    startingBid,
    viewer,
  };
}

async function buildBidHistory(productId, limit = 20) {
  const bids = await Bid.find({ productId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const highestBid = await getHighestBid(productId);
  const userIds = [...new Set(bids.map((bid) => String(bid.userId)))];
  const users = await User.find({ _id: { $in: userIds } }).select("name").lean();
  const userMap = new Map(users.map((user) => [String(user._id), user.name]));

  return bids.map((bid) => {
    const name = userMap.get(String(bid.userId)) ?? "Bidder";
    const initial = name.trim().charAt(0).toUpperCase() || "B";
    const isWinner = Boolean(
      highestBid && String(highestBid._id) === String(bid._id),
    );

    return {
      id: bid._id,
      name: formatBidderLabel(name),
      initial,
      amount: bid.amount,
      amountFormatted: formatRs(bid.amount),
      timestamp: formatRelativeTime(bid.createdAt),
      createdAt: bid.createdAt,
      isWinner,
    };
  });
}

async function getApprovedProduct(productId, { allowSold = false } = {}) {
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    return null;
  }

  return Product.findOne({
    _id: productId,
    verificationStatus: "approved",
    status: allowSold ? { $in: ["active", "sold"] } : "active",
  });
}

async function getProductBids(req, res) {
  try {
    const product = await getApprovedProduct(req.params.productId, { allowSold: true });
    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }

    if (!isAuctionProduct(product)) {
      return res.status(400).json({ message: "This listing is not an auction item" });
    }

    await maybeFinalizeProduct(product).catch(() => {});

    const freshProduct = (await Product.findById(product._id)) || product;
    const summary = await buildAuctionSummary(freshProduct, req.user?._id);
    const history = await buildBidHistory(product._id);

    res.json({ summary, history, viewer: summary.viewer ?? null });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function placeBid(req, res) {
  try {
    const productId = String(req.body.productId ?? "").trim();
    const amount = parseAmount(req.body.amount);

    if (!productId) {
      return res.status(400).json({ message: "Product id is required" });
    }
    if (!amount) {
      return res.status(400).json({ message: "Enter a valid bid amount" });
    }

    const product = await getApprovedProduct(productId);
    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }
    if (!isAuctionProduct(product)) {
      return res.status(400).json({ message: "This listing is not an auction item" });
    }
    if (String(product.sellerId) === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot bid on your own listing" });
    }

    const auctionEndDate = getAuctionEndDate(product);
    if (Date.now() >= auctionEndDate.getTime()) {
      return res.status(400).json({ message: "This auction has ended" });
    }

    const highestBid = await getHighestBid(product._id);
    const startingBid = getStartingBid(product);
    const increment = getBidIncrement(product);
    const minimumAllowed = highestBid
      ? highestBid.amount + increment
      : startingBid;

    if (amount < minimumAllowed) {
      return res.status(400).json({
        message: `Your bid must be at least ${formatRs(minimumAllowed)}`,
        minimumNextBid: minimumAllowed,
      });
    }

    const bid = await Bid.create({
      userId: req.user._id,
      productId: product._id,
      amount,
    });

    const amountFormatted = formatRs(amount);

    await Promise.all([
      notifyBidPlaced({
        buyerId: req.user._id,
        productTitle: product.title,
        productId: product._id,
        amountFormatted,
      }),
      notifyNewBid({
        sellerId: product.sellerId,
        productTitle: product.title,
        productId: product._id,
        amountFormatted,
      }),
      highestBid && String(highestBid.userId) !== String(req.user._id)
        ? notifyOutbid({
            buyerId: highestBid.userId,
            productTitle: product.title,
            productId: product._id,
          })
        : Promise.resolve(),
    ]);

    const summary = await buildAuctionSummary(product, req.user._id);
    const history = await buildBidHistory(product._id);
    const publicSummary = await buildAuctionSummary(product, null);

    emitAuctionUpdate(product._id, {
      summary: publicSummary,
      history,
    });

    if (highestBid && String(highestBid.userId) !== String(req.user._id)) {
      const outbidSummary = await buildAuctionSummary(product, highestBid.userId);
      emitAuctionViewerUpdate(highestBid.userId, {
        productId: String(product._id),
        summary: outbidSummary,
        history,
        viewer: outbidSummary.viewer,
      });
    }

    res.status(201).json({
      message: "Bid placed successfully",
      bid: bid.toPublicJSON(),
      summary,
      history,
      viewer: summary.viewer,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function buildMyBidCard(product, userId) {
  const summary = await buildAuctionSummary(product, userId);
  const userHighest = await Bid.findOne({ productId: product._id, userId })
    .sort({ amount: -1, createdAt: -1 })
    .lean();

  if (!userHighest) return null;

  const seller = await User.findById(product.sellerId).select("name").lean();
  const originalPrice = parseAmount(product.salePrice) || summary.startingBid;
  const isWinning = summary.viewer?.isWinning;
  const auctionEnded = summary.auctionEnded;
  const hasWon = summary.viewer?.hasWon;

  let status = "active";
  let statusLabel = "Active";
  let bannerType = "winning";
  let bannerText = "You are currently the highest bidder.";
  let primaryAction = "Increase Bid";
  let dimmed = false;
  let bidDelta = null;

  if (auctionEnded) {
    status = hasWon ? "won" : "expired";
    statusLabel = hasWon ? "Won" : "Expired";
    bannerType = hasWon ? "winning" : "outbid";
    bannerText = hasWon
      ? "You won this auction. Proceed to checkout to complete your purchase."
      : "This auction ended and your bid was not the highest.";
    primaryAction = hasWon ? "Proceed to Checkout" : "View Details";
    dimmed = !hasWon;
  } else if (isWinning) {
    status = "winning";
    statusLabel = "Winning";
  } else {
    status = "outbid";
    statusLabel = "Outbid";
    bannerType = "outbid";
    bannerText = "You have been outbid. Increase your bid to win!";
    primaryAction = "Place Higher Bid";
    dimmed = true;
    bidDelta = `-${Math.max(
      1,
      Math.round((summary.currentBid - userHighest.amount) / 1000),
    )}k`;
  }

  const auctionEndDate = getAuctionEndDate(product);
  const timeRemaining = formatTimeRemaining(auctionEndDate);
  const diffMs = Math.max(0, auctionEndDate.getTime() - Date.now());
  const timeUrgent = !auctionEnded && diffMs <= 2 * 60 * 60 * 1000;

  return {
    id: String(userHighest._id),
    dressId: String(product._id),
    productId: String(product._id),
    title: product.title,
    brand: product.brand || "Relux Seller",
    image: product.mainImage,
    seller: seller?.name || product.brand || "Seller",
    status,
    statusLabel,
    timeRemaining: auctionEnded ? "Ended" : timeRemaining,
    timeUrgent,
    bannerType,
    bannerText,
    myBidAmount: userHighest.amount,
    myBid: formatRs(userHighest.amount),
    originalPrice: formatRs(originalPrice),
    currentHighest: summary.currentBidFormatted,
    primaryAction,
    secondaryAction: "View Details",
    dimmed,
    bidDelta,
    hasWon,
  };
}

async function getMyBids(req, res) {
  try {
    const userBids = await Bid.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    const productIds = [...new Set(userBids.map((bid) => String(bid.productId)))];
    const products = await Product.find({
      _id: { $in: productIds },
      listingType: "sale",
    });

    // Backfill win notifications for any ended auctions this buyer won.
    await Promise.all(
      products.map((product) => maybeFinalizeProduct(product).catch(() => {})),
    );

    const cards = (
      await Promise.all(
        products.map((product) => buildMyBidCard(product, req.user._id)),
      )
    ).filter(Boolean);

    res.json({ bids: cards });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  getProductBids,
  placeBid,
  getMyBids,
};

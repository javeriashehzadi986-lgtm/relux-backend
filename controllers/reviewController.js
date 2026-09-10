const mongoose = require("mongoose");
const SellerReview = require("../models/SellerReview");
const User = require("../models/User");
const Product = require("../models/Product");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function formatMemberSince(date) {
  if (!date) return "2022";
  return String(new Date(date).getFullYear());
}

function buildRatingStats(reviews) {
  if (!reviews.length) {
    return { average: 0, count: 0 };
  }

  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return {
    average: Math.round((total / reviews.length) * 10) / 10,
    count: reviews.length,
  };
}

async function getSellerReviews(req, res) {
  try {
    const sellerId = String(req.params.sellerId ?? "").trim();
    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ message: "Invalid seller id" });
    }

    // Optional: scope reviews to a single product (used on the listing detail page).
    const productId = String(req.query.productId ?? "").trim();
    const scopeToProduct = Boolean(productId);
    if (scopeToProduct && !mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const seller = await User.findById(sellerId).select("name createdAt role");
    if (!seller) {
      return res.status(404).json({ message: "Seller not found" });
    }

    const query = {
      sellerId,
      status: { $in: ["active", "flagged"] },
    };
    if (scopeToProduct) {
      query.productId = productId;
    }

    const reviews = await SellerReview.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    const publicReviews = reviews
      .filter((review) => review.status === "active")
      .map((review) => review.toPublicJSON());

    res.json({
      reviews: publicReviews,
      stats: buildRatingStats(publicReviews),
      seller: {
        id: seller._id,
        name: seller.name,
        memberSince: formatMemberSince(seller.createdAt),
      },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function createSellerReview(req, res) {
  try {
    const sellerId = String(req.body.sellerId ?? "").trim();
    const rating = Number(req.body.rating);
    const quote = String(req.body.quote ?? "").trim();
    const authorName = String(req.body.authorName ?? req.body.author ?? "").trim();
    const reportReason = String(req.body.reportReason ?? "").trim();
    const reportDetails = String(req.body.reportDetails ?? "").trim();
    const productId = req.body.productId
      ? String(req.body.productId).trim()
      : null;

    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ message: "Invalid seller id" });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }
    if (!quote) {
      return res.status(400).json({ message: "Review text is required" });
    }
    if (String(req.user._id) === sellerId) {
      return res.status(400).json({ message: "You cannot review your own seller profile" });
    }

    const seller = await User.findById(sellerId);
    if (!seller) {
      return res.status(404).json({ message: "Seller not found" });
    }

    if (productId) {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: "Invalid product id" });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: "Listing not found" });
      }
      if (String(product.sellerId) !== sellerId) {
        return res.status(400).json({ message: "Listing does not belong to this seller" });
      }
    }

    const hasReport = Boolean(reportReason || reportDetails);
    const review = await SellerReview.create({
      sellerId,
      userId: req.user._id,
      productId: productId || null,
      rating,
      quote,
      authorName: authorName || req.user.name || "Verified Buyer",
      reportReason,
      reportDetails,
      // Keep reviews visible on the seller page; admins review reports separately.
      status: "active",
    });

    const allActiveReviews = await SellerReview.find({
      sellerId,
      status: "active",
    });

    res.status(201).json({
      message: hasReport
        ? "Review and report submitted successfully"
        : "Review submitted successfully",
      review: review.toPublicJSON(),
      stats: buildRatingStats(allActiveReviews.map((entry) => entry.toPublicJSON())),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  getSellerReviews,
  createSellerReview,
};

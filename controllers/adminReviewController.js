const SellerReview = require("../models/SellerReview");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function getInitials(name = "") {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function formatReviewDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toAdminStatus(status) {
  return status === "removed" ? "hidden" : status;
}

function fromAdminStatus(status) {
  if (status === "hidden") return "removed";
  return status;
}

function toAdminReviewJSON(review) {
  const seller = review.sellerId;
  const buyer = review.userId;
  const product = review.productId;
  const reviewerName =
    review.authorName ||
    (buyer && typeof buyer === "object" ? buyer.name : "") ||
    "Verified Buyer";

  return {
    id: review._id.toString(),
    reviewerName,
    reviewerInitials: getInitials(reviewerName),
    date: formatReviewDate(review.createdAt),
    createdAt: review.createdAt,
    product: product && typeof product === "object" ? product.title : "General seller review",
    productId: product?._id?.toString?.() ?? product?.toString?.() ?? null,
    seller:
      seller && typeof seller === "object" ? seller.name : "Unknown seller",
    sellerId: seller?._id?.toString?.() ?? seller?.toString?.() ?? null,
    buyerId: buyer?._id?.toString?.() ?? buyer?.toString?.() ?? null,
    rating: review.rating,
    status: toAdminStatus(review.status),
    quote: review.quote,
    reportReason: review.reportReason || "",
    reportDetails: review.reportDetails || "",
    hasReport: Boolean(review.reportReason || review.reportDetails),
  };
}

async function buildStats() {
  const [totalReviews, activeReviews, flaggedCount, todayNew] = await Promise.all([
    SellerReview.countDocuments({}),
    SellerReview.find({ status: "active" }).select("rating").lean(),
    SellerReview.countDocuments({ status: "flagged" }),
    SellerReview.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    }),
  ]);

  const averageRating =
    activeReviews.length > 0
      ? Math.round(
          (activeReviews.reduce((sum, review) => sum + review.rating, 0) /
            activeReviews.length) *
            10,
        ) / 10
      : 0;

  return {
    totalReviews,
    totalChange: "",
    averageRating,
    flaggedCount,
    todayNew,
  };
}

/** Admin: list all seller reviews with filters */
async function listReviews(req, res) {
  try {
    const { q, rating, status } = req.query;
    const filter = {};

    if (rating && rating !== "all") {
      const value = Number(rating);
      if (value >= 1 && value <= 5) {
        filter.rating = value;
      }
    }

    if (status && status !== "all") {
      filter.status = fromAdminStatus(status);
    }

    let reviews = await SellerReview.find(filter)
      .populate("sellerId", "name email role")
      .populate("userId", "name email")
      .populate("productId", "title brand")
      .sort({ createdAt: -1 })
      .limit(200);

    if (q?.trim()) {
      const query = q.trim().toLowerCase();
      reviews = reviews.filter((review) => {
        const mapped = toAdminReviewJSON(review);
        return (
          mapped.reviewerName.toLowerCase().includes(query) ||
          mapped.seller.toLowerCase().includes(query) ||
          mapped.product.toLowerCase().includes(query) ||
          mapped.quote.toLowerCase().includes(query)
        );
      });
    }

    const stats = await buildStats();

    res.json({
      reviews: reviews.map((review) => toAdminReviewJSON(review)),
      stats,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: update review status (active, flagged, removed/hidden) */
async function updateReviewStatus(req, res) {
  try {
    const status = fromAdminStatus(String(req.body.status ?? "").trim());
    const allowed = ["active", "flagged", "removed"];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: "Status must be active, flagged, or hidden",
      });
    }

    const review = await SellerReview.findById(req.params.id)
      .populate("sellerId", "name email role")
      .populate("userId", "name email")
      .populate("productId", "title brand");

    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    review.status = status;
    await review.save();

    const stats = await buildStats();

    res.json({
      message: "Review updated",
      review: toAdminReviewJSON(review),
      stats,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: permanently delete a review */
async function deleteReview(req, res) {
  try {
    const review = await SellerReview.findByIdAndDelete(req.params.id);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    const stats = await buildStats();

    res.json({
      message: "Review removed permanently",
      stats,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  listReviews,
  updateReviewStatus,
  deleteReview,
};

const mongoose = require("mongoose");

const sellerReviewSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    userId: {
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
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    quote: {
      type: String,
      required: true,
      trim: true,
    },
    authorName: {
      type: String,
      trim: true,
      default: "",
    },
    reportReason: {
      type: String,
      trim: true,
      default: "",
    },
    reportDetails: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "flagged", "removed"],
      default: "active",
    },
  },
  { timestamps: true },
);

sellerReviewSchema.index({ sellerId: 1, createdAt: -1 });

sellerReviewSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    sellerId: this.sellerId,
    productId: this.productId,
    rating: this.rating,
    quote: this.quote,
    author: this.authorName || "Verified Buyer",
    createdAt: this.createdAt,
    hasReport: Boolean(this.reportReason || this.reportDetails),
  };
};

module.exports = mongoose.model("SellerReview", sellerReviewSchema);

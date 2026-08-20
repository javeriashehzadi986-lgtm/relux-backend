const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    brand: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },
    listingType: { type: String, enum: ["sale", "rent"], required: true },
    listingSize: { type: String, trim: true, default: "M" },
    listingCondition: { type: String, trim: true, default: "Like New" },
    mainCategory: { type: String, trim: true, required: true },
    style: { type: String, trim: true, default: "" },
    clothingType: { type: String, trim: true, default: "" },
    salePrice: { type: String, trim: true, default: "" },
    startingBid: { type: String, trim: true, default: "" },
    minBid: { type: String, trim: true, default: "" },
    auctionEndDate: { type: String, trim: true, default: "" },
    rentPrice: { type: String, trim: true, default: "" },
    itemPrice: { type: String, trim: true, default: "" },
    mainImage: { type: String, required: true },
    gallery: { type: [String], default: [] },
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    status: {
      type: String,
      enum: ["pending", "active", "sold", "rented", "removed"],
      default: "pending",
    },
    adminNote: { type: String, default: "" },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);

productSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    sellerId: this.sellerId,
    title: this.title,
    brand: this.brand,
    description: this.description,
    listingType: this.listingType,
    listingSize: this.listingSize,
    listingCondition: this.listingCondition,
    mainCategory: this.mainCategory,
    style: this.style,
    clothingType: this.clothingType,
    salePrice: this.salePrice,
    startingBid: this.startingBid,
    minBid: this.minBid,
    auctionEndDate: this.auctionEndDate,
    rentPrice: this.rentPrice,
    itemPrice: this.itemPrice,
    mainImage: this.mainImage,
    gallery: this.gallery,
    verificationStatus: this.verificationStatus,
    status: this.status,
    adminNote: this.adminNote,
    submittedAt: this.createdAt,
    reviewedAt: this.reviewedAt,
  };
};

module.exports = mongoose.model("Product", productSchema);

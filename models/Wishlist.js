const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    itemId: { type: String, required: true, trim: true },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    title: { type: String, trim: true, default: "" },
    brand: { type: String, trim: true, default: "" },
    image: { type: String, default: "" },
    listingType: { type: String, enum: ["rent", "resale", "sale"], default: "resale" },
    price: { type: String, trim: true, default: "" },
    badge: { type: String, trim: true, default: "Pre-owned" },
    badgeVariant: { type: String, trim: true, default: "secondary" },
    sortPrice: { type: Number, default: 0 },
  },
  { timestamps: true },
);

wishlistSchema.index({ userId: 1, itemId: 1 }, { unique: true });

wishlistSchema.methods.toPublicJSON = function toPublicJSON() {
  const listingType = this.listingType === "sale" ? "resale" : this.listingType;

  return {
    id: this.itemId,
    itemId: this.itemId,
    productId: this.productId,
    title: this.title,
    brand: this.brand,
    image: this.image,
    listingType,
    price: this.price,
    badge: this.badge,
    badgeVariant: this.badgeVariant,
    sortPrice: this.sortPrice,
    addedAt: this.createdAt ? this.createdAt.getTime() : Date.now(),
  };
};

module.exports = mongoose.model("Wishlist", wishlistSchema);

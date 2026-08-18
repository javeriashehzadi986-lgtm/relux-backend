const mongoose = require("mongoose");

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    type: { type: String, enum: ["main", "sub"], required: true, index: true },
    parentSlug: { type: String, trim: true, lowercase: true, default: null, index: true },
    icon: { type: String, trim: true, default: "category" },
    iconVariant: {
      type: String,
      enum: ["primary-dim", "primary-container", "tertiary"],
      default: "primary-dim",
    },
    imageUrl: { type: String, trim: true, default: "" },
    productStyleKey: { type: String, trim: true, default: "" },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

categorySchema.methods.toAdminJSON = function toAdminJSON() {
  return {
    id: this._id.toString(),
    slug: this.slug,
    name: this.name,
    type: this.type,
    parentSlug: this.parentSlug,
    icon: this.icon,
    iconVariant: this.iconVariant,
    imageUrl: this.imageUrl,
    productStyleKey: this.productStyleKey,
    sortOrder: this.sortOrder,
    isActive: this.isActive,
  };
};

module.exports = mongoose.model("Category", categorySchema);

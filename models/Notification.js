const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    highlight: {
      type: String,
      trim: true,
      default: "",
    },
    category: {
      type: String,
      enum: ["orders", "payments", "listings", "bids", "system"],
      default: "system",
      index: true,
    },
    iconVariant: {
      type: String,
      enum: ["primary", "secondary", "tertiary", "muted"],
      default: "primary",
    },
    imageUrl: {
      type: String,
      trim: true,
      default: "",
    },
    link: {
      type: String,
      trim: true,
      default: "",
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });

notificationSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    title: this.title,
    message: this.message,
    highlight: this.highlight,
    category: this.category,
    iconVariant: this.iconVariant,
    imageUrl: this.imageUrl,
    link: this.link,
    unread: !this.read,
    read: this.read,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("Notification", notificationSchema);

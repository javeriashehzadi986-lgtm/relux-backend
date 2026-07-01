const mongoose = require("mongoose");

const sellerVerificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    cnicFront: { type: String, required: true },
    cnicBack: { type: String, required: true },
    stripeConnected: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    adminNote: { type: String, default: "" },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);

sellerVerificationSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    userId: this.userId,
    verificationStatus: this.verificationStatus,
    stripeConnected: this.stripeConnected,
    hasCnicFront: Boolean(this.cnicFront),
    hasCnicBack: Boolean(this.cnicBack),
    adminNote: this.adminNote,
    submittedAt: this.createdAt,
    reviewedAt: this.reviewedAt,
  };
};

module.exports = mongoose.model("SellerVerification", sellerVerificationSchema);

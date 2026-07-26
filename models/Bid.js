const mongoose = require("mongoose");

const bidSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { timestamps: true },
);

bidSchema.index({ productId: 1, amount: -1, createdAt: -1 });
bidSchema.index({ userId: 1, productId: 1 });

bidSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    userId: this.userId,
    productId: this.productId,
    amount: this.amount,
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("Bid", bidSchema);

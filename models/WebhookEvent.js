const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema(
  {
    stripeEventId: { type: String, required: true, unique: true, index: true },
    type: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);

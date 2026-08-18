const mongoose = require("mongoose");

const broadcastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    recipients: {
      type: String,
      enum: ["all", "buyers", "sellers"],
      required: true,
    },
    priority: {
      type: String,
      enum: ["normal", "important", "urgent"],
      default: "normal",
    },
    sentCount: { type: Number, default: 0 },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

function formatTime(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const RECIPIENT_LABELS = {
  all: "All Users",
  buyers: "Buyers Only",
  sellers: "Sellers Only",
};

broadcastSchema.methods.toAdminJSON = function toAdminJSON() {
  return {
    id: this._id.toString(),
    title: this.title,
    preview: this.message.length > 80 ? `${this.message.slice(0, 77)}...` : this.message,
    sentTo: RECIPIENT_LABELS[this.recipients] || this.recipients,
    recipients: this.recipients,
    priority: this.priority,
    status: "sent",
    sentCount: this.sentCount,
    time: formatTime(this.createdAt),
    createdAt: this.createdAt,
  };
};

module.exports = mongoose.model("Broadcast", broadcastSchema);

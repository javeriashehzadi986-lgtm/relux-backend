const mongoose = require("mongoose");

const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 180 },
    message: { type: String, required: true, trim: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ["new", "read", "resolved"],
      default: "new",
      index: true,
    },
    adminNote: { type: String, trim: true, default: "" },
    adminReply: { type: String, trim: true, default: "" },
    repliedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

function formatDateLabel(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

contactMessageSchema.methods.toAdminJSON = function toAdminJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    message: this.message,
    status: this.status,
    adminNote: this.adminNote || "",
    adminReply: this.adminReply || "",
    repliedAt: this.repliedAt || null,
    repliedDate: formatDateLabel(this.repliedAt),
    date: formatDateLabel(this.createdAt),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

module.exports = mongoose.model("ContactMessage", contactMessageSchema);

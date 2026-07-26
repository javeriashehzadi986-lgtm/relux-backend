const mongoose = require("mongoose");

const BUYER_ISSUE_TYPES = ["Order", "Rental", "Payment", "Return", "Other"];
const SELLER_ISSUE_TYPES = ["Listing", "Order", "Payment", "Other"];
const ALL_ISSUE_TYPES = [...new Set([...BUYER_ISSUE_TYPES, ...SELLER_ISSUE_TYPES])];

const reportSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reporterRole: {
      type: String,
      enum: ["buyer", "seller"],
      required: true,
      index: true,
    },
    reporterName: {
      type: String,
      trim: true,
      default: "",
    },
    issueType: {
      type: String,
      enum: ALL_ISSUE_TYPES,
      required: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    images: {
      type: [String],
      default: [],
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      index: true,
    },
    involvedSellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    involvedBuyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    productTitle: { type: String, trim: true, default: "" },
    sellerName: { type: String, trim: true, default: "" },
    buyerName: { type: String, trim: true, default: "" },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved"],
      default: "open",
      index: true,
    },
    disputeStage: {
      type: String,
      enum: ["none", "awaiting_seller", "seller_responded", "resolved"],
      default: "none",
      index: true,
    },
    adminReply: {
      type: String,
      trim: true,
      default: "",
    },
    adminMessageToSeller: {
      type: String,
      trim: true,
      default: "",
    },
    sellerResponse: {
      type: String,
      trim: true,
      default: "",
    },
    sellerRespondedAt: { type: Date },
    decision: {
      type: String,
      trim: true,
      default: "",
    },
    adminNote: {
      type: String,
      trim: true,
      default: "",
    },
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
    day: "2-digit",
    year: "numeric",
  });
}

function statusLabel(status) {
  if (status === "resolved") return "Resolved";
  if (status === "in_progress") return "In Progress";
  return "Open";
}

function statusVariant(status) {
  if (status === "resolved") return "resolved";
  if (status === "in_progress") return "open";
  return "open";
}

function idString(value) {
  return value?._id?.toString?.() ?? value?.toString?.() ?? value ?? null;
}

reportSchema.methods.buildDetailForViewer = function buildDetailForViewer(viewerRole) {
  const lines = [];

  if (this.productTitle) {
    lines.push(`Product: ${this.productTitle}`);
  }
  if (this.sellerName && viewerRole !== "seller") {
    lines.push(`Seller: ${this.sellerName}`);
  }
  if (this.buyerName && viewerRole !== "buyer") {
    lines.push(`Buyer: ${this.buyerName}`);
  }

  lines.push(`Your message: ${this.message}`);

  if (this.disputeStage === "awaiting_seller" || this.adminMessageToSeller) {
    if (viewerRole === "seller") {
      lines.push(
        `Admin asks you: ${
          this.adminMessageToSeller || "Please respond to this buyer complaint."
        }`,
      );
    } else {
      lines.push("Admin has contacted the seller for a response.");
    }
  }

  if (this.sellerResponse) {
    if (viewerRole === "seller") {
      lines.push(`Your response: ${this.sellerResponse}`);
    } else if (viewerRole === "buyer") {
      lines.push("Seller has submitted a response. Admin is reviewing.");
    } else {
      lines.push(`Seller response: ${this.sellerResponse}`);
    }
  }

  if (this.decision || this.adminReply) {
    lines.push(`Admin decision: ${this.decision || this.adminReply}`);
  } else if (this.status === "open") {
    lines.push("Your request is under review. Our team will update you within 24 hours.");
  }

  return lines.join("\n\n");
};

reportSchema.methods.toReporterJSON = function toReporterJSON(viewerUserId, viewerRole) {
  const viewerId = idString(viewerUserId);
  const isReporter = idString(this.reporterId) === viewerId;
  const isInvolvedSeller = idString(this.involvedSellerId) === viewerId;
  const needsSellerResponse =
    isInvolvedSeller &&
    this.disputeStage === "awaiting_seller" &&
    this.status !== "resolved";

  return {
    id: this.reportId,
    mongoId: this._id.toString(),
    title: this.subject,
    issueType: this.issueType,
    message: this.message,
    images: this.images || [],
    date: formatDateLabel(this.createdAt),
    status: statusLabel(this.status),
    statusVariant: statusVariant(this.status),
    disputeStage: this.disputeStage,
    isDispute: Boolean(this.involvedSellerId && this.involvedBuyerId),
    isReporter,
    needsSellerResponse,
    productTitle: this.productTitle || "",
    sellerName: this.sellerName || "",
    buyerName: this.buyerName || "",
    orderId: idString(this.orderId),
    adminMessageToSeller: this.adminMessageToSeller || "",
    sellerResponse: this.sellerResponse || "",
    decision: this.decision || this.adminReply || "",
    detail: this.buildDetailForViewer(viewerRole),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

reportSchema.methods.toAdminJSON = function toAdminJSON() {
  const reporter = this.reporterId;
  const seller = this.involvedSellerId;
  const buyer = this.involvedBuyerId;

  const reporterName =
    (reporter && typeof reporter === "object" && reporter.name) ||
    this.reporterName ||
    "User";
  const reporterEmail =
    (reporter && typeof reporter === "object" && reporter.email) || "";
  const roleLabel = this.reporterRole === "seller" ? "Seller" : "Buyer";
  const adminStatus = this.status === "open" ? "pending" : this.status;

  const sellerName =
    (seller && typeof seller === "object" && seller.name) || this.sellerName || "";
  const sellerEmail = (seller && typeof seller === "object" && seller.email) || "";
  const buyerName =
    (buyer && typeof buyer === "object" && buyer.name) || this.buyerName || "";

  return {
    id: this.reportId,
    mongoId: this._id.toString(),
    reportedBy: reporterName,
    reporterId: idString(this.reporterId),
    reporterRole: this.reporterRole,
    reporterAvatar: null,
    reporterMeta: `${roleLabel}${reporterEmail ? ` • ${reporterEmail}` : ""}`,
    reportAgainst: this.subject,
    reportType: this.issueType.toLowerCase(),
    issueType: this.issueType,
    subject: this.subject,
    description: this.message,
    evidence: this.images || [],
    itemImage: this.images?.[0] || null,
    orderId: idString(this.orderId),
    productId: idString(this.productId),
    productTitle: this.productTitle || "",
    seller: sellerName || null,
    sellerId: idString(this.involvedSellerId),
    sellerEmail,
    buyerName: buyerName || null,
    buyerId: idString(this.involvedBuyerId),
    isDispute: Boolean(this.involvedSellerId && this.involvedBuyerId),
    disputeStage: this.disputeStage,
    adminMessageToSeller: this.adminMessageToSeller || "",
    sellerResponse: this.sellerResponse || "",
    sellerRespondedAt: this.sellerRespondedAt || null,
    decision: this.decision || "",
    date: formatDateLabel(this.createdAt),
    status: adminStatus,
    adminReply: this.adminReply || "",
    adminNote: this.adminNote || "",
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Report = mongoose.model("Report", reportSchema);
Report.BUYER_ISSUE_TYPES = BUYER_ISSUE_TYPES;
Report.SELLER_ISSUE_TYPES = SELLER_ISSUE_TYPES;
Report.ALL_ISSUE_TYPES = ALL_ISSUE_TYPES;

module.exports = Report;

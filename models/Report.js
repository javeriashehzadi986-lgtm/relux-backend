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
      enum: [
        "none",
        "awaiting_seller",
        "awaiting_buyer",
        "awaiting_both",
        "seller_responded",
        "buyer_responded",
        "both_responded",
        "resolved",
      ],
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
    adminMessageToBuyer: {
      type: String,
      trim: true,
      default: "",
    },
    sellerResponse: {
      type: String,
      trim: true,
      default: "",
    },
    sellerResponses: {
      type: [
        {
          text: { type: String, trim: true, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    sellerRespondedAt: { type: Date },
    buyerResponse: {
      type: String,
      trim: true,
      default: "",
    },
    buyerResponses: {
      type: [
        {
          text: { type: String, trim: true, required: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    buyerRespondedAt: { type: Date },
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

function formatResponseThread(entries, fallbackSingle) {
  const list = Array.isArray(entries) ? entries.filter((item) => item?.text?.trim()) : [];
  if (list.length > 0) {
    return list
      .map((item, index) => {
        const when = item.createdAt
          ? new Date(item.createdAt).toLocaleString("en-PK", {
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })
          : "";
        return list.length > 1
          ? `${index + 1}. ${item.text.trim()}${when ? ` (${when})` : ""}`
          : item.text.trim();
      })
      .join("\n\n");
  }
  return String(fallbackSingle || "").trim();
}

function getSellerResponseEntries(report) {
  const list = Array.isArray(report.sellerResponses)
    ? report.sellerResponses.filter((item) => item?.text?.trim())
    : [];
  if (list.length > 0) return list;
  if (report.sellerResponse?.trim()) {
    return [{ text: report.sellerResponse.trim(), createdAt: report.sellerRespondedAt || null }];
  }
  return [];
}

function getBuyerResponseEntries(report) {
  const list = Array.isArray(report.buyerResponses)
    ? report.buyerResponses.filter((item) => item?.text?.trim())
    : [];
  if (list.length > 0) return list;
  if (report.buyerResponse?.trim()) {
    return [{ text: report.buyerResponse.trim(), createdAt: report.buyerRespondedAt || null }];
  }
  return [];
}

function idString(value) {
  return value?._id?.toString?.() ?? value?.toString?.() ?? value ?? null;
}

function syncDisputeStage(report) {
  if (report.status === "resolved") {
    report.disputeStage = "resolved";
    return;
  }

  const askedSeller = Boolean(report.adminMessageToSeller?.trim());
  const askedBuyer = Boolean(report.adminMessageToBuyer?.trim());
  const sellerDone = Boolean(report.sellerResponse?.trim());
  const buyerDone = Boolean(report.buyerResponse?.trim());

  if (askedSeller && askedBuyer) {
    if (sellerDone && buyerDone) report.disputeStage = "both_responded";
    else if (sellerDone) report.disputeStage = "awaiting_buyer";
    else if (buyerDone) report.disputeStage = "awaiting_seller";
    else report.disputeStage = "awaiting_both";
  } else if (askedSeller) {
    report.disputeStage = sellerDone ? "seller_responded" : "awaiting_seller";
  } else if (askedBuyer) {
    report.disputeStage = buyerDone ? "buyer_responded" : "awaiting_buyer";
  } else {
    report.disputeStage = "none";
  }
}

function isMediationComplete(report) {
  if (!report?.orderId) return true;
  const askedSeller = Boolean(report.adminMessageToSeller?.trim());
  const askedBuyer = Boolean(report.adminMessageToBuyer?.trim());
  if (!askedSeller || !askedBuyer) return false;
  if (!report.sellerResponse?.trim()) return false;
  if (!report.buyerResponse?.trim()) return false;
  return true;
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

  if (this.adminMessageToSeller) {
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

  if (this.adminMessageToBuyer) {
    if (viewerRole === "buyer") {
      lines.push(
        `Admin asks you: ${
          this.adminMessageToBuyer || "Please provide more details about this dispute."
        }`,
      );
    } else {
      lines.push("Admin has contacted the buyer for a response.");
    }
  }

  if (this.sellerResponse || getSellerResponseEntries(this).length) {
    const thread = formatResponseThread(getSellerResponseEntries(this), this.sellerResponse);
    if (viewerRole === "seller") {
      lines.push(`Your responses:\n${thread}`);
    } else if (viewerRole === "buyer") {
      lines.push("Seller has submitted a response. Admin is reviewing.");
    } else {
      lines.push(`Seller responses:\n${thread}`);
    }
  }

  if (this.buyerResponse || getBuyerResponseEntries(this).length) {
    const thread = formatResponseThread(getBuyerResponseEntries(this), this.buyerResponse);
    if (viewerRole === "buyer") {
      lines.push(`Your responses:\n${thread}`);
    } else if (viewerRole === "seller") {
      lines.push("Buyer has submitted a response. Admin is reviewing.");
    } else {
      lines.push(`Buyer responses:\n${thread}`);
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
    Boolean(this.adminMessageToSeller?.trim()) &&
    this.status !== "resolved";
  const isInvolvedBuyer = idString(this.involvedBuyerId) === viewerId;
  const needsBuyerResponse =
    isInvolvedBuyer &&
    Boolean(this.adminMessageToBuyer?.trim()) &&
    this.status !== "resolved";

  const sellerEntries = getSellerResponseEntries(this).map((item) => ({
    text: item.text,
    createdAt: item.createdAt || null,
  }));
  const buyerEntries = getBuyerResponseEntries(this).map((item) => ({
    text: item.text,
    createdAt: item.createdAt || null,
  }));

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
    needsBuyerResponse,
    productTitle: this.productTitle || "",
    sellerName: this.sellerName || "",
    buyerName: this.buyerName || "",
    orderId: idString(this.orderId),
    adminMessageToSeller: this.adminMessageToSeller || "",
    adminMessageToBuyer: this.adminMessageToBuyer || "",
    sellerResponse: this.sellerResponse || "",
    sellerResponses: sellerEntries,
    buyerResponse: this.buyerResponse || "",
    buyerResponses: buyerEntries,
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
    adminMessageToBuyer: this.adminMessageToBuyer || "",
    sellerResponse: this.sellerResponse || "",
    sellerResponses: getSellerResponseEntries(this).map((item) => ({
      text: item.text,
      createdAt: item.createdAt || null,
    })),
    sellerRespondedAt: this.sellerRespondedAt || null,
    buyerResponse: this.buyerResponse || "",
    buyerResponses: getBuyerResponseEntries(this).map((item) => ({
      text: item.text,
      createdAt: item.createdAt || null,
    })),
    buyerRespondedAt: this.buyerRespondedAt || null,
    mediationComplete: isMediationComplete(this),
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
Report.syncDisputeStage = syncDisputeStage;
Report.isMediationComplete = isMediationComplete;

module.exports = Report;

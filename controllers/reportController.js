const Report = require("../models/Report");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const { notifyReportResolved, notifyDisputeMediationRequested, notifyDisputePartyResponded } = require("../services/notificationService");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  if (error.code === 11000) {
    return "Could not create report. Please try again.";
  }
  return error.message || "Something went wrong";
}

function allowedIssueTypesForRole(role) {
  if (role === "seller") return Report.SELLER_ISSUE_TYPES;
  return Report.BUYER_ISSUE_TYPES;
}

async function generateReportId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = Math.floor(1000 + Math.random() * 9000);
    const reportId = `RH-${suffix}`;
    const exists = await Report.exists({ reportId });
    if (!exists) return reportId;
  }
  return `RH-${Date.now().toString().slice(-6)}`;
}

async function populateReport(query) {
  return query
    .populate("reporterId", "name email role")
    .populate("involvedSellerId", "name email role")
    .populate("involvedBuyerId", "name email role");
}

/** Buyer/Seller: submit a Support Center report (optional order = dispute) */
async function createReport(req, res) {
  try {
    const role = req.user.role;
    if (role !== "buyer" && role !== "seller") {
      return res.status(403).json({ message: "Only buyers and sellers can submit reports" });
    }

    const { issueType, subject, message, images, orderId } = req.body;
    const allowedTypes = allowedIssueTypesForRole(role);

    if (!issueType || !allowedTypes.includes(issueType)) {
      return res.status(400).json({
        message: `Issue type must be one of: ${allowedTypes.join(", ")}`,
      });
    }

    if (!subject?.trim()) {
      return res.status(400).json({ message: "Subject is required" });
    }
    if (!message?.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    const imageList = Array.isArray(images)
      ? images.filter((img) => typeof img === "string" && img.trim()).slice(0, 5)
      : [];

    const payload = {
      reportId: await generateReportId(),
      reporterId: req.user._id,
      reporterRole: role,
      reporterName: req.user.name || "",
      issueType,
      subject: subject.trim(),
      message: message.trim(),
      images: imageList,
      status: "open",
      disputeStage: "none",
    };

    // Buyer links an order → create a dispute against that seller
    if (orderId && role === "buyer") {
      const order = await Order.findOne({
        _id: orderId,
        buyerId: req.user._id,
        removedByBuyer: false,
      });

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const product = order.productId ? await Product.findById(order.productId) : null;
      const seller = order.sellerId ? await User.findById(order.sellerId).select("name email") : null;

      if (!order.sellerId) {
        return res.status(400).json({
          message: "This order has no seller linked, so a dispute cannot be opened",
        });
      }

      payload.orderId = order._id;
      payload.productId = order.productId || undefined;
      payload.involvedSellerId = order.sellerId;
      payload.involvedBuyerId = req.user._id;
      payload.productTitle = product?.title || "";
      payload.sellerName = seller?.name || "";
      payload.buyerName = req.user.name || "";
    }

    const report = await Report.create(payload);

    res.status(201).json({
      report: report.toReporterJSON(req.user._id, role),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Buyer/Seller: own reports + disputes they are involved in */
async function getMyReports(req, res) {
  try {
    const role = req.user.role;
    if (role !== "buyer" && role !== "seller") {
      return res.status(403).json({ message: "Only buyers and sellers can view their reports" });
    }

    const userId = req.user._id;
    const filter =
      role === "seller"
        ? {
            $or: [{ reporterId: userId }, { involvedSellerId: userId }],
          }
        : {
            $or: [{ reporterId: userId }, { involvedBuyerId: userId }],
          };

    const reports = await Report.find(filter).sort({ createdAt: -1 }).limit(100);

    res.json({
      reports: reports.map((report) => report.toReporterJSON(userId, role)),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Seller: respond to a dispute admin asked about */
async function submitSellerResponse(req, res) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Only sellers can respond to disputes" });
    }

    const { response } = req.body;
    if (!response?.trim()) {
      return res.status(400).json({ message: "Response is required" });
    }

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (String(report.involvedSellerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "This dispute is not assigned to you" });
    }

    if (report.status === "resolved" || report.disputeStage === "resolved") {
      return res.status(400).json({ message: "This dispute is already resolved" });
    }

    if (!report.adminMessageToSeller?.trim()) {
      return res.status(400).json({
        message: "Admin has not requested your response yet",
      });
    }

    const text = response.trim();
    if (!Array.isArray(report.sellerResponses)) {
      report.sellerResponses = [];
    }
    // Migrate any legacy single response into the thread once.
    if (report.sellerResponse?.trim() && report.sellerResponses.length === 0) {
      report.sellerResponses.push({
        text: report.sellerResponse.trim(),
        createdAt: report.sellerRespondedAt || report.updatedAt || new Date(),
      });
    }
    report.sellerResponses.push({ text, createdAt: new Date() });
    report.sellerResponse = text;
    report.sellerRespondedAt = new Date();
    report.status = "in_progress";
    Report.syncDisputeStage(report);
    await report.save();

    notifyDisputePartyResponded({
      reportId: report.reportId,
      subject: report.subject,
      responderRole: "seller",
      orderId: report.orderId,
    }).catch(() => {});

    res.json({
      report: report.toReporterJSON(req.user._id, "seller"),
      message: "Your response was sent to admin",
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Buyer: respond to a dispute admin asked about */
async function submitBuyerResponse(req, res) {
  try {
    if (req.user.role !== "buyer") {
      return res.status(403).json({ message: "Only buyers can respond to buyer mediation requests" });
    }

    const { response } = req.body;
    if (!response?.trim()) {
      return res.status(400).json({ message: "Response is required" });
    }

    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (String(report.involvedBuyerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "This dispute is not assigned to you" });
    }

    if (report.status === "resolved" || report.disputeStage === "resolved") {
      return res.status(400).json({ message: "This dispute is already resolved" });
    }

    if (!report.adminMessageToBuyer?.trim()) {
      return res.status(400).json({
        message: "Admin has not requested your response yet",
      });
    }

    const text = response.trim();
    if (!Array.isArray(report.buyerResponses)) {
      report.buyerResponses = [];
    }
    if (report.buyerResponse?.trim() && report.buyerResponses.length === 0) {
      report.buyerResponses.push({
        text: report.buyerResponse.trim(),
        createdAt: report.buyerRespondedAt || report.updatedAt || new Date(),
      });
    }
    report.buyerResponses.push({ text, createdAt: new Date() });
    report.buyerResponse = text;
    report.buyerRespondedAt = new Date();
    report.status = "in_progress";
    Report.syncDisputeStage(report);
    await report.save();

    notifyDisputePartyResponded({
      reportId: report.reportId,
      subject: report.subject,
      responderRole: "buyer",
      orderId: report.orderId,
    }).catch(() => {});

    res.json({
      report: report.toReporterJSON(req.user._id, "buyer"),
      message: "Your response was sent to admin",
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: list all reports */
async function getAdminReports(req, res) {
  try {
    const { status, role } = req.query;
    const filter = {};

    if (status && status !== "all") {
      filter.status = status === "pending" ? "open" : status;
    }
    if (role === "buyer" || role === "seller") {
      filter.reporterRole = role;
    }

    const reports = await populateReport(
      Report.find(filter).sort({ createdAt: -1 }).limit(200),
    );

    res.json({ reports: reports.map((report) => report.toAdminJSON()) });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: update status, ask seller, or resolve dispute */
async function updateAdminReport(req, res) {
  try {
    const {
      status,
      adminReply,
      adminNote,
      askSeller,
      askBuyer,
      askBoth,
      messageToSeller,
      messageToBuyer,
      decision,
    } = req.body;

    const report = await populateReport(Report.findById(req.params.id));

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    const wasResolved = report.status === "resolved";

    // Ask both buyer and seller to respond (required before escrow release)
    if (askBoth) {
      if (!report.involvedSellerId || !report.involvedBuyerId) {
        return res.status(400).json({
          message:
            "Both buyer and seller must be linked to this dispute (submit with an order selected).",
        });
      }

      const sellerNote =
        (typeof messageToSeller === "string" && messageToSeller.trim()) ||
        (typeof adminReply === "string" && adminReply.trim()) ||
        "";
      const buyerNote =
        (typeof messageToBuyer === "string" && messageToBuyer.trim()) ||
        (typeof adminReply === "string" && adminReply.trim()) ||
        "";

      if (!sellerNote || !buyerNote) {
        return res.status(400).json({
          message: "Please enter a message for buyer and seller before contacting them.",
        });
      }

      report.adminMessageToSeller = sellerNote;
      report.adminMessageToBuyer = buyerNote;
      report.status = "in_progress";
      report.adminReply =
        (typeof adminReply === "string" && adminReply.trim()) || sellerNote;
      report.reviewedAt = new Date();
      report.reviewedBy = req.user._id;
      Report.syncDisputeStage(report);
      await report.save();

      notifyDisputeMediationRequested({
        userId: report.involvedSellerId?._id ?? report.involvedSellerId,
        role: "seller",
        reportId: report.reportId,
        subject: report.subject,
        message: sellerNote,
      }).catch(() => {});
      notifyDisputeMediationRequested({
        userId: report.involvedBuyerId?._id ?? report.involvedBuyerId,
        role: "buyer",
        reportId: report.reportId,
        subject: report.subject,
        message: buyerNote,
      }).catch(() => {});

      return res.json({
        report: report.toAdminJSON(),
        message: "Buyer and seller have been asked to respond",
      });
    }

    // Ask the involved seller to respond (dispute mediation)
    if (askSeller) {
      if (!report.involvedSellerId) {
        return res.status(400).json({
          message:
            "No seller is linked to this request. Buyer must submit with an order selected.",
        });
      }

      const note =
        (typeof messageToSeller === "string" && messageToSeller.trim()) ||
        (typeof adminReply === "string" && adminReply.trim()) ||
        "";

      if (!note) {
        return res.status(400).json({
          message: "Please enter a message for the seller before contacting them.",
        });
      }

      report.adminMessageToSeller = note;
      report.status = "in_progress";
      report.adminReply =
        (typeof adminReply === "string" && adminReply.trim()) || note;
      report.reviewedAt = new Date();
      report.reviewedBy = req.user._id;
      Report.syncDisputeStage(report);
      await report.save();

      notifyDisputeMediationRequested({
        userId: report.involvedSellerId?._id ?? report.involvedSellerId,
        role: "seller",
        reportId: report.reportId,
        subject: report.subject,
        message: note,
      }).catch(() => {});

      return res.json({
        report: report.toAdminJSON(),
        message: "Seller has been asked to respond",
      });
    }

    // Ask the involved buyer to respond
    if (askBuyer) {
      if (!report.involvedBuyerId) {
        return res.status(400).json({
          message:
            "No buyer is linked to this request. Buyer must submit with an order selected.",
        });
      }

      const note =
        (typeof messageToBuyer === "string" && messageToBuyer.trim()) ||
        (typeof adminReply === "string" && adminReply.trim()) ||
        "";

      if (!note) {
        return res.status(400).json({
          message: "Please enter a message for the buyer before contacting them.",
        });
      }

      report.adminMessageToBuyer = note;
      report.status = "in_progress";
      report.adminReply =
        (typeof adminReply === "string" && adminReply.trim()) || note;
      report.reviewedAt = new Date();
      report.reviewedBy = req.user._id;
      Report.syncDisputeStage(report);
      await report.save();

      notifyDisputeMediationRequested({
        userId: report.involvedBuyerId?._id ?? report.involvedBuyerId,
        role: "buyer",
        reportId: report.reportId,
        subject: report.subject,
        message: note,
      }).catch(() => {});

      return res.json({
        report: report.toAdminJSON(),
        message: "Buyer has been asked to respond",
      });
    }

    if (status) {
      if (!["open", "in_progress", "resolved"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      if (status === "resolved") {
        const resolveText =
          (typeof decision === "string" && decision.trim()) ||
          (typeof adminReply === "string" && adminReply.trim()) ||
          "";
        if (!resolveText) {
          return res.status(400).json({
            message: "Please enter a message before resolving or dismissing.",
          });
        }
      }
      report.status = status;
      if (status === "resolved") {
        report.disputeStage = "resolved";
      } else if (status === "in_progress" && report.disputeStage === "none") {
        // keep stage
      }
    }

    if (typeof adminReply === "string") {
      report.adminReply = adminReply.trim();
    }
    if (typeof decision === "string" && decision.trim()) {
      report.decision = decision.trim();
      report.adminReply = decision.trim();
    }
    if (typeof adminNote === "string") {
      report.adminNote = adminNote.trim();
    }
    if (typeof messageToSeller === "string") {
      report.adminMessageToSeller = messageToSeller.trim();
    }
    if (typeof messageToBuyer === "string") {
      report.adminMessageToBuyer = messageToBuyer.trim();
    }

    Report.syncDisputeStage(report);

    if (report.status === "resolved") {
      report.disputeStage = "resolved";
      if (!report.decision && report.adminReply) {
        report.decision = report.adminReply;
      }
    }

    report.reviewedAt = new Date();
    report.reviewedBy = req.user._id;
    await report.save();

    if (report.status === "resolved" && !wasResolved) {
      const reporterId = report.reporterId?._id ?? report.reporterId;
      notifyReportResolved({
        reporterId,
        reporterRole: report.reporterRole,
        reportId: report.reportId,
        subject: report.subject,
        decision: report.decision || report.adminReply,
      }).catch(() => {});
    }

    res.json({ report: report.toAdminJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  createReport,
  getMyReports,
  submitSellerResponse,
  submitBuyerResponse,
  getAdminReports,
  updateAdminReport,
};

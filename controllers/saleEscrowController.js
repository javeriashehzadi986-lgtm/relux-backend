const Order = require("../models/Order");
const Product = require("../models/Product");
const Report = require("../models/Report");
const User = require("../models/User");
const { FULFILLMENT, ensurePaid } = require("../services/orderStatusService");
const {
  buildSaleEscrowSummary,
  calculateSaleEscrow,
  releaseSaleEscrow,
  formatPkr,
} = require("../services/escrowService");
const {
  notifySaleEscrowReleased,
  notifySaleDeliveryDisputed,
} = require("../services/notificationService");
const { emitOrderUpdated } = require("../services/orderSocketService");
const { emitReportUpdated } = require("../services/reportSocketService");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

async function loadSaleOrderForBuyer(orderId, buyerId) {
  return Order.findOne({
    _id: orderId,
    buyerId,
    type: "sale",
    removedByBuyer: false,
  }).populate("productId", "title itemPrice");
}

function assertSaleEscrowHeld(order, { allowFailedRetry = false } = {}) {
  if (order.paymentStatus !== "paid") {
    throw new Error("Purchase must be paid before escrow actions");
  }
  if (order.escrowStatus === "released") {
    throw new Error("Escrow has already been released for this order");
  }
  const heldOk = order.escrowStatus === "held";
  const failedRetryOk = allowFailedRetry && order.escrowStatus === "failed";
  if (!heldOk && !failedRetryOk) {
    throw new Error("No escrow is held for this purchase");
  }
}

async function getSaleEscrow(req, res) {
  try {
    const order = await Order.findById(req.params.id).populate("productId", "title itemPrice");

    if (!order || order.type !== "sale") {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    const isBuyer = String(order.buyerId) === String(req.user._id);
    const isSeller = String(order.sellerId) === String(req.user._id);
    const isAdmin = req.user.role === "admin";

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({ message: "Not allowed" });
    }

    res.json({
      settlement: buildSaleEscrowSummary(order),
      orderId: order._id.toString(),
      orderType: "sale",
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function disputeSaleDelivery(req, res) {
  try {
    const order = await loadSaleOrderForBuyer(req.params.id, req.user._id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    ensurePaid(order);
    assertSaleEscrowHeld(order);

    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (fs !== FULFILLMENT.SHIPPED) {
      return res.status(400).json({
        message: "You can only dispute after the seller marks the order as shipped",
      });
    }

    if (order.escrowSettlementStatus === "disputed") {
      return res.status(400).json({ message: "A delivery dispute is already open for this order" });
    }

    const { disputeReason } = req.body;
    if (!disputeReason?.trim()) {
      return res.status(400).json({
        message: "Please describe the delivery issue (wrong item, not received, etc.)",
      });
    }

    order.disputeReason = disputeReason.trim();
    order.escrowSettlementStatus = "disputed";
    order.settlementDisputedAt = new Date();
    await order.save();

    const product = await Product.findById(order.productId).select("title");
    const sellerUser = await User.findById(order.sellerId).select("name");

    let report = null;
    if (!order.disputeReportId) {
      let reportId = `RH-${Math.floor(1000 + Math.random() * 9000)}`;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const exists = await Report.exists({ reportId });
        if (!exists) break;
        reportId = `RH-${Math.floor(1000 + Math.random() * 9000)}`;
      }

      report = await Report.create({
        reportId,
        reporterId: req.user._id,
        reporterRole: "buyer",
        reporterName: req.user.name || "",
        issueType: "Order",
        subject: `Sale delivery dispute — ${product?.title || "Purchase order"}`,
        message: disputeReason.trim(),
        images: order.settlementEvidence || [],
        orderId: order._id,
        productId: order.productId,
        involvedSellerId: order.sellerId,
        involvedBuyerId: order.buyerId,
        productTitle: product?.title || "",
        sellerName: sellerUser?.name || "",
        buyerName: req.user.name || "",
        status: "open",
        disputeStage: "none",
      });
      order.disputeReportId = report._id;
      await order.save();
    }

    if (report) {
      emitReportUpdated(report).catch(() => {});
    }

    notifySaleDeliveryDisputed({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "your purchase",
      orderId: order._id,
    });

    emitOrderUpdated(order);

    res.json({
      message: "Delivery dispute submitted — payment is held until admin resolves it",
      order: order.toBuyerJSON(),
      reportId: report?._id?.toString?.() || order.disputeReportId?.toString?.(),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

async function adminResolveSaleEscrow(req, res) {
  try {
    const order = await Order.findById(req.params.id).populate("productId", "title itemPrice");

    if (!order || order.type !== "sale") {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    if (order.escrowSettlementStatus !== "disputed") {
      return res.status(400).json({
        message: "Only disputed sale orders can be resolved by admin",
      });
    }

    assertSaleEscrowHeld(order, { allowFailedRetry: true });
    // Previous Stripe/refund attempt may have left escrowStatus=failed — reset for retry.
    if (order.escrowStatus === "failed") {
      order.escrowStatus = "held";
    }

    const { sellerPayoutPkr, refundAmountPkr, adminSettlementNote, decision, resolveReport } =
      req.body;

    const overrides = {};
    if (sellerPayoutPkr !== undefined) overrides.sellerPayoutPkr = sellerPayoutPkr;
    if (refundAmountPkr !== undefined) overrides.refundAmountPkr = refundAmountPkr;

    const breakdown = calculateSaleEscrow(order, overrides);
    if (breakdown.exceedsTotal) {
      return res.status(400).json({
        message: "Seller payout and buyer refund cannot exceed the total paid amount",
        settlement: buildSaleEscrowSummary({ ...order.toObject(), ...breakdown }),
      });
    }

    // Paying the seller requires buyer receipt confirmation.
    // Full/partial buyer refunds are allowed without it (e.g. item not received).
    if (breakdown.sellerPayoutPkr > 0 && !order.deliveryConfirmedAt) {
      return res.status(400).json({
        message:
          "Buyer has not confirmed receipt yet. Set seller payout to 0 and refund the buyer, or wait for delivery confirmation.",
        settlement: buildSaleEscrowSummary(order),
      });
    }

    order.adminSettlementNote = String(adminSettlementNote || decision || "").trim();
    order.adminSettledBy = req.user._id;
    await order.save();

    const result = await releaseSaleEscrow(order, overrides, "admin_settled");

    if (order.disputeReportId && resolveReport !== false) {
      const report = await Report.findById(order.disputeReportId);
      if (report) {
        report.status = "resolved";
        report.disputeStage = "resolved";
        const resolveText =
          decision?.trim() ||
          report.adminReply ||
          (breakdown.refundAmountPkr > 0
            ? `Escrow released — PKR ${breakdown.refundAmountPkr} refunded to buyer.`
            : "Escrow released by admin.");
        report.decision = resolveText;
        report.adminReply = resolveText;
        report.reviewedAt = new Date();
        report.reviewedBy = req.user._id;
        await report.save();
        emitReportUpdated(report).catch(() => {});
      }
    }

    const product = order.productId;
    notifySaleEscrowReleased({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "purchase",
      orderId: order._id,
      refundLabel: formatPkr(result.refundAmountPkr),
      sellerPayoutLabel: formatPkr(result.sellerPayoutPkr),
      transferSent: Boolean(result.stripeTransferId),
    });

    emitOrderUpdated(result.order || order);

    res.json({
      message: "Sale escrow released with admin decision",
      order: result.order.toSellerJSON(),
      settlement: buildSaleEscrowSummary(result.order),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

module.exports = {
  getSaleEscrow,
  disputeSaleDelivery,
  adminResolveSaleEscrow,
};

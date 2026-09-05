const Order = require("../models/Order");
const Product = require("../models/Product");
const Report = require("../models/Report");
const User = require("../models/User");
const { FULFILLMENT, ensurePaid } = require("../services/orderStatusService");
const {
  calculateRentalEscrow,
  releaseRentalEscrow,
  formatPkr,
  buildSettlementSummary,
} = require("../services/escrowService");
const {
  notifyEscrowReleased,
  notifySettlementDisputed,
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

async function loadRentalOrderForSeller(orderId, sellerId) {
  return Order.findOne({
    _id: orderId,
    sellerId,
    type: "rental",
    status: "approved",
  }).populate("productId", "title itemPrice rentPrice");
}

function assertBuyerMarkedReturn(order) {
  const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
  if (fs !== FULFILLMENT.RETURNED) {
    throw new Error("Buyer must mark the item as returned before you can report a return issue");
  }
}

function assertEscrowHeld(order) {
  if (order.paymentStatus !== "paid") {
    throw new Error("Rental deposit must be paid before escrow actions");
  }
  if (order.escrowStatus === "released") {
    throw new Error("Escrow has already been released for this order");
  }
}

async function getSettlement(req, res) {
  try {
    const order = await Order.findById(req.params.id).populate(
      "productId",
      "title itemPrice rentPrice",
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const isBuyer = String(order.buyerId) === String(req.user._id);
    const isSeller = String(order.sellerId) === String(req.user._id);
    const isAdmin = req.user.role === "admin";

    if (!isBuyer && !isSeller && !isAdmin) {
      return res.status(403).json({ message: "Not allowed" });
    }

    if (order.type === "sale") {
      const { buildSaleEscrowSummary } = require("../services/escrowService");
      return res.json({
        settlement: buildSaleEscrowSummary(order),
        orderId: order._id.toString(),
        orderType: "sale",
      });
    }

    if (order.type !== "rental") {
      return res.status(404).json({ message: "Order not found" });
    }

    const product = order.productId;
    const settlement = buildSettlementSummary(order, product);

    res.json({ settlement, orderId: order._id.toString(), orderType: "rental" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function proposeSettlement(req, res) {
  return res.status(410).json({
    message:
      "Seller settlement proposals are no longer used. Confirm the return to release escrow, or report a return issue for admin review.",
  });
}

async function acceptSettlement(req, res) {
  return res.status(410).json({
    message:
      "Buyer settlement acceptance is no longer used. The seller confirms the return to release escrow, or opens a return dispute for admin.",
  });
}

async function disputeSettlement(req, res) {
  return res.status(410).json({
    message:
      "Buyer settlement disputes are no longer used. Return issues are reported by the seller for admin review.",
  });
}

async function disputeRentalDelivery(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
      type: "rental",
      removedByBuyer: false,
    }).populate("productId", "title itemPrice rentPrice");

    if (!order) {
      return res.status(404).json({ message: "Rental order not found" });
    }

    ensurePaid(order);
    assertEscrowHeld(order);

    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (fs !== FULFILLMENT.SHIPPED) {
      return res.status(400).json({
        message: "You can only dispute delivery after the seller marks the order as shipped",
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

    const product = order.productId;
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
        subject: `Rental delivery dispute — ${product?.title || "Rental order"}`,
        message: disputeReason.trim(),
        images: order.settlementEvidence || [],
        orderId: order._id,
        productId: order.productId?._id || order.productId,
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

    await notifySaleDeliveryDisputed({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "your rental",
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

async function disputeRentalReturn(req, res) {
  try {
    const order = await loadRentalOrderForSeller(req.params.id, req.user._id);

    if (!order) {
      return res.status(404).json({ message: "Rental order not found" });
    }

    ensurePaid(order);
    assertBuyerMarkedReturn(order);
    assertEscrowHeld(order);

    if (order.escrowSettlementStatus === "disputed") {
      return res.status(400).json({ message: "A return dispute is already open for this order" });
    }

    if (["accepted", "admin_settled"].includes(order.escrowSettlementStatus || "none")) {
      return res.status(400).json({
        message: "This rental escrow is already settled",
      });
    }

    const { disputeReason } = req.body;
    if (!disputeReason?.trim()) {
      return res.status(400).json({
        message:
          "Please describe the return issue (damage, late return, missing item, not returned, etc.)",
      });
    }

    order.disputeReason = disputeReason.trim();
    order.escrowSettlementStatus = "disputed";
    order.settlementDisputedAt = new Date();
    if (!order.sellerConfirmedReturnAt) {
      order.sellerConfirmedReturnAt = new Date();
    }
    await order.save();

    const product = await Product.findById(order.productId).select("title");
    const buyerUser = await User.findById(order.buyerId).select("name");

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
        reporterRole: "seller",
        reporterName: req.user.name || "",
        issueType: "Return",
        subject: `Rental return dispute — ${product?.title || "Rental order"}`,
        message: disputeReason.trim(),
        images: order.settlementEvidence || [],
        orderId: order._id,
        productId: order.productId,
        involvedSellerId: order.sellerId,
        involvedBuyerId: order.buyerId,
        productTitle: product?.title || "",
        sellerName: req.user.name || "",
        buyerName: buyerUser?.name || "",
        status: "open",
        disputeStage: "none",
      });
      order.disputeReportId = report._id;
      await order.save();
    }

    if (report) {
      emitReportUpdated(report).catch(() => {});
    }

    notifySettlementDisputed({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "rental item",
      orderId: order._id,
    });

    emitOrderUpdated(order);

    res.json({
      message: "Return dispute submitted — escrow is held until admin resolves it",
      order: order.toSellerJSON(),
      reportId: report?._id?.toString?.() || order.disputeReportId?.toString?.(),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

async function adminResolveSettlement(req, res) {
  try {
    const order = await Order.findById(req.params.id).populate(
      "productId",
      "title itemPrice rentPrice",
    );

    if (!order || order.type !== "rental") {
      return res.status(404).json({ message: "Rental order not found" });
    }

    if (order.escrowSettlementStatus !== "disputed") {
      return res.status(400).json({
        message: "Only disputed rental orders can be resolved by admin",
      });
    }

    assertEscrowHeld(order);

    // Allow retry after a failed Stripe/refund attempt (same as sale disputes).
    if (order.escrowStatus === "failed") {
      order.escrowStatus = "held";
    }

    const {
      sellerPayoutPkr,
      refundAmountPkr,
      adminSettlementNote,
      decision,
      resolveReport,
    } = req.body;

    const overrides = {};
    if (sellerPayoutPkr !== undefined) overrides.sellerPayoutPkr = sellerPayoutPkr;
    if (refundAmountPkr !== undefined) overrides.refundAmountPkr = refundAmountPkr;

    if (
      overrides.sellerPayoutPkr === undefined &&
      overrides.refundAmountPkr === undefined
    ) {
      return res.status(400).json({
        message: "Enter seller payout and/or buyer refund amounts",
      });
    }

    const product = order.productId;
    const breakdown = calculateRentalEscrow(order, product, overrides);

    if (breakdown.exceedsTotal) {
      return res.status(400).json({
        message: "Seller payout and buyer refund cannot exceed the total paid amount",
        settlement: buildSettlementSummary(order, product, overrides),
      });
    }

    // Admin may pay the seller on any dispute (delivery / return / damage / sale)
    // even if the buyer never confirmed receipt — split is fully manual.
    if (breakdown.sellerPayoutPkr > 0 && !order.deliveryConfirmedAt) {
      order.deliveryConfirmedAt = order.deliveryConfirmedAt || new Date();
    }

    order.rentalChargePkr = 0;
    order.damageDeductionPkr = 0;
    order.lateFeePkr = 0;
    order.refundAmountPkr = breakdown.refundAmountPkr;
    order.sellerPayoutPkr = breakdown.sellerPayoutPkr;
    order.adminSettlementNote = String(adminSettlementNote || decision || "").trim();
    order.adminSettledBy = req.user._id;
    order.escrowSettlementStatus = "admin_settled";
    await order.save();

    const result = await releaseRentalEscrow(order, overrides);

    if (order.disputeReportId && resolveReport !== false) {
      const report = await Report.findById(order.disputeReportId);
      if (report) {
        report.status = "resolved";
        report.disputeStage = "resolved";
        report.decision =
          decision?.trim() ||
          `Escrow settled: ${formatPkr(breakdown.refundAmountPkr)} refunded to buyer, ${formatPkr(breakdown.sellerPayoutPkr)} to seller.`;
        report.adminReply = report.decision;
        report.reviewedAt = new Date();
        report.reviewedBy = req.user._id;
        await report.save();
        emitReportUpdated(report).catch(() => {});
      }
    }

    notifyEscrowReleased({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "rental item",
      orderId: order._id,
      refundLabel: formatPkr(result.refundAmountPkr),
      rentalChargeLabel: formatPkr(result.sellerPayoutPkr),
      sellerPayoutLabel: formatPkr(result.sellerPayoutPkr),
      transferSent: Boolean(result.stripeTransferId),
    });

    emitOrderUpdated(result.order || order);

    res.json({
      message: "Escrow released with admin settlement",
      order: result.order.toSellerJSON(),
      settlement: buildSettlementSummary(result.order, product, {
        sellerPayoutPkr: result.sellerPayoutPkr,
        refundAmountPkr: result.refundAmountPkr,
      }),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

module.exports = {
  getSettlement,
  proposeSettlement,
  acceptSettlement,
  disputeSettlement,
  disputeRentalDelivery,
  disputeRentalReturn,
  adminResolveSettlement,
};

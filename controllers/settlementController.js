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
} = require("../services/notificationService");

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

    notifySettlementDisputed({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "rental item",
      orderId: order._id,
    });

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
        message: "Only disputed return issues can be resolved by admin",
      });
    }

    assertEscrowHeld(order);

    // Seller must confirm the returned item was received before admin can release escrow.
    if (!order.returnConfirmedAt) {
      return res.status(400).json({
        message:
          "Seller has not confirmed receiving the returned product yet. Wait for return confirmation before releasing escrow.",
      });
    }

    const {
      rentalChargePkr,
      damageDeductionPkr,
      lateFeePkr,
      adminSettlementNote,
      decision,
      resolveReport,
    } = req.body;

    const overrides = {};
    if (rentalChargePkr !== undefined) overrides.rentalChargePkr = rentalChargePkr;
    if (damageDeductionPkr !== undefined) overrides.damageDeductionPkr = damageDeductionPkr;
    if (lateFeePkr !== undefined) overrides.lateFeePkr = lateFeePkr;

    const product = order.productId;
    const breakdown = calculateRentalEscrow(order, product, overrides);

    if (breakdown.additionalChargePkr > 0) {
      return res.status(400).json({
        message:
          "Admin settlement cannot exceed the deposit. Cap rent or damage so total deductions fit within the deposit.",
        settlement: breakdown,
      });
    }

    order.rentalChargePkr = breakdown.rentalChargePkr;
    order.damageDeductionPkr = breakdown.damageDeductionPkr;
    order.lateFeePkr = breakdown.lateFeePkr;
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
      }
    }

    notifyEscrowReleased({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "rental item",
      orderId: order._id,
      refundLabel: formatPkr(result.refundAmountPkr),
      rentalChargeLabel: formatPkr(result.rentalChargePkr),
      sellerPayoutLabel: formatPkr(result.sellerPayoutPkr),
      transferSent: Boolean(result.stripeTransferId),
    });

    res.json({
      message: "Escrow released with admin settlement",
      order: result.order.toSellerJSON(),
      settlement: buildSettlementSummary(result.order, product),
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
  disputeRentalReturn,
  adminResolveSettlement,
};

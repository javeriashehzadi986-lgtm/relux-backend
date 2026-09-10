const Product = require("../models/Product");
const { getStripe, getCurrency, toStripeUnitAmount } = require("./stripeService");
const { transferSellerPayout } = require("./stripeConnectService");
const { finalizeOrderAfterEscrowRelease } = require("./orderStatusService");

const SALE_AUTO_RELEASE_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

function parseAmount(value) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

/** Use saved delivery, or infer from total − deposit when older rows left deliveryChargesPkr at 0. */
function resolveDeliveryChargesPkr(order) {
  const stored = Math.max(0, Math.round(Number(order.deliveryChargesPkr) || 0));
  if (stored > 0) return stored;

  const totalPaid = Math.max(0, Math.round(Number(order.amountPkr) || 0));
  const itemAmount = Math.max(0, Math.round(Number(order.itemAmountPkr) || 0));
  if (totalPaid > itemAmount && itemAmount > 0) {
    return totalPaid - itemAmount;
  }
  return 0;
}

function calculateRentalEscrow(order, product, overrides = {}) {
  const deliveryChargesPkr = resolveDeliveryChargesPkr(order);
  let deposit = Math.max(0, Math.round(Number(order.itemAmountPkr) || 0));
  if (!deposit) {
    const totalPaidFallback = Math.max(0, Math.round(Number(order.amountPkr) || 0));
    deposit =
      totalPaidFallback > deliveryChargesPkr
        ? totalPaidFallback - deliveryChargesPkr
        : totalPaidFallback || 0;
  }
  if (!deposit) {
    deposit = parseAmount(product?.itemPrice);
  }

  const totalPaidPkr =
    Math.max(0, Math.round(Number(order.amountPkr) || 0)) || deposit + deliveryChargesPkr;

  // Admin dispute / manual split — same model as resale disputes.
  // Admin enters seller payout + buyer refund directly against total paid.
  if (
    overrides.sellerPayoutPkr !== undefined ||
    overrides.refundAmountPkr !== undefined
  ) {
    const sellerPayoutPkr =
      overrides.sellerPayoutPkr !== undefined
        ? Math.max(0, Math.round(Number(overrides.sellerPayoutPkr) || 0))
        : Math.max(
            0,
            totalPaidPkr - Math.max(0, Math.round(Number(overrides.refundAmountPkr) || 0)),
          );
    const refundAmountPkr =
      overrides.refundAmountPkr !== undefined
        ? Math.max(0, Math.round(Number(overrides.refundAmountPkr) || 0))
        : Math.max(0, totalPaidPkr - sellerPayoutPkr);

    return {
      depositPkr: deposit,
      deliveryChargesPkr,
      totalPaidPkr,
      rentalChargePkr: 0,
      damageDeductionPkr: 0,
      lateFeePkr: 0,
      totalDeductionsPkr: sellerPayoutPkr,
      refundAmountPkr,
      sellerPayoutPkr,
      additionalChargePkr: 0,
      exceedsTotal: sellerPayoutPkr + refundAmountPkr > totalPaidPkr,
      manualSplit: true,
    };
  }

  const dailyRate = parseAmount(product?.rentPrice);
  const days = Math.max(1, Number(order.rentalDays) || 1);

  const rentalChargePkr =
    overrides.rentalChargePkr !== undefined
      ? Math.max(0, Math.round(Number(overrides.rentalChargePkr) || 0))
      : Math.round(dailyRate * days);

  const damageDeductionPkr =
    overrides.damageDeductionPkr !== undefined
      ? Math.max(0, Math.round(Number(overrides.damageDeductionPkr) || 0))
      : Math.max(0, Math.round(Number(order.damageDeductionPkr) || 0));

  const lateFeePkr =
    overrides.lateFeePkr !== undefined
      ? Math.max(0, Math.round(Number(overrides.lateFeePkr) || 0))
      : Math.max(0, Math.round(Number(order.lateFeePkr) || 0));

  const totalDeductionsPkr = rentalChargePkr + damageDeductionPkr + lateFeePkr;
  const cappedDeductions = Math.min(deposit, totalDeductionsPkr);
  const refundAmountPkr = Math.max(0, Math.round(deposit - cappedDeductions));
  // Delivery was paid by buyer at checkout — release it to the seller with rent/damage.
  const sellerPayoutPkr = cappedDeductions + deliveryChargesPkr;
  const additionalChargePkr = Math.max(0, totalDeductionsPkr - deposit);

  return {
    depositPkr: deposit,
    deliveryChargesPkr,
    totalPaidPkr,
    rentalChargePkr,
    damageDeductionPkr,
    lateFeePkr,
    totalDeductionsPkr,
    refundAmountPkr,
    sellerPayoutPkr,
    additionalChargePkr,
    exceedsTotal: false,
    manualSplit: false,
  };
}

function calculateSaleEscrow(order, overrides = {}) {
  const totalPaid = Math.max(0, Math.round(Number(order.amountPkr) || 0));
  // Successful sale: seller gets bid + delivery. Refunds only when admin/dispute overrides.
  const defaultSellerPayout = totalPaid;

  const sellerPayoutPkr =
    overrides.sellerPayoutPkr !== undefined
      ? Math.max(0, Math.round(Number(overrides.sellerPayoutPkr) || 0))
      : defaultSellerPayout;

  const refundAmountPkr =
    overrides.refundAmountPkr !== undefined
      ? Math.max(0, Math.round(Number(overrides.refundAmountPkr) || 0))
      : Math.max(0, totalPaid - sellerPayoutPkr);

  if (sellerPayoutPkr + refundAmountPkr > totalPaid) {
    return {
      totalPaidPkr: totalPaid,
      sellerPayoutPkr,
      refundAmountPkr,
      itemAmountPkr: order.itemAmountPkr || 0,
      deliveryChargesPkr: order.deliveryChargesPkr || 0,
      exceedsTotal: true,
    };
  }

  return {
    totalPaidPkr: totalPaid,
    sellerPayoutPkr,
    refundAmountPkr,
    itemAmountPkr: order.itemAmountPkr || 0,
    deliveryChargesPkr: order.deliveryChargesPkr || 0,
    exceedsTotal: false,
  };
}

function buildSaleEscrowSummary(order) {
  const breakdown = calculateSaleEscrow(order);
  return {
    orderType: "sale",
    totalPaidPkr: breakdown.totalPaidPkr,
    itemAmountPkr: breakdown.itemAmountPkr,
    deliveryChargesPkr: breakdown.deliveryChargesPkr,
    sellerPayoutPkr: breakdown.sellerPayoutPkr,
    refundAmountPkr: breakdown.refundAmountPkr,
    escrowStatus: order.escrowStatus || "none",
    escrowSettlementStatus: order.escrowSettlementStatus || "none",
    disputeReason: order.disputeReason || "",
    disputeReportId: order.disputeReportId?.toString?.() || "",
    shippedAt: order.shippedAt || null,
    deliveryConfirmedAt: order.deliveryConfirmedAt || null,
    saleEscrowAutoReleaseAt: order.saleEscrowAutoReleaseAt || null,
    saleEscrowReleaseReason: order.saleEscrowReleaseReason || "",
    adminSettlementNote: order.adminSettlementNote || "",
    fulfillmentStatus: order.fulfillmentStatus || "processing",
  };
}

function getSaleEscrowLabel(order) {
  const settlement = order.escrowSettlementStatus || "none";
  if (settlement === "disputed") {
    return "Payment held — delivery dispute under admin review";
  }

  const status = order.escrowStatus || "none";
  const total = order.amountPkr || 0;
  const fs = order.fulfillmentStatus || "processing";

  if (status === "held") {
    if (fs === "shipped" && order.saleEscrowAutoReleaseAt) {
      const releaseAt = new Date(order.saleEscrowAutoReleaseAt);
      if (releaseAt > new Date()) {
        return `PKR ${total.toLocaleString("en-PK")} held — confirm receipt or auto-releases in 5 days`;
      }
      return `PKR ${total.toLocaleString("en-PK")} held — auto-release pending`;
    }
    return `PKR ${total.toLocaleString("en-PK")} held until delivery confirmed`;
  }

  if (status === "released") {
    const sellerPart = order.sellerPayoutPkr || 0;
    const refundPart = order.refundAmountPkr || 0;
    if (refundPart > 0 && sellerPart > 0) {
      return `PKR ${refundPart.toLocaleString("en-PK")} refunded, PKR ${sellerPart.toLocaleString("en-PK")} released to seller`;
    }
    if (refundPart > 0 && sellerPart <= 0) {
      return `Dispute resolved — PKR ${refundPart.toLocaleString("en-PK")} refunded to buyer (no seller payout)`;
    }
    if (sellerPart > 0) {
      return `PKR ${sellerPart.toLocaleString("en-PK")} released to seller`;
    }
    return "Escrow released";
  }

  if (status === "failed") {
    return "Escrow release failed — contact support";
  }

  return "";
}

function getEscrowLabel(order) {
  if (order.type === "sale") {
    return getSaleEscrowLabel(order);
  }
  if (order.type !== "rental") return "";

  const settlement = order.escrowSettlementStatus || "none";
  if (settlement === "proposed") {
    return "Awaiting seller confirmation of return";
  }
  if (settlement === "disputed") {
    return "Dispute — admin review required";
  }
  if (settlement === "accepted" || settlement === "admin_settled") {
    if (order.escrowStatus === "released") {
      const refund = Number(order.refundAmountPkr) || 0;
      const payout = Number(order.sellerPayoutPkr) || 0;
      if (refund > 0 && payout > 0) {
        return `PKR ${refund.toLocaleString("en-PK")} refunded to buyer, PKR ${payout.toLocaleString("en-PK")} paid to seller`;
      }
      if (refund > 0 && payout <= 0) {
        return `Dispute resolved — PKR ${refund.toLocaleString("en-PK")} refunded to buyer (no seller payout)`;
      }
      if (payout > 0) {
        return `PKR ${payout.toLocaleString("en-PK")} paid to seller`;
      }
      return "Escrow settled";
    }
    return "Return confirmed — releasing escrow";
  }

  const status = order.escrowStatus || "none";
  if (status === "held") {
    return `PKR ${(order.amountPkr || 0).toLocaleString("en-PK")} held in escrow`;
  }
  if (status === "released") {
    const refund = Number(order.refundAmountPkr) || 0;
    const payout = Number(order.sellerPayoutPkr) || 0;
    if (refund > 0 && payout > 0) {
      return `PKR ${refund.toLocaleString("en-PK")} refunded to buyer, PKR ${payout.toLocaleString("en-PK")} paid to seller`;
    }
    if (refund > 0 && payout <= 0) {
      return `PKR ${refund.toLocaleString("en-PK")} refunded to buyer (no seller payout)`;
    }
    if (payout > 0) {
      return `PKR ${payout.toLocaleString("en-PK")} paid to seller`;
    }
    return "Escrow settled";
  }
  if (status === "failed") {
    return "Escrow refund failed — contact support";
  }
  return "";
}

function formatPkr(amount) {
  return `PKR ${Math.round(amount || 0).toLocaleString("en-PK")}`;
}

function buildSettlementSummary(order, product, overrides = {}) {
  const breakdown = calculateRentalEscrow(order, product, overrides);
  const released = order.escrowStatus === "released";
  const disputed = (order.escrowSettlementStatus || "none") === "disputed";

  // After release, always show the saved admin/seller amounts.
  // Important: use nullish coalescing — `0 || calculated` was wrongly showing rent+delivery
  // as seller payout when admin intentionally set seller payout to 0.
  let refundAmountPkr = breakdown.refundAmountPkr;
  let sellerPayoutPkr = breakdown.sellerPayoutPkr;

  if (released) {
    refundAmountPkr =
      order.refundAmountPkr !== undefined && order.refundAmountPkr !== null
        ? Number(order.refundAmountPkr) || 0
        : breakdown.refundAmountPkr;
    sellerPayoutPkr =
      order.sellerPayoutPkr !== undefined && order.sellerPayoutPkr !== null
        ? Number(order.sellerPayoutPkr) || 0
        : breakdown.sellerPayoutPkr;
  } else if (
    disputed &&
    overrides.sellerPayoutPkr === undefined &&
    overrides.refundAmountPkr === undefined
  ) {
    // Open delivery/return dispute: propose full buyer refund, no seller payout
    // (same default as resale disputes) — do not show rent-formula "proposed" amounts.
    refundAmountPkr = breakdown.totalPaidPkr;
    sellerPayoutPkr = 0;
  }

  const showRentBreakdown = !released && !disputed && !breakdown.manualSplit;
  const rentPerDayPkr = parseAmount(product?.rentPrice);
  const rentalDays = Math.max(1, Number(order.rentalDays) || 1);
  const rentalForPeriodPkr = Math.round(rentPerDayPkr * rentalDays);

  return {
    orderType: "rental",
    depositPkr: breakdown.depositPkr,
    deliveryChargesPkr: breakdown.deliveryChargesPkr,
    totalPaidPkr: breakdown.totalPaidPkr,
    itemAmountPkr: order.itemAmountPkr || breakdown.depositPkr,
    rentalDays,
    rentPerDayPkr,
    rentalForPeriodPkr,
    rentStart: order.rentStart || null,
    rentEnd: order.rentEnd || null,
    rentalChargePkr: showRentBreakdown ? breakdown.rentalChargePkr : rentalForPeriodPkr,
    damageDeductionPkr: showRentBreakdown ? breakdown.damageDeductionPkr : 0,
    lateFeePkr: showRentBreakdown ? breakdown.lateFeePkr : 0,
    totalDeductionsPkr: sellerPayoutPkr,
    refundAmountPkr,
    sellerPayoutPkr,
    // Happy-path payout = rent (+ damage/late) + delivery charged at checkout.
    sellerPayoutFromRentPkr: showRentBreakdown
      ? Math.min(breakdown.depositPkr, breakdown.rentalChargePkr + breakdown.damageDeductionPkr + breakdown.lateFeePkr)
      : 0,
    sellerPayoutFromDeliveryPkr: showRentBreakdown ? breakdown.deliveryChargesPkr : 0,
    additionalChargePkr: 0,
    exceedsTotal: Boolean(breakdown.exceedsTotal),
    escrowSettlementStatus: order.escrowSettlementStatus || "none",
    settlementNote: order.settlementNote || "",
    settlementEvidence: order.settlementEvidence || [],
    disputeReason: order.disputeReason || "",
    disputeReportId: order.disputeReportId?.toString?.() || "",
    settlementProposedAt: order.settlementProposedAt || null,
    settlementAcceptedAt: order.settlementAcceptedAt || null,
    settlementDisputedAt: order.settlementDisputedAt || null,
    adminSettlementNote: order.adminSettlementNote || "",
    escrowStatus: order.escrowStatus || "none",
    fulfillmentStatus: order.fulfillmentStatus || "processing",
    returnConfirmedAt: order.returnConfirmedAt || null,
    deliveryConfirmedAt: order.deliveryConfirmedAt || null,
  };
}

async function processBuyerRefund(order, refundAmountPkr, metadata = {}) {
  if (refundAmountPkr <= 0) {
    return { stripeRefundId: "", demoMode: false };
  }

  if (!order.stripePaymentIntentId) {
    // Tests/local demo may run without a real PaymentIntent.
    // Production must refund on Stripe (or admin refunds manually in Dashboard).
    if (process.env.NODE_ENV !== "production") {
      return { stripeRefundId: "", demoMode: true };
    }
    throw new Error(
      `Cannot refund PKR ${refundAmountPkr}: this order has no Stripe payment intent. Open Stripe and refund payment manually, or check that checkout completed.`,
    );
  }

  const stripe = getStripe();
  const refundCurrency = String(order.currency || getCurrency()).toLowerCase();
  const refundUnits = toStripeUnitAmount(refundAmountPkr, refundCurrency);
  const maxUnits = order.stripeAmount || refundUnits;

  const refund = await stripe.refunds.create({
    payment_intent: order.stripePaymentIntentId,
    amount: Math.min(refundUnits, maxUnits),
    reason: "requested_by_customer",
    metadata: {
      orderId: order._id.toString(),
      orderPublicId: order.orderId || "",
      refundAmountPkr: String(refundAmountPkr),
      ...metadata,
    },
  });

  return { stripeRefundId: refund.id, demoMode: false };
}

async function processSellerPayoutTransfer(order, sellerPayoutPkr) {
  const result = await transferSellerPayout({
    order,
    sellerId: order.sellerId,
    amountPkr: sellerPayoutPkr,
  });

  if (result.transferId) {
    order.stripeTransferId = result.transferId;
    order.sellerPayoutStatus = "transferred";
    return {
      stripeTransferId: result.transferId,
      demoMode: false,
      transferSkipped: false,
    };
  }

  if (result.skipped) {
    if (result.reason === "transfer_failed") {
      order.sellerPayoutStatus = "failed";
    } else {
      order.sellerPayoutStatus = sellerPayoutPkr > 0 ? "ledger_only" : "none";
    }
    return {
      stripeTransferId: "",
      demoMode: Boolean(result.demoMode),
      transferSkipped: true,
      transferSkipReason: result.reason,
      transferMessage: result.message,
    };
  }

  return { stripeTransferId: "", demoMode: false, transferSkipped: false };
}

async function releaseRentalEscrow(order, overrides = {}) {
  if (order.type !== "rental") {
    throw new Error("Escrow release only applies to rental orders");
  }
  if (order.escrowStatus === "released") {
    return {
      order,
      alreadyReleased: true,
      ...calculateRentalEscrow(order, null, overrides),
    };
  }
  if (order.paymentStatus !== "paid") {
    throw new Error("Rental deposit must be paid before escrow can be released");
  }

  const allowedSettlement = ["accepted", "admin_settled"];
  if (
    order.escrowSettlementStatus &&
    !allowedSettlement.includes(order.escrowSettlementStatus)
  ) {
    throw new Error(
      "Escrow can only be released after the seller confirms the return or admin resolves a dispute",
    );
  }

  const product =
    (order.productId && typeof order.productId === "object" && order.productId) ||
    (await Product.findById(order.productId).select("itemPrice rentPrice title"));

  const breakdown = calculateRentalEscrow(order, product, overrides);

  if (breakdown.exceedsTotal) {
    throw new Error(
      "Seller payout and buyer refund cannot exceed the total amount paid",
    );
  }

  if (breakdown.additionalChargePkr > 0) {
    throw new Error(
      "Total deductions exceed the deposit. Admin must cap damage/rent or collect additional payment before release.",
    );
  }

  order.rentalChargePkr = breakdown.manualSplit ? 0 : breakdown.rentalChargePkr;
  order.damageDeductionPkr = breakdown.manualSplit ? 0 : breakdown.damageDeductionPkr;
  order.lateFeePkr = breakdown.manualSplit ? 0 : breakdown.lateFeePkr;
  order.refundAmountPkr = breakdown.refundAmountPkr;
  order.sellerPayoutPkr = breakdown.sellerPayoutPkr;
  // Only stamp return confirmation for actual return flows — not delivery disputes.
  if (
    order.fulfillmentStatus === "returned" ||
    order.deliveryConfirmedAt ||
    (!breakdown.manualSplit && breakdown.sellerPayoutPkr > 0)
  ) {
    order.returnConfirmedAt = order.returnConfirmedAt || new Date();
  }

  let stripeRefundId = "";
  let stripeTransferId = "";
  let demoMode = false;
  let transferSkipped = false;
  let transferSkipReason = "";
  let transferMessage = "";

  try {
    // Transfer seller share FIRST while the full charge is still available.
    // Rentals usually refund most of the deposit; doing the refund first makes
    // source_transaction transfers fail (fees + remaining balance), which left
    // payouts as ledger_only on Relux while Stripe stayed empty.
    if (breakdown.sellerPayoutPkr > 0) {
      const transferResult = await processSellerPayoutTransfer(order, breakdown.sellerPayoutPkr);
      stripeTransferId = transferResult.stripeTransferId;
      demoMode = demoMode || transferResult.demoMode;
      transferSkipped = Boolean(transferResult.transferSkipped);
      transferSkipReason = transferResult.transferSkipReason || "";
      transferMessage = transferResult.transferMessage || "";
    }

    if (breakdown.refundAmountPkr > 0) {
      const refundResult = await processBuyerRefund(order, breakdown.refundAmountPkr, {
        rentalChargePkr: String(breakdown.rentalChargePkr),
        damageDeductionPkr: String(breakdown.damageDeductionPkr),
        sellerPayoutPkr: String(breakdown.sellerPayoutPkr),
      });
      stripeRefundId = refundResult.stripeRefundId;
      demoMode = demoMode || refundResult.demoMode;
      if (stripeRefundId) {
        order.stripeRefundId = stripeRefundId;
      }
      if (!order.refundedAt) {
        order.refundedAt = new Date();
      }
      const paidTotal = breakdown.totalPaidPkr || breakdown.depositPkr;
      if (breakdown.refundAmountPkr >= paidTotal) {
        order.paymentStatus = "refunded";
      }
    }

    order.escrowStatus = "released";
    order.escrowReleasedAt = new Date();
    order.escrowSettlementStatus = order.escrowSettlementStatus || "accepted";
    await order.save();
    try {
      await finalizeOrderAfterEscrowRelease(order);
    } catch (finalizeError) {
      console.error(
        "[escrow finalize after rental release]",
        finalizeError.message || finalizeError,
      );
    }
  } catch (error) {
    order.escrowStatus = "failed";
    order.sellerPayoutStatus = "failed";
    await order.save();
    throw new Error(error.message || "Escrow release failed");
  }

  return {
    order,
    alreadyReleased: false,
    ...breakdown,
    stripeRefundId,
    stripeTransferId,
    demoMode,
    transferSkipped,
    transferSkipReason,
    transferMessage,
  };
}

async function releaseSaleEscrow(order, overrides = {}, releaseReason = "buyer_confirmed") {
  if (order.type !== "sale") {
    throw new Error("Sale escrow release only applies to purchase orders");
  }
  if (order.escrowStatus === "released") {
    return {
      order,
      alreadyReleased: true,
      ...calculateSaleEscrow(order, overrides),
    };
  }
  if (order.paymentStatus !== "paid") {
    throw new Error("Purchase must be paid before escrow can be released");
  }
  if (order.escrowSettlementStatus === "disputed" && releaseReason !== "admin_settled") {
    throw new Error("Escrow is frozen while admin reviews the delivery dispute");
  }
  // Allow admin to retry after a failed Stripe/refund attempt.
  if (order.escrowStatus === "failed" && releaseReason === "admin_settled") {
    order.escrowStatus = "held";
  }

  const breakdown = calculateSaleEscrow(order, overrides);
  if (breakdown.exceedsTotal) {
    throw new Error(
      "Seller payout and buyer refund cannot exceed the total amount paid",
    );
  }

  order.sellerPayoutPkr = breakdown.sellerPayoutPkr;
  order.refundAmountPkr = breakdown.refundAmountPkr;

  let stripeRefundId = "";
  let stripeTransferId = "";
  let demoMode = false;
  let transferSkipped = false;

  try {
    // Prefer transferring the seller share before any buyer refund so the
    // charge still has enough balance for source_transaction transfers.
    if (breakdown.sellerPayoutPkr > 0) {
      const transferResult = await processSellerPayoutTransfer(order, breakdown.sellerPayoutPkr);
      stripeTransferId = transferResult.stripeTransferId;
      demoMode = demoMode || transferResult.demoMode;
      transferSkipped = transferResult.transferSkipped;
    }

    if (breakdown.refundAmountPkr > 0) {
      const refundResult = await processBuyerRefund(order, breakdown.refundAmountPkr, {
        sellerPayoutPkr: String(breakdown.sellerPayoutPkr),
      });
      stripeRefundId = refundResult.stripeRefundId;
      demoMode = demoMode || refundResult.demoMode;
      if (stripeRefundId) {
        order.stripeRefundId = stripeRefundId;
      }
      if (!order.refundedAt) {
        order.refundedAt = new Date();
      }
      if (!stripeRefundId && !refundResult.demoMode) {
        throw new Error("Stripe refund did not return a refund id");
      }
    }

    order.escrowStatus = "released";
    order.escrowReleasedAt = new Date();
    order.saleEscrowReleaseReason = releaseReason;
    if (releaseReason === "admin_settled") {
      order.escrowSettlementStatus = "admin_settled";
    } else if (releaseReason === "buyer_confirmed" || releaseReason === "auto_release") {
      order.escrowSettlementStatus = "accepted";
    }
    if (breakdown.refundAmountPkr >= breakdown.totalPaidPkr) {
      order.paymentStatus = "refunded";
      if (!order.refundedAt) order.refundedAt = new Date();
    }
    await order.save();
    await finalizeOrderAfterEscrowRelease(order);
  } catch (error) {
    order.escrowStatus = "failed";
    order.sellerPayoutStatus = "failed";
    await order.save();
    throw new Error(error.message || "Escrow release failed");
  }

  return {
    order,
    alreadyReleased: false,
    ...breakdown,
    stripeRefundId,
    stripeTransferId,
    demoMode,
    transferSkipped,
  };
}

async function processSaleEscrowAutoReleases() {
  const Order = require("../models/Order");
  const now = new Date();
  const orders = await Order.find({
    type: "sale",
    escrowStatus: "held",
    fulfillmentStatus: "shipped",
    escrowSettlementStatus: { $nin: ["disputed"] },
    saleEscrowAutoReleaseAt: { $lte: now },
  });

  const results = [];
  for (const order of orders) {
    order.fulfillmentStatus = "delivered";
    order.deliveryConfirmedAt = now;
    const result = await releaseSaleEscrow(order, {}, "auto_release");
    results.push(result);
  }
  return results;
}

/**
 * Retry Stripe transfers for escrow releases that were recorded on Relux only
 * (ledger_only / failed), typically after rental refund-before-transfer failures.
 */
async function retryPendingSellerPayouts(sellerId) {
  const Order = require("../models/Order");
  const filter = {
    escrowStatus: "released",
    sellerPayoutPkr: { $gt: 0 },
    $and: [
      {
        $or: [
          { stripeTransferId: { $exists: false } },
          { stripeTransferId: null },
          { stripeTransferId: "" },
        ],
      },
      {
        $or: [
          { sellerPayoutStatus: { $in: ["ledger_only", "failed", "none"] } },
          { sellerPayoutStatus: { $exists: false } },
          { sellerPayoutStatus: null },
          { sellerPayoutStatus: "" },
        ],
      },
    ],
  };
  if (sellerId) {
    filter.sellerId = sellerId;
  }

  const orders = await Order.find(filter).sort({ escrowReleasedAt: -1 }).limit(50);
  const results = [];

  for (const order of orders) {
    try {
      const transferResult = await processSellerPayoutTransfer(
        order,
        order.sellerPayoutPkr,
      );
      await order.save();
      results.push({
        orderId: order.orderId || String(order._id),
        type: order.type,
        amountPkr: order.sellerPayoutPkr,
        ok: !transferResult.transferSkipped && Boolean(transferResult.stripeTransferId),
        transferId: transferResult.stripeTransferId || "",
        status: order.sellerPayoutStatus,
        skipReason: transferResult.transferSkipReason || "",
        message: transferResult.transferMessage || "",
      });
    } catch (error) {
      results.push({
        orderId: order.orderId || String(order._id),
        type: order.type,
        amountPkr: order.sellerPayoutPkr,
        ok: false,
        transferId: "",
        status: "failed",
        skipReason: "transfer_failed",
        message: error.message || "Retry failed",
      });
    }
  }

  return results;
}

module.exports = {
  parseAmount,
  calculateRentalEscrow,
  calculateSaleEscrow,
  buildSaleEscrowSummary,
  getEscrowLabel,
  formatPkr,
  buildSettlementSummary,
  releaseRentalEscrow,
  releaseSaleEscrow,
  processSaleEscrowAutoReleases,
  retryPendingSellerPayouts,
  SALE_AUTO_RELEASE_MS,
};

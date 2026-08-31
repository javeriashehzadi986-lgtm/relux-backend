const Product = require("../models/Product");
const { getStripe, toStripeUnitAmount } = require("./stripeService");

function parseAmount(value) {
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function calculateRentalEscrow(order, product) {
  const deposit = order.amountPkr > 0 ? order.amountPkr : parseAmount(product?.itemPrice);
  const dailyRate = parseAmount(product?.rentPrice);
  const days = Math.max(1, Number(order.rentalDays) || 1);
  const rentalChargePkr = Math.round(dailyRate * days);
  const refundAmountPkr = Math.max(0, Math.round(deposit - rentalChargePkr));

  return {
    depositPkr: deposit,
    rentalChargePkr,
    refundAmountPkr,
  };
}

function getEscrowLabel(order) {
  if (order.type !== "rental") return "";

  const status = order.escrowStatus || "none";
  if (status === "held") {
    return `PKR ${(order.amountPkr || 0).toLocaleString("en-PK")} held in escrow`;
  }
  if (status === "released") {
    if (order.refundAmountPkr > 0) {
      return `PKR ${order.refundAmountPkr.toLocaleString("en-PK")} refunded to buyer`;
    }
    return "Escrow settled (rental charges applied)";
  }
  if (status === "failed") {
    return "Escrow refund failed — contact support";
  }
  return "";
}

function formatPkr(amount) {
  return `PKR ${Math.round(amount || 0).toLocaleString("en-PK")}`;
}

async function releaseRentalEscrow(order) {
  if (order.type !== "rental") {
    throw new Error("Escrow release only applies to rental orders");
  }
  if (order.escrowStatus === "released") {
    return {
      order,
      alreadyReleased: true,
      ...calculateRentalEscrow(order, null),
    };
  }
  if (order.paymentStatus !== "paid") {
    throw new Error("Rental deposit must be paid before escrow can be released");
  }

  const product =
    (order.productId && typeof order.productId === "object" && order.productId) ||
    (await Product.findById(order.productId).select("itemPrice rentPrice title"));

  const { depositPkr, rentalChargePkr, refundAmountPkr } = calculateRentalEscrow(
    order,
    product,
  );

  order.rentalChargePkr = rentalChargePkr;
  order.refundAmountPkr = refundAmountPkr;
  order.returnConfirmedAt = new Date();

  if (refundAmountPkr <= 0) {
    order.escrowStatus = "released";
    order.escrowReleasedAt = new Date();
    await order.save();
    return {
      order,
      alreadyReleased: false,
      depositPkr,
      rentalChargePkr,
      refundAmountPkr,
      stripeRefundId: "",
    };
  }

  if (!order.stripePaymentIntentId) {
    order.escrowStatus = "released";
    order.escrowReleasedAt = new Date();
    order.paymentStatus = refundAmountPkr >= depositPkr ? "refunded" : "refunded";
    order.refundedAt = new Date();
    await order.save();
    return {
      order,
      alreadyReleased: false,
      depositPkr,
      rentalChargePkr,
      refundAmountPkr,
      stripeRefundId: "",
      demoMode: true,
    };
  }

  const stripe = getStripe();
  const refundUnits = toStripeUnitAmount(refundAmountPkr);
  const maxUnits = order.stripeAmount || refundUnits;

  let refund;
  try {
    refund = await stripe.refunds.create({
      payment_intent: order.stripePaymentIntentId,
      amount: Math.min(refundUnits, maxUnits),
      reason: "requested_by_customer",
      metadata: {
        orderId: order._id.toString(),
        orderPublicId: order.orderId || "",
        rentalChargePkr: String(rentalChargePkr),
        refundAmountPkr: String(refundAmountPkr),
      },
    });
  } catch (error) {
    order.escrowStatus = "failed";
    await order.save();
    throw new Error(error.message || "Stripe could not refund the escrow deposit");
  }

  order.escrowStatus = "released";
  order.escrowReleasedAt = new Date();
  order.stripeRefundId = refund.id;
  order.refundedAt = new Date();
  order.paymentStatus = "refunded";
  await order.save();

  return {
    order,
    alreadyReleased: false,
    depositPkr,
    rentalChargePkr,
    refundAmountPkr,
    stripeRefundId: refund.id,
  };
}

module.exports = {
  parseAmount,
  calculateRentalEscrow,
  getEscrowLabel,
  formatPkr,
  releaseRentalEscrow,
};

const SellerVerification = require("../models/SellerVerification");
const { getStripe, getCurrency, toStripeUnitAmount } = require("./stripeService");

async function syncSellerConnectAccount(sellerId) {
  const verification = await SellerVerification.findOne({ userId: sellerId });
  if (!verification?.stripeAccountId) {
    return {
      verification,
      account: null,
      connected: false,
      payoutsEnabled: false,
    };
  }

  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(verification.stripeAccountId);
  const connected = Boolean(
    account.details_submitted && (account.charges_enabled || account.payouts_enabled),
  );
  const payoutsEnabled = Boolean(account.payouts_enabled);

  verification.stripeConnected = connected;
  await verification.save();

  return { verification, account, connected, payoutsEnabled };
}

async function getChargeIdForPaymentIntent(paymentIntentId) {
  if (!paymentIntentId) return null;
  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (!pi.latest_charge) return null;
  return typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id || null;
}

/**
 * Transfer seller payout from platform balance to seller Connect account.
 * Uses source_transaction when available so transfer is tied to the buyer charge.
 */
async function transferSellerPayout({ order, sellerId, amountPkr }) {
  const payoutPkr = Math.max(0, Math.round(Number(amountPkr) || 0));
  if (payoutPkr <= 0) {
    return { skipped: true, reason: "zero_amount" };
  }

  const { verification, connected, payoutsEnabled } = await syncSellerConnectAccount(sellerId);

  if (!verification?.stripeAccountId) {
    return {
      skipped: true,
      demoMode: true,
      reason: "seller_not_connected",
      message: "Seller has not linked Stripe Connect — payout recorded only",
    };
  }

  if (!connected || !payoutsEnabled) {
    return {
      skipped: true,
      demoMode: true,
      reason: "payouts_not_enabled",
      message: "Seller Stripe account is not ready for payouts — payout recorded only",
    };
  }

  if (!order.stripePaymentIntentId) {
    return {
      skipped: true,
      demoMode: true,
      reason: "no_payment_intent",
      message: "No Stripe payment on file — payout recorded only",
    };
  }

  const stripe = getStripe();
  const currency = getCurrency();
  const amount = toStripeUnitAmount(payoutPkr);
  const chargeId = await getChargeIdForPaymentIntent(order.stripePaymentIntentId);

  const params = {
    amount,
    currency,
    destination: verification.stripeAccountId,
    description: `Relux Hub payout — order ${order.orderId || order._id}`,
    metadata: {
      orderId: order._id.toString(),
      orderPublicId: order.orderId || "",
      sellerId: sellerId.toString(),
      sellerPayoutPkr: String(payoutPkr),
      orderType: order.type || "",
    },
  };

  if (chargeId) {
    params.source_transaction = chargeId;
  }

  try {
    const transfer = await stripe.transfers.create(params);
    return {
      transferId: transfer.id,
      demoMode: false,
      skipped: false,
    };
  } catch (error) {
    const strict = String(process.env.STRIPE_CONNECT_STRICT || "").toLowerCase() === "true";
    if (strict) {
      throw new Error(error.message || "Stripe could not transfer payout to seller");
    }
    console.error("[stripe connect transfer]", error.message || error);
    return {
      skipped: true,
      demoMode: true,
      reason: "transfer_failed",
      message: error.message || "Transfer failed — payout recorded only",
    };
  }
}

module.exports = {
  syncSellerConnectAccount,
  getChargeIdForPaymentIntent,
  transferSellerPayout,
};

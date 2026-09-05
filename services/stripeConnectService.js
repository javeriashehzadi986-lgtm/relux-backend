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
      message: "Seller Stripe account is not ready for payouts — finish Connect onboarding",
    };
  }

  const stripe = getStripe();
  const currency = getCurrency();
  const amount = toStripeUnitAmount(payoutPkr);
  const chargeId = order.stripePaymentIntentId
    ? await getChargeIdForPaymentIntent(order.stripePaymentIntentId)
    : null;

  const buildParams = (useSourceTransaction) => {
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
    if (useSourceTransaction && chargeId) {
      params.source_transaction = chargeId;
    }
    return params;
  };

  const strict = String(process.env.STRIPE_CONNECT_STRICT || "").toLowerCase() === "true";

  try {
    const transfer = await stripe.transfers.create(buildParams(Boolean(chargeId)));
    return {
      transferId: transfer.id,
      demoMode: false,
      skipped: false,
    };
  } catch (firstError) {
    // source_transaction can fail (cross-currency / charge state). Retry from platform balance.
    if (chargeId) {
      try {
        const transfer = await stripe.transfers.create(buildParams(false));
        return {
          transferId: transfer.id,
          demoMode: false,
          skipped: false,
          retriedWithoutSource: true,
        };
      } catch (retryError) {
        if (strict) {
          throw new Error(retryError.message || "Stripe could not transfer payout to seller");
        }
        console.error(
          "[stripe connect transfer retry]",
          retryError.message || retryError,
          "| first:",
          firstError.message || firstError,
        );
        return {
          skipped: true,
          demoMode: false,
          reason: "transfer_failed",
          message: retryError.message || firstError.message || "Transfer failed",
        };
      }
    }

    if (strict) {
      throw new Error(firstError.message || "Stripe could not transfer payout to seller");
    }
    console.error("[stripe connect transfer]", firstError.message || firstError);
    return {
      skipped: true,
      demoMode: !order.stripePaymentIntentId,
      reason: order.stripePaymentIntentId ? "transfer_failed" : "no_payment_intent",
      message:
        firstError.message ||
        (order.stripePaymentIntentId
          ? "Transfer failed"
          : "No Stripe payment on file — payout recorded only"),
    };
  }
}

module.exports = {
  syncSellerConnectAccount,
  getChargeIdForPaymentIntent,
  transferSellerPayout,
};

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
 *
 * Charges may be in pkr while Connect / platform settlement is usd — try the
 * order currency first, then fall back to usd so ledger_only / failed payouts
 * still reach the seller Express dashboard.
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
  const orderCurrency = String(order.currency || getCurrency()).toLowerCase();
  const platformCurrency = getCurrency();
  // Connect Express settles in platform currency (usd). Prefer that first so
  // confirm-return / release sends money automatically without a seller retry click.
  const currencies = [
    ...new Set(
      [platformCurrency, orderCurrency, "usd"].filter(Boolean),
    ),
  ];

  // After a buyer refund, source_transaction usually cannot cover the seller share
  // (fees + reduced remaining charge). Use platform balance instead.
  const alreadyRefunded = Boolean(order.stripeRefundId);
  const chargeId =
    !alreadyRefunded && order.stripePaymentIntentId
      ? await getChargeIdForPaymentIntent(order.stripePaymentIntentId)
      : null;

  const buildParams = (currency, useSourceTransaction) => {
    const params = {
      amount: toStripeUnitAmount(payoutPkr, currency),
      currency,
      destination: verification.stripeAccountId,
      description: `Relux Hub payout — order ${order.orderId || order._id}`,
      metadata: {
        orderId: order._id.toString(),
        orderPublicId: order.orderId || "",
        sellerId: sellerId.toString(),
        sellerPayoutPkr: String(payoutPkr),
        orderType: order.type || "",
        transferCurrency: currency,
      },
    };
    // source_transaction must match transfer currency — skip when falling back.
    if (
      useSourceTransaction &&
      chargeId &&
      currency === orderCurrency
    ) {
      params.source_transaction = chargeId;
    }
    return params;
  };

  const strict = String(process.env.STRIPE_CONNECT_STRICT || "").toLowerCase() === "true";
  const errors = [];

  for (const currency of currencies) {
    const trySource = Boolean(chargeId) && currency === orderCurrency;
    const attempts = trySource ? [true, false] : [false];

    for (const useSource of attempts) {
      try {
        const transfer = await stripe.transfers.create(
          buildParams(currency, useSource),
        );
        return {
          transferId: transfer.id,
          demoMode: false,
          skipped: false,
          currency,
          retriedWithoutSource: trySource && !useSource,
        };
      } catch (error) {
        errors.push(`${currency}${useSource ? "+source" : ""}: ${error.message || error}`);
      }
    }
  }

  const message = errors[errors.length - 1] || "Transfer failed";
  if (strict) {
    throw new Error(message);
  }
  console.error("[stripe connect transfer]", errors.join(" | "));
  return {
    skipped: true,
    demoMode: !order.stripePaymentIntentId,
    reason: order.stripePaymentIntentId ? "transfer_failed" : "no_payment_intent",
    message: order.stripePaymentIntentId
      ? message
      : "No Stripe payment on file — payout recorded only",
  };
}

module.exports = {
  syncSellerConnectAccount,
  getChargeIdForPaymentIntent,
  transferSellerPayout,
};

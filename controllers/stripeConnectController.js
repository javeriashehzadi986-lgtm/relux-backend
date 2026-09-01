const SellerVerification = require("../models/SellerVerification");
const { getStripe, getFrontendUrl } = require("../services/stripeService");
const { syncSellerConnectAccount } = require("../services/stripeConnectService");

function getErrorMessage(error) {
  if (error?.type === "StripeInvalidRequestError") {
    return error.message || "Stripe rejected this Connect request";
  }
  if (error.message?.includes("STRIPE_SECRET_KEY")) {
    return error.message;
  }
  return error.message || "Something went wrong";
}

async function syncConnectFlags(verification) {
  if (!verification?.userId) {
    return { verification, account: null };
  }
  const synced = await syncSellerConnectAccount(verification.userId);
  return {
    verification: synced.verification || verification,
    account: synced.account,
  };
}

/** Seller: start or resume Stripe Connect Express onboarding */
async function createConnectOnboardingLink(req, res) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Only sellers can connect Stripe" });
    }

    const verification = await SellerVerification.findOne({ userId: req.user._id });
    if (!verification) {
      return res.status(400).json({
        message: "Submit seller verification documents before connecting Stripe",
      });
    }

    const stripe = getStripe();
    const frontend = getFrontendUrl();
    const country = String(process.env.STRIPE_CONNECT_COUNTRY || "US").toUpperCase();

    if (!verification.stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country,
        email: req.user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        metadata: {
          reluxUserId: req.user._id.toString(),
        },
      });
      verification.stripeAccountId = account.id;
      verification.stripeConnected = false;
      await verification.save();
    }

    const accountLink = await stripe.accountLinks.create({
      account: verification.stripeAccountId,
      refresh_url: `${frontend}/sellerProfile?section=profile&stripe=refresh`,
      return_url: `${frontend}/sellerProfile?section=profile&stripe=return`,
      type: "account_onboarding",
    });

    res.json({
      url: accountLink.url,
      stripeAccountId: verification.stripeAccountId,
      stripeConnected: Boolean(verification.stripeConnected),
    });
  } catch (error) {
    console.error("[stripe connect]", error);
    const message = getErrorMessage(error);
    const hint =
      message.includes("signed up for Connect") || message.includes("Connect")
        ? " Enable Stripe Connect at https://dashboard.stripe.com/connect and retry."
        : "";
    res.status(500).json({ message: message + hint });
  }
}

/** Seller: refresh Connect status after return from Stripe */
async function getConnectStatus(req, res) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Only sellers can view Connect status" });
    }

    const verification = await SellerVerification.findOne({ userId: req.user._id });
    if (!verification?.stripeAccountId) {
      return res.json({
        stripeConnected: false,
        stripeAccountId: "",
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
      });
    }

    const { verification: synced, account } = await syncConnectFlags(verification);

    res.json({
      stripeConnected: Boolean(synced.stripeConnected),
      stripeAccountId: synced.stripeAccountId || "",
      detailsSubmitted: Boolean(account?.details_submitted),
      chargesEnabled: Boolean(account?.charges_enabled),
      payoutsEnabled: Boolean(account?.payouts_enabled),
    });
  } catch (error) {
    console.error("[stripe connect status]", error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  createConnectOnboardingLink,
  getConnectStatus,
};

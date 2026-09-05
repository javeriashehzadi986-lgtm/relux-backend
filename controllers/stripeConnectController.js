const SellerVerification = require("../models/SellerVerification");
const Order = require("../models/Order");
const { getStripe, getFrontendUrl, getCurrency } = require("../services/stripeService");
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

function formatStripeMoney(amount, currency) {
  const major = (Number(amount) || 0) / 100;
  const code = String(currency || "usd").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${code} ${major.toFixed(2)}`;
  }
}

function formatPkr(amount) {
  return `PKR ${Math.round(Number(amount) || 0).toLocaleString("en-PK")}`;
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

function resolveConnectReturnUrls(frontend, returnTo) {
  const dest = String(returnTo || "profile").toLowerCase();
  if (dest === "pending" || dest === "verification") {
    return {
      refresh_url: `${frontend}/seller-pending?stripe=refresh`,
      return_url: `${frontend}/seller-pending?stripe=return`,
    };
  }
  return {
    refresh_url: `${frontend}/sellerProfile?section=profile&stripe=refresh`,
    return_url: `${frontend}/sellerProfile?section=profile&stripe=return`,
  };
}

/** Seller: start or resume Stripe Connect Express onboarding */
async function createConnectOnboardingLink(req, res) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({
        message: "Submit your seller verification (CNIC and details) first, then connect Stripe",
      });
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
    const returnTo = req.body?.returnTo || req.query?.returnTo || "profile";
    const { refresh_url, return_url } = resolveConnectReturnUrls(frontend, returnTo);

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
      refresh_url,
      return_url,
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

/** Seller: open Express Dashboard (balance / payouts) */
async function createExpressDashboardLink(req, res) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Only sellers can open Stripe dashboard" });
    }

    const verification = await SellerVerification.findOne({ userId: req.user._id });
    if (!verification?.stripeAccountId) {
      return res.status(400).json({
        message: "Connect Stripe first, then you can open your payout dashboard",
      });
    }

    const { verification: synced, account } = await syncConnectFlags(verification);
    if (!account?.details_submitted) {
      return res.status(400).json({
        message: "Finish Stripe onboarding before opening the payout dashboard",
      });
    }

    const stripe = getStripe();
    const loginLink = await stripe.accounts.createLoginLink(synced.stripeAccountId);
    res.json({ url: loginLink.url });
  } catch (error) {
    console.error("[stripe express dashboard]", error);
    res.status(500).json({ message: getErrorMessage(error) });
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

/** Seller: Relux payout history + Stripe Connect balance */
async function getSellerPayoutOverview(req, res) {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Only sellers can view payouts" });
    }

    const verification = await SellerVerification.findOne({ userId: req.user._id });
    const sellerId = req.user._id;

    const payoutOrders = await Order.find({
      sellerId,
      sellerPayoutPkr: { $gt: 0 },
      escrowStatus: "released",
    })
      .populate("productId", "title")
      .sort({ escrowReleasedAt: -1, updatedAt: -1 })
      .limit(20)
      .lean();

    const totalEarnedPkr = payoutOrders.reduce(
      (sum, order) => sum + (Number(order.sellerPayoutPkr) || 0),
      0,
    );

    const recentPayouts = payoutOrders.map((order) => {
      const product = order.productId;
      return {
        orderId: order.orderId || String(order._id),
        id: String(order._id),
        title:
          product && typeof product === "object" && product.title
            ? product.title
            : "Order payout",
        amountPkr: Number(order.sellerPayoutPkr) || 0,
        amountLabel: formatPkr(order.sellerPayoutPkr),
        transferId: order.stripeTransferId || "",
        payoutStatus: order.sellerPayoutStatus || "none",
        releasedAt: order.escrowReleasedAt || order.updatedAt || null,
        type: order.type === "sale" ? "sale" : "rental",
      };
    });

    let stripeBalance = {
      availableLabel: "—",
      pendingLabel: "—",
      currency: getCurrency(),
      connected: false,
    };

    if (verification?.stripeAccountId) {
      try {
        const stripe = getStripe();
        const { verification: synced } = await syncConnectFlags(verification);
        const balance = await stripe.balance.retrieve({
          stripeAccount: synced.stripeAccountId,
        });
        const currency = getCurrency();
        const available =
          (balance.available || []).find((b) => b.currency === currency) ||
          balance.available?.[0];
        const pending =
          (balance.pending || []).find((b) => b.currency === currency) ||
          balance.pending?.[0];

        stripeBalance = {
          availableLabel: available
            ? formatStripeMoney(available.amount, available.currency)
            : formatStripeMoney(0, currency),
          pendingLabel: pending
            ? formatStripeMoney(pending.amount, pending.currency)
            : formatStripeMoney(0, currency),
          currency,
          connected: Boolean(synced.stripeConnected),
        };
      } catch (balanceError) {
        console.error("[stripe seller balance]", balanceError.message || balanceError);
      }
    }

    res.json({
      stripeConnected: Boolean(verification?.stripeConnected),
      stripeAccountId: verification?.stripeAccountId || "",
      totalEarnedPkr,
      totalEarnedLabel: formatPkr(totalEarnedPkr),
      recentPayouts,
      stripeBalance,
    });
  } catch (error) {
    console.error("[seller payout overview]", error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  createConnectOnboardingLink,
  createExpressDashboardLink,
  getConnectStatus,
  getSellerPayoutOverview,
};

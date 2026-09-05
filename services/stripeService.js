const Stripe = require("stripe");

let stripeClient = null;

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is missing in backend .env");
  }
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function getCurrency() {
  return String(process.env.STRIPE_CURRENCY || "usd").toLowerCase();
}

/**
 * Relux prices are stored in PKR and converted for Stripe.
 * Default charge currency is USD (matches Connect Express settlement).
 * Always disable Adaptive Pricing on Checkout — otherwise Stripe re-presents
 * a higher local PKR total than Relux quoted (e.g. 50,000 → ~51,538).
 */
function toStripeUnitAmount(pkrAmount, currencyOverride) {
  const pkr = Math.max(0, Math.round(Number(pkrAmount) || 0));
  const currency = String(currencyOverride || getCurrency()).toLowerCase();

  if (currency === "pkr") {
    return Math.max(100, pkr * 100);
  }

  const rate = Number(process.env.STRIPE_PKR_TO_CURRENCY) || 280;
  const major = pkr / rate;
  const cents = Math.round(major * 100);
  return Math.max(50, cents);
}

/** Shared Checkout flags — never let Adaptive Pricing inflate quoted PKR. */
function getCheckoutSessionExtras() {
  return {
    adaptive_pricing: { enabled: false },
  };
}

function getFrontendUrl() {
  return String(process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

function getBackendPublicUrl() {
  const port = process.env.PORT || 5002;
  return String(process.env.API_PUBLIC_URL || `http://localhost:${port}`).replace(
    /\/$/,
    "",
  );
}

module.exports = {
  getStripe,
  getCurrency,
  toStripeUnitAmount,
  getCheckoutSessionExtras,
  getFrontendUrl,
  getBackendPublicUrl,
};

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
 * Relux stores prices in PKR. Stripe account currency may be USD/EUR/etc.
 * Convert PKR → charge currency using STRIPE_PKR_TO_CURRENCY (default 280 ≈ PKR per 1 USD).
 * If STRIPE_CURRENCY=pkr, charge PKR paisa directly.
 */
function toStripeUnitAmount(pkrAmount) {
  const pkr = Math.max(0, Math.round(Number(pkrAmount) || 0));
  const currency = getCurrency();

  if (currency === "pkr") {
    return Math.max(100, pkr * 100);
  }

  const rate = Number(process.env.STRIPE_PKR_TO_CURRENCY) || 280;
  const major = pkr / rate;
  const cents = Math.round(major * 100);
  return Math.max(50, cents);
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
  getFrontendUrl,
  getBackendPublicUrl,
};

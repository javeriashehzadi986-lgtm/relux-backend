const { getCurrency, toStripeUnitAmount } = require("../services/stripeService");

describe("Stripe Service — Chapter 5: Payment Conversion", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.STRIPE_CURRENCY = "usd";
    process.env.STRIPE_PKR_TO_CURRENCY = "280";
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("TC-ST-01: uses USD as default currency", () => {
    expect(getCurrency()).toBe("usd");
  });

  it("TC-ST-02: converts PKR to Stripe minor units", () => {
    const units = toStripeUnitAmount(28000);
    expect(units).toBeGreaterThanOrEqual(50);
    expect(units).toBe(Math.round((28000 / 280) * 100));
  });

  it("TC-ST-03: enforces minimum charge amount", () => {
    expect(toStripeUnitAmount(0)).toBe(50);
  });

  it("TC-ST-04: converts PKR directly when currency is pkr", () => {
    process.env.STRIPE_CURRENCY = "pkr";
    expect(toStripeUnitAmount(1000)).toBe(100000);
  });
});

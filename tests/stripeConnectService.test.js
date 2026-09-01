jest.mock("../models/SellerVerification");
jest.mock("../services/stripeService", () => ({
  getStripe: jest.fn(),
  getCurrency: jest.fn().mockReturnValue("usd"),
  toStripeUnitAmount: jest.fn((pkr) => Math.max(50, Math.round((pkr / 280) * 100))),
}));

const SellerVerification = require("../models/SellerVerification");
const { getStripe } = require("../services/stripeService");
const { transferSellerPayout } = require("../services/stripeConnectService");

describe("Stripe Connect Service — seller payouts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("SC-01: skips transfer when seller not connected", async () => {
    SellerVerification.findOne = jest.fn().mockResolvedValue(null);

    const result = await transferSellerPayout({
      order: { _id: "o1", orderId: "RH-1", type: "sale" },
      sellerId: "seller1",
      amountPkr: 12000,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("seller_not_connected");
    expect(result.demoMode).toBe(true);
  });

  it("SC-02: creates Stripe transfer when seller is connected", async () => {
    SellerVerification.findOne = jest.fn().mockResolvedValue({
      stripeAccountId: "acct_test",
      stripeConnected: true,
      save: jest.fn(),
    });

    const mockRetrieve = jest.fn().mockResolvedValue({
      details_submitted: true,
      payouts_enabled: true,
      charges_enabled: true,
    });
    const mockTransfer = jest.fn().mockResolvedValue({ id: "tr_test123" });
    const mockPiRetrieve = jest.fn().mockResolvedValue({ latest_charge: "ch_test" });

    getStripe.mockReturnValue({
      accounts: { retrieve: mockRetrieve },
      paymentIntents: { retrieve: mockPiRetrieve },
      transfers: { create: mockTransfer },
    });

    const result = await transferSellerPayout({
      order: {
        _id: "o1",
        orderId: "RH-1",
        type: "sale",
        stripePaymentIntentId: "pi_test",
      },
      sellerId: "seller1",
      amountPkr: 12000,
    });

    expect(result.transferId).toBe("tr_test123");
    expect(result.demoMode).toBe(false);
    expect(mockTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "acct_test",
        source_transaction: "ch_test",
      }),
    );
  });
});

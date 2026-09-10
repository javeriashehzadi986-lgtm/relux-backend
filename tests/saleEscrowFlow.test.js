const mongoose = require("mongoose");
const { mockRes, mockReq } = require("./helpers/testUtils");

jest.mock("../models/Order");
jest.mock("../models/Product");
jest.mock("../models/Report");
jest.mock("../models/User");
jest.mock("../services/notificationService", () => ({
  notifySaleEscrowReleased: jest.fn().mockResolvedValue(undefined),
  notifySaleDeliveryDisputed: jest.fn().mockResolvedValue(undefined),
  notifyBuyerConfirmedReceipt: jest.fn().mockResolvedValue(undefined),
  notifyBuyerOrderShipped: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/escrowService", () => {
  const actual = jest.requireActual("../services/escrowService");
  return {
    ...actual,
    releaseSaleEscrow: jest.fn(),
    SALE_AUTO_RELEASE_MS: actual.SALE_AUTO_RELEASE_MS,
  };
});

const Order = require("../models/Order");
const Product = require("../models/Product");
const Report = require("../models/Report");
const User = require("../models/User");
const { releaseSaleEscrow, SALE_AUTO_RELEASE_MS } = require("../services/escrowService");
const { confirmReceivedOrder } = require("../controllers/buyerOrderController");
const { shipOrder } = require("../controllers/sellerOrderController");
const {
  disputeSaleDelivery,
  adminResolveSaleEscrow,
} = require("../controllers/saleEscrowController");

function buildSaleOrder(overrides = {}) {
  const id = new mongoose.Types.ObjectId();
  return {
    _id: id,
    orderId: "RH-SALE001",
    type: "sale",
    status: "approved",
    buyerId: new mongoose.Types.ObjectId(),
    sellerId: new mongoose.Types.ObjectId(),
    productId: new mongoose.Types.ObjectId(),
    paymentStatus: "paid",
    escrowStatus: "held",
    escrowSettlementStatus: "none",
    amountPkr: 12000,
    itemAmountPkr: 12000,
    deliveryChargesPkr: 0,
    fulfillmentStatus: "processing",
    save: jest.fn().mockResolvedValue(undefined),
    toBuyerJSON: jest.fn().mockReturnValue({ id: String(id), escrowStatus: "released" }),
    toSellerJSON: jest.fn().mockReturnValue({ id: String(id) }),
    ...overrides,
  };
}

function mockFindByIdWithSelect(doc) {
  return { select: jest.fn().mockResolvedValue(doc) };
}

describe("Sale Escrow Flow — hold, confirm, dispute, auto-release", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Report.exists = jest.fn().mockResolvedValue(null);
    Report.create = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    User.findById = jest.fn().mockReturnValue(mockFindByIdWithSelect({ name: "Seller One" }));
  });

  it("SE-01: shipping starts the auto-release timer", async () => {
    const order = buildSaleOrder();
    Order.findOne = jest.fn().mockResolvedValue(order);
    Product.findById = jest.fn().mockReturnValue(mockFindByIdWithSelect({ title: "Gown" }));
    Order.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(order),
        }),
      }),
    });

    const req = mockReq({
      user: { _id: order.sellerId, role: "seller" },
      params: { id: String(order._id) },
    });
    const res = mockRes();

    await shipOrder(req, res);

    expect(res.statusCode).toBe(200);
    expect(order.fulfillmentStatus).toBe("shipped");
    expect(order.shippedAt).toBeInstanceOf(Date);
    expect(order.saleEscrowAutoReleaseAt).toBeInstanceOf(Date);
    // ~5 days out
    const days =
      (order.saleEscrowAutoReleaseAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(4.9);
    expect(days).toBeLessThan(5.1);
  });

  it("SE-02: buyer confirm releases sale escrow", async () => {
    const order = buildSaleOrder({ fulfillmentStatus: "shipped" });
    Order.findOne = jest.fn().mockResolvedValue(order);
    Product.findById = jest.fn().mockReturnValue(mockFindByIdWithSelect({ title: "Gown" }));

    const released = { ...order, escrowStatus: "released", sellerPayoutPkr: 12000 };
    releaseSaleEscrow.mockResolvedValue({
      order: released,
      sellerPayoutPkr: 12000,
      refundAmountPkr: 0,
    });

    const req = mockReq({
      user: { _id: order.buyerId, role: "buyer" },
      params: { id: String(order._id) },
    });
    const res = mockRes();

    await confirmReceivedOrder(req, res);

    expect(res.statusCode).toBe(200);
    expect(releaseSaleEscrow).toHaveBeenCalledWith(order, {}, "buyer_confirmed");
    expect(res.body.message).toMatch(/released to seller/i);
  });

  it("SE-03: buyer disputes shipped sale and creates report", async () => {
    const order = buildSaleOrder({ fulfillmentStatus: "shipped" });
    Order.findOne = jest.fn().mockReturnValue({
      populate: jest.fn().mockResolvedValue(order),
    });
    Product.findById = jest.fn().mockReturnValue(mockFindByIdWithSelect({ title: "Gown" }));

    const req = mockReq({
      user: { _id: order.buyerId, role: "buyer", name: "Buyer One" },
      params: { id: String(order._id) },
      body: { disputeReason: "Wrong dress delivered" },
    });
    const res = mockRes();

    await disputeSaleDelivery(req, res);

    expect(res.statusCode).toBe(200);
    expect(order.escrowSettlementStatus).toBe("disputed");
    expect(Report.create).toHaveBeenCalled();
  });

  it("SE-04: admin resolves disputed sale escrow", async () => {
    const order = buildSaleOrder({
      fulfillmentStatus: "shipped",
      escrowSettlementStatus: "disputed",
      disputeReportId: new mongoose.Types.ObjectId(),
    });
    Order.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockResolvedValue(order),
    });
    Report.findById = jest.fn().mockResolvedValue({
      status: "open",
      save: jest.fn(),
    });

    const released = { ...order, escrowStatus: "released", refundAmountPkr: 12000 };
    releaseSaleEscrow.mockResolvedValue({
      order: released,
      sellerPayoutPkr: 0,
      refundAmountPkr: 12000,
    });

    const req = mockReq({
      user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
      params: { id: String(order._id) },
      body: {
        sellerPayoutPkr: 0,
        refundAmountPkr: 12000,
        decision: "Full refund — item not delivered",
      },
    });
    const res = mockRes();

    await adminResolveSaleEscrow(req, res);

    expect(res.statusCode).toBe(200);
    expect(releaseSaleEscrow).toHaveBeenCalledWith(
      order,
      expect.objectContaining({ sellerPayoutPkr: 0, refundAmountPkr: 12000 }),
      "admin_settled",
    );
  });

  it("SE-05: calculateSaleEscrow splits seller payout and refund", () => {
    const { calculateSaleEscrow } = require("../services/escrowService");
    const order = buildSaleOrder();
    const breakdown = calculateSaleEscrow(order, { sellerPayoutPkr: 8000, refundAmountPkr: 4000 });
    expect(breakdown.sellerPayoutPkr).toBe(8000);
    expect(breakdown.refundAmountPkr).toBe(4000);
    expect(breakdown.exceedsTotal).toBe(false);
  });

  it("SE-05b: default sale release pays seller full bid amount, no refund", () => {
    const { calculateSaleEscrow } = require("../services/escrowService");
    const order = buildSaleOrder();
    const breakdown = calculateSaleEscrow(order);
    expect(breakdown.sellerPayoutPkr).toBe(12000);
    expect(breakdown.refundAmountPkr).toBe(0);
  });

  it("SE-06: auto-release window is 5 days", () => {
    expect(SALE_AUTO_RELEASE_MS).toBe(5 * 24 * 60 * 60 * 1000);
  });
});

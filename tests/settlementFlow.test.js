const mongoose = require("mongoose");
const { mockRes, mockReq } = require("./helpers/testUtils");

jest.mock("../models/Order");
jest.mock("../models/Product");
jest.mock("../models/Report");
jest.mock("../models/User");
jest.mock("../services/notificationService", () => ({
  notifyEscrowReleased: jest.fn().mockResolvedValue(undefined),
  notifySettlementProposed: jest.fn().mockResolvedValue(undefined),
  notifySettlementAccepted: jest.fn().mockResolvedValue(undefined),
  notifySettlementDisputed: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/escrowService", () => {
  const actual = jest.requireActual("../services/escrowService");
  return {
    ...actual,
    releaseRentalEscrow: jest.fn(),
  };
});

const Order = require("../models/Order");
const Product = require("../models/Product");
const Report = require("../models/Report");
const User = require("../models/User");
const { releaseRentalEscrow } = require("../services/escrowService");
const {
  proposeSettlement,
  acceptSettlement,
  disputeSettlement,
  adminResolveSettlement,
  getSettlement,
} = require("../controllers/settlementController");

function buildRentalOrder(overrides = {}) {
  const id = new mongoose.Types.ObjectId();
  const productId = {
    _id: new mongoose.Types.ObjectId(),
    title: "Silk Bridal Dress",
    itemPrice: 50000,
    rentPrice: 5000,
  };

  return {
    _id: id,
    orderId: "RH-TEST001",
    type: "rental",
    status: "approved",
    buyerId: new mongoose.Types.ObjectId(),
    sellerId: new mongoose.Types.ObjectId(),
    productId,
    paymentStatus: "paid",
    escrowStatus: "held",
    escrowSettlementStatus: "none",
    amountPkr: 50000,
    rentalDays: 3,
    fulfillmentStatus: "returned",
    damageDeductionPkr: 0,
    lateFeePkr: 0,
    rentalChargePkr: 0,
    refundAmountPkr: 0,
    sellerPayoutPkr: 0,
    settlementNote: "",
    settlementEvidence: [],
    save: jest.fn().mockResolvedValue(undefined),
    toSellerJSON: jest.fn().mockReturnValue({ id: String(id), escrowSettlementStatus: "proposed" }),
    toBuyerJSON: jest.fn().mockReturnValue({ id: String(id), escrowSettlementStatus: "accepted" }),
    ...overrides,
  };
}

function mockFindOneWithPopulate(order) {
  return {
    populate: jest.fn().mockResolvedValue(order),
  };
}

function mockFindByIdWithPopulate(order) {
  return {
    populate: jest.fn().mockResolvedValue(order),
  };
}

function mockFindByIdWithSelect(doc) {
  return {
    select: jest.fn().mockResolvedValue(doc),
  };
}

describe("Settlement Flow — propose, accept, dispute, admin resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Report.exists = jest.fn().mockResolvedValue(null);
    Report.create = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId() });
    User.findById = jest.fn().mockReturnValue(mockFindByIdWithSelect({ name: "Seller One" }));
  });

  it("SF-01: seller propose settlement endpoint is retired", async () => {
    const order = buildRentalOrder();
    const req = mockReq({
      user: { _id: order.sellerId, role: "seller" },
      params: { id: String(order._id) },
      body: { damageDeductionPkr: 3000 },
    });
    const res = mockRes();

    await proposeSettlement(req, res);

    expect(res.statusCode).toBe(410);
    expect(res.body.message).toMatch(/no longer used/i);
  });

  it("SF-02: buyer accept settlement endpoint is retired", async () => {
    const order = buildRentalOrder({ escrowSettlementStatus: "proposed" });
    const req = mockReq({
      user: { _id: order.buyerId, role: "buyer" },
      params: { id: String(order._id) },
    });
    const res = mockRes();

    await acceptSettlement(req, res);

    expect(res.statusCode).toBe(410);
  });

  it("SF-03: buyer dispute settlement endpoint is retired", async () => {
    const order = buildRentalOrder({ escrowSettlementStatus: "proposed" });
    const req = mockReq({
      user: { _id: order.buyerId, role: "buyer" },
      params: { id: String(order._id) },
      body: { disputeReason: "too high" },
    });
    const res = mockRes();

    await disputeSettlement(req, res);

    expect(res.statusCode).toBe(410);
  });

  it("SF-05: admin resolves disputed settlement with manual payout split", async () => {
    const order = buildRentalOrder({
      escrowSettlementStatus: "disputed",
      deliveryConfirmedAt: new Date(),
      returnConfirmedAt: new Date(),
      disputeReportId: new mongoose.Types.ObjectId(),
      itemAmountPkr: 50000,
      deliveryChargesPkr: 0,
    });
    Order.findById = jest.fn().mockReturnValue(mockFindByIdWithPopulate(order));
    Report.findById = jest.fn().mockResolvedValue({
      status: "open",
      disputeStage: "none",
      save: jest.fn(),
    });

    const releasedOrder = {
      ...order,
      escrowStatus: "released",
      escrowSettlementStatus: "admin_settled",
      refundAmountPkr: 35000,
      sellerPayoutPkr: 15000,
      damageDeductionPkr: 0,
      rentalChargePkr: 0,
      toSellerJSON: jest.fn().mockReturnValue({ id: String(order._id) }),
    };
    releaseRentalEscrow.mockResolvedValue({
      order: releasedOrder,
      refundAmountPkr: 35000,
      rentalChargePkr: 0,
      damageDeductionPkr: 0,
      sellerPayoutPkr: 15000,
      stripeTransferId: "tr_test",
    });

    const req = mockReq({
      user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
      params: { id: String(order._id) },
      body: {
        sellerPayoutPkr: 15000,
        refundAmountPkr: 35000,
        decision: "Admin split: PKR 15,000 to seller, PKR 35,000 refunded to buyer",
      },
    });
    const res = mockRes();

    await adminResolveSettlement(req, res);

    expect(res.statusCode).toBe(200);
    expect(order.escrowSettlementStatus).toBe("admin_settled");
    expect(releaseRentalEscrow).toHaveBeenCalledWith(
      order,
      expect.objectContaining({
        sellerPayoutPkr: 15000,
        refundAmountPkr: 35000,
      }),
    );
    expect(res.body.message).toMatch(/admin settlement/i);
  });

  it("SF-06: getSettlement returns breakdown for buyer", async () => {
    const order = buildRentalOrder({
      escrowSettlementStatus: "proposed",
      rentalChargePkr: 15000,
      damageDeductionPkr: 3000,
      refundAmountPkr: 32000,
      sellerPayoutPkr: 18000,
    });
    Order.findById = jest.fn().mockReturnValue(mockFindByIdWithPopulate(order));

    const req = mockReq({
      user: { _id: order.buyerId, role: "buyer" },
      params: { id: String(order._id) },
    });
    const res = mockRes();

    await getSettlement(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.settlement.depositPkr).toBe(50000);
    expect(res.body.settlement.rentalChargePkr).toBe(15000);
    expect(res.body.settlement.refundAmountPkr).toBe(32000);
    expect(res.body.settlement.escrowSettlementStatus).toBe("proposed");
  });
});

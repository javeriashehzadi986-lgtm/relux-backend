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

  it("SF-01: seller proposes settlement with rent and damage", async () => {
    const order = buildRentalOrder();
    Order.findOne = jest.fn().mockReturnValue(mockFindOneWithPopulate(order));

    const req = mockReq({
      user: { _id: order.sellerId, role: "seller" },
      params: { id: String(order._id) },
      body: { damageDeductionPkr: 3000, settlementNote: "Minor stain on hem" },
    });
    const res = mockRes();

    await proposeSettlement(req, res);

    expect(res.statusCode).toBe(200);
    expect(order.escrowSettlementStatus).toBe("proposed");
    expect(order.damageDeductionPkr).toBe(3000);
    expect(order.rentalChargePkr).toBe(15000);
    expect(order.refundAmountPkr).toBe(32000);
    expect(order.sellerPayoutPkr).toBe(18000);
    expect(order.save).toHaveBeenCalled();
  });

  it("SF-02: rejects proposal when damage exceeds deposit cap", async () => {
    const order = buildRentalOrder();
    Order.findOne = jest.fn().mockReturnValue(mockFindOneWithPopulate(order));

    const req = mockReq({
      user: { _id: order.sellerId, role: "seller" },
      params: { id: String(order._id) },
      body: { damageDeductionPkr: 50000 },
    });
    const res = mockRes();

    await proposeSettlement(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/cannot exceed the security deposit/i);
  });

  it("SF-03: buyer accepts proposed settlement and releases escrow", async () => {
    const order = buildRentalOrder({
      escrowSettlementStatus: "proposed",
      rentalChargePkr: 15000,
      damageDeductionPkr: 3000,
      refundAmountPkr: 32000,
      sellerPayoutPkr: 18000,
    });
    Order.findOne = jest.fn().mockReturnValue(mockFindOneWithPopulate(order));

    const releasedOrder = { ...order, escrowStatus: "released", escrowSettlementStatus: "accepted" };
    releaseRentalEscrow.mockResolvedValue({
      order: releasedOrder,
      refundAmountPkr: 32000,
      rentalChargePkr: 15000,
      damageDeductionPkr: 3000,
      sellerPayoutPkr: 18000,
      stripeRefundId: "",
      demoMode: true,
    });

    const req = mockReq({
      user: { _id: order.buyerId, role: "buyer" },
      params: { id: String(order._id) },
    });
    const res = mockRes();

    await acceptSettlement(req, res);

    expect(res.statusCode).toBe(200);
    expect(order.escrowSettlementStatus).toBe("accepted");
    expect(releaseRentalEscrow).toHaveBeenCalledWith(order);
    expect(res.body.escrow.refundAmountPkr).toBe(32000);
    expect(res.body.escrow.sellerPayoutPkr).toBe(18000);
  });

  it("SF-04: buyer disputes settlement and creates linked report", async () => {
    const order = buildRentalOrder({
      escrowSettlementStatus: "proposed",
      rentalChargePkr: 15000,
      damageDeductionPkr: 8000,
      refundAmountPkr: 27000,
      sellerPayoutPkr: 23000,
    });
    Order.findOne = jest.fn().mockReturnValue(mockFindOneWithPopulate(order));
    Product.findById = jest.fn().mockReturnValue(mockFindByIdWithSelect(order.productId));

    const req = mockReq({
      user: { _id: order.buyerId, role: "buyer", name: "Buyer One" },
      params: { id: String(order._id) },
      body: { disputeReason: "Damage charge is too high for a minor mark" },
    });
    const res = mockRes();

    await disputeSettlement(req, res);

    expect(res.statusCode).toBe(200);
    expect(order.escrowSettlementStatus).toBe("disputed");
    expect(Report.create).toHaveBeenCalled();
    expect(order.disputeReason).toMatch(/too high/i);
  });

  it("SF-05: admin resolves disputed settlement and releases escrow", async () => {
    const order = buildRentalOrder({
      escrowSettlementStatus: "disputed",
      rentalChargePkr: 15000,
      damageDeductionPkr: 8000,
      disputeReportId: new mongoose.Types.ObjectId(),
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
    };
    releaseRentalEscrow.mockResolvedValue({
      order: releasedOrder,
      refundAmountPkr: 35000,
      rentalChargePkr: 15000,
      damageDeductionPkr: 0,
      sellerPayoutPkr: 15000,
    });

    const req = mockReq({
      user: { _id: new mongoose.Types.ObjectId(), role: "admin" },
      params: { id: String(order._id) },
      body: {
        rentalChargePkr: 15000,
        damageDeductionPkr: 0,
        decision: "Admin reduced damage to zero after review",
      },
    });
    const res = mockRes();

    await adminResolveSettlement(req, res);

    expect(res.statusCode).toBe(200);
    expect(order.escrowSettlementStatus).toBe("admin_settled");
    expect(releaseRentalEscrow).toHaveBeenCalled();
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

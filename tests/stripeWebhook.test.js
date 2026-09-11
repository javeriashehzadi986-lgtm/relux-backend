/**
 * Stripe webhook — event handling, idempotency, and retry semantics.
 */
const { mockReq, mockRes } = require("./helpers/testUtils");

jest.mock("../models/Order");
jest.mock("../models/Product");
jest.mock("../models/User");
jest.mock("../models/WebhookEvent");
jest.mock("../services/notificationService");
jest.mock("../services/orderSocketService");
jest.mock("../services/stripeService");
jest.mock("../services/orderStatusService", () => ({
  syncProductForOrder: jest.fn(),
}));

const Order = require("../models/Order");
const Product = require("../models/Product");
const WebhookEvent = require("../models/WebhookEvent");
const { syncProductForOrder } = require("../services/orderStatusService");
const {
  notifyPaymentFailed,
  notifyOrderRefunded,
  notifySellerOrderRefunded,
} = require("../services/notificationService");
const { emitOrderUpdated } = require("../services/orderSocketService");
const { handleStripeWebhook } = require("../controllers/paymentController");

function buildOrderDoc(overrides = {}) {
  return {
    _id: "order1",
    orderId: "RH-TEST1",
    buyerId: "buyer1",
    sellerId: "seller1",
    productId: "prod1",
    type: "sale",
    status: "pending",
    paymentStatus: "pending",
    escrowStatus: "none",
    amountPkr: 5000,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function webhookReq(body) {
  return mockReq({ body, headers: {} });
}

describe("Stripe webhook — event handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STRIPE_WEBHOOK_SECRET;
    WebhookEvent.create = jest.fn().mockResolvedValue({});
    WebhookEvent.deleteOne = jest.fn().mockResolvedValue({});
    Product.findById = jest.fn().mockResolvedValue({ title: "Test Dress" });
  });

  it("skips reprocessing a Stripe event id that was already recorded (duplicate delivery)", async () => {
    WebhookEvent.create.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000 }));
    const res = mockRes();

    await handleStripeWebhook(
      webhookReq({ id: "evt_1", type: "checkout.session.completed", data: { object: {} } }),
      res,
    );

    expect(res.body).toEqual({ received: true, duplicate: true });
    expect(Order.findOne).not.toHaveBeenCalled();
  });

  it("marks the order failed and notifies the buyer on payment_intent.payment_failed", async () => {
    const order = buildOrderDoc();
    Order.findById = jest.fn().mockResolvedValue(order);
    const res = mockRes();

    await handleStripeWebhook(
      webhookReq({
        id: "evt_2",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_1",
            metadata: { orderId: "order1" },
            last_payment_error: { message: "Your card was declined." },
          },
        },
      }),
      res,
    );

    expect(order.paymentStatus).toBe("failed");
    expect(order.paymentFailureReason).toBe("Your card was declined.");
    expect(order.save).toHaveBeenCalled();
    expect(notifyPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ buyerId: "buyer1", reason: "Your card was declined." }),
    );
    expect(res.body).toEqual({ received: true });
  });

  it("does not downgrade an already-paid order on a stale payment_intent.payment_failed event", async () => {
    const order = buildOrderDoc({ paymentStatus: "paid" });
    Order.findById = jest.fn().mockResolvedValue(order);

    await handleStripeWebhook(
      webhookReq({
        id: "evt_3",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_1", metadata: { orderId: "order1" } } },
      }),
      mockRes(),
    );

    expect(order.save).not.toHaveBeenCalled();
    expect(notifyPaymentFailed).not.toHaveBeenCalled();
  });

  it("marks the order expired on checkout.session.expired", async () => {
    const order = buildOrderDoc();
    Order.findById = jest.fn().mockResolvedValue(order);
    const res = mockRes();

    await handleStripeWebhook(
      webhookReq({
        id: "evt_4",
        type: "checkout.session.expired",
        data: { object: { id: "cs_1", metadata: { orderId: "order1" } } },
      }),
      res,
    );

    expect(order.paymentStatus).toBe("expired");
    expect(order.save).toHaveBeenCalled();
    expect(emitOrderUpdated).toHaveBeenCalledWith(order);
  });

  it("fully refunds, cancels, and releases the product on a full charge.refunded event", async () => {
    const order = buildOrderDoc({ status: "approved", paymentStatus: "paid", escrowStatus: "held" });
    Order.findOne = jest.fn().mockResolvedValue(order);
    const res = mockRes();

    await handleStripeWebhook(
      webhookReq({
        id: "evt_5",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_1",
            payment_intent: "pi_9",
            amount: 5000,
            amount_refunded: 5000,
            refunds: { data: [{ id: "re_1" }] },
          },
        },
      }),
      res,
    );

    expect(order.paymentStatus).toBe("refunded");
    expect(order.status).toBe("cancelled");
    expect(order.escrowStatus).toBe("released");
    expect(order.stripeRefundId).toBe("re_1");
    expect(syncProductForOrder).toHaveBeenCalledWith(order);
    expect(notifyOrderRefunded).toHaveBeenCalled();
    expect(notifySellerOrderRefunded).toHaveBeenCalled();
  });

  it("leaves the order untouched on a partial charge.refunded event", async () => {
    const order = buildOrderDoc({ paymentStatus: "paid" });
    Order.findOne = jest.fn().mockResolvedValue(order);

    await handleStripeWebhook(
      webhookReq({
        id: "evt_6",
        type: "charge.refunded",
        data: {
          object: { id: "ch_2", payment_intent: "pi_9", amount: 5000, amount_refunded: 2000 },
        },
      }),
      mockRes(),
    );

    expect(order.save).not.toHaveBeenCalled();
    expect(notifyOrderRefunded).not.toHaveBeenCalled();
  });

  it("is idempotent for a refund already applied by the admin settlement flow", async () => {
    const order = buildOrderDoc({ paymentStatus: "refunded" });
    Order.findOne = jest.fn().mockResolvedValue(order);

    await handleStripeWebhook(
      webhookReq({
        id: "evt_7",
        type: "charge.refunded",
        data: { object: { id: "ch_3", payment_intent: "pi_9", amount: 5000, amount_refunded: 5000 } },
      }),
      mockRes(),
    );

    expect(order.save).not.toHaveBeenCalled();
  });

  it("acknowledges unhandled event types without touching any order", async () => {
    const res = mockRes();

    await handleStripeWebhook(
      webhookReq({ id: "evt_8", type: "customer.created", data: { object: {} } }),
      res,
    );

    expect(res.body).toEqual({ received: true });
    expect(Order.findOne).not.toHaveBeenCalled();
    expect(Order.findById).not.toHaveBeenCalled();
  });

  it("removes the event log entry and returns 500 so Stripe retries when processing throws", async () => {
    Order.findById = jest.fn().mockRejectedValue(new Error("DB down"));
    const res = mockRes();

    await handleStripeWebhook(
      webhookReq({
        id: "evt_9",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_1", metadata: { orderId: "order1" } } },
      }),
      res,
    );

    expect(res.statusCode).toBe(500);
    expect(WebhookEvent.deleteOne).toHaveBeenCalledWith({ stripeEventId: "evt_9" });
  });
});

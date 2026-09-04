const {
  FULFILLMENT,
  getFulfillmentLabel,
  getFulfillmentVariant,
  isRentalPeriodComplete,
  getReturnAvailableLabel,
  ensurePaid,
  syncProductForOrder,
  finalizeOrderAfterEscrowRelease,
  getPaymentLabel,
  syncPaymentStatusAfterEscrowRelease,
  buildOrderLogistics,
} = require("../services/orderStatusService");

describe("Order Status Service — Chapter 5: Order Fulfillment", () => {
  describe("getFulfillmentLabel", () => {
    it("TC-OS-01: returns Awaiting Approval for pending rental", () => {
      const label = getFulfillmentLabel({
        status: "pending",
        type: "rental",
        paymentStatus: "unpaid",
      });
      expect(label).toBe("Awaiting Approval");
    });

    it("TC-OS-02: returns Received by Buyer when rental is delivered", () => {
      const label = getFulfillmentLabel({
        status: "approved",
        type: "rental",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.DELIVERED,
      });
      expect(label).toBe("Received by Buyer");
    });

    it("TC-OS-03: returns Returned by Buyer after buyer marks return", () => {
      const label = getFulfillmentLabel({
        status: "approved",
        type: "rental",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.RETURNED,
      });
      expect(label).toBe("Returned by Buyer");
    });

    it("TC-OS-04: returns Rental Completed when order completed", () => {
      const label = getFulfillmentLabel({
        status: "completed",
        type: "rental",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.RETURNED,
      });
      expect(label).toBe("Rental Completed");
    });
  });

  describe("isRentalPeriodComplete", () => {
    it("TC-OS-05: return button unavailable before rent end", () => {
      const future = new Date();
      future.setDate(future.getDate() + 5);
      const rentEnd = future.toISOString().slice(0, 10);
      expect(isRentalPeriodComplete(rentEnd)).toBe(false);
    });

    it("TC-OS-06: return available after rent end date", () => {
      const past = new Date();
      past.setDate(past.getDate() - 3);
      const rentEnd = past.toISOString().slice(0, 10);
      expect(isRentalPeriodComplete(rentEnd)).toBe(true);
    });

    it("TC-OS-06b: return available on rent end date", () => {
      const today = new Date();
      const rentEnd = today.toISOString().slice(0, 10);
      expect(isRentalPeriodComplete(rentEnd)).toBe(true);
    });
  });

  describe("getReturnAvailableLabel", () => {
    it("TC-OS-07: shows available-from date on rental end day", () => {
      const label = getReturnAvailableLabel("2026-01-03");
      expect(label).toMatch(/Available from/);
      expect(label).toMatch(/Jan/);
      expect(label).toMatch(/3/);
    });
  });

  describe("ensurePaid", () => {
    it("TC-OS-08: blocks fulfillment update when unpaid", () => {
      expect(() => ensurePaid({ paymentStatus: "pending" })).toThrow(
        /Payment must be completed/,
      );
    });

    it("TC-OS-09: allows fulfillment update when paid", () => {
      expect(() => ensurePaid({ paymentStatus: "paid" })).not.toThrow();
    });
  });

  describe("getFulfillmentVariant", () => {
    it("TC-OS-10: maps shipped status to shipped variant", () => {
      const variant = getFulfillmentVariant({
        status: "approved",
        fulfillmentStatus: FULFILLMENT.SHIPPED,
      });
      expect(variant).toBe("shipped");
    });
  });

  describe("syncProductForOrder", () => {
    it("TC-OS-11: marks product rented when rental is paid and approved", async () => {
      const save = jest.fn();
      const product = { status: "active", save };
      const Product = require("../models/Product");
      jest.spyOn(Product, "findById").mockResolvedValue(product);

      const order = {
        productId: "prod1",
        status: "approved",
        paymentStatus: "paid",
        type: "rental",
      };

      const result = await syncProductForOrder(order);
      expect(result.status).toBe("rented");
      expect(save).toHaveBeenCalled();
      Product.findById.mockRestore();
    });

    it("TC-OS-14: restores listing after completed sale with full refund", async () => {
      const save = jest.fn();
      const product = { status: "sold", isAvailable: false, save };
      const Product = require("../models/Product");
      const Order = require("../models/Order");
      jest.spyOn(Product, "findById").mockResolvedValue(product);
      jest.spyOn(Order, "findOne").mockResolvedValue(null);

      const order = {
        _id: "ord1",
        productId: "prod1",
        status: "completed",
        paymentStatus: "refunded",
        escrowStatus: "released",
        type: "sale",
      };

      const result = await syncProductForOrder(order);
      expect(result.status).toBe("active");
      expect(result.isAvailable).toBe(true);
      expect(save).toHaveBeenCalled();

      Product.findById.mockRestore();
      Order.findOne.mockRestore();
    });
  });

  describe("finalizeOrderAfterEscrowRelease", () => {
    it("TC-OS-15: completes rental and restores listing after escrow release", async () => {
      const save = jest.fn().mockResolvedValue(undefined);
      const product = { status: "rented", isAvailable: false, save };
      const Product = require("../models/Product");
      const Order = require("../models/Order");
      jest.spyOn(Product, "findById").mockResolvedValue(product);
      jest.spyOn(Order, "findOne").mockResolvedValue(null);

      const order = {
        _id: "ord1",
        productId: "prod1",
        type: "rental",
        status: "approved",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.DELIVERED,
        escrowStatus: "released",
        save,
      };

      const { finalizeOrderAfterEscrowRelease } = require("../services/orderStatusService");
      await finalizeOrderAfterEscrowRelease(order);

      expect(order.status).toBe("completed");
      expect(order.fulfillmentStatus).toBe(FULFILLMENT.RETURNED);
      expect(product.status).toBe("active");
      expect(save).toHaveBeenCalled();

      Product.findById.mockRestore();
      Order.findOne.mockRestore();
    });
  });

  describe("getPaymentLabel", () => {
    it("TC-OS-16: shows held in escrow while disputed", () => {
      const label = getPaymentLabel({
        paymentStatus: "paid",
        escrowStatus: "held",
        escrowSettlementStatus: "disputed",
      });
      expect(label).toBe("Paid — held (dispute under review)");
    });

    it("TC-OS-17: shows settled refund after escrow release", () => {
      const label = getPaymentLabel({
        paymentStatus: "paid",
        escrowStatus: "released",
        refundAmountPkr: 5000,
        sellerPayoutPkr: 0,
      });
      expect(label).toContain("Settled");
      expect(label).toContain("5,000");
    });

    it("TC-OS-18: shows refunded when payment status is refunded", () => {
      const label = getPaymentLabel({
        paymentStatus: "refunded",
        refundAmountPkr: 12000,
        escrowStatus: "released",
      });
      expect(label).toContain("Refunded");
    });
  });

  describe("syncPaymentStatusAfterEscrowRelease", () => {
    it("TC-OS-19: marks payment refunded after full buyer refund", () => {
      const order = {
        type: "sale",
        amountPkr: 10000,
        refundAmountPkr: 10000,
        escrowStatus: "released",
        paymentStatus: "paid",
      };
      syncPaymentStatusAfterEscrowRelease(order);
      expect(order.paymentStatus).toBe("refunded");
      expect(order.refundedAt).toBeInstanceOf(Date);
    });
  });

  describe("buildOrderLogistics", () => {
    it("TC-OS-12: includes shipped and delivered steps for a shipped sale", () => {
      const steps = buildOrderLogistics({
        type: "sale",
        status: "approved",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.SHIPPED,
        createdAt: new Date("2026-01-01"),
        paidAt: new Date("2026-01-02"),
        shippedAt: new Date("2026-01-03"),
      });

      const labels = steps.map((step) => step.label);
      expect(labels).toContain("Order placed");
      expect(labels).toContain("Payment confirmed");
      expect(labels).toContain("Shipped to buyer");
      expect(steps.find((step) => step.key === "shipped")?.active).toBe(true);
    });

    it("TC-OS-13: includes return step after buyer marks rental returned", () => {
      const steps = buildOrderLogistics({
        type: "rental",
        status: "approved",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.RETURNED,
        createdAt: new Date("2026-01-01"),
        paidAt: new Date("2026-01-02"),
        shippedAt: new Date("2026-01-03"),
        deliveryConfirmedAt: new Date("2026-01-04"),
        returnConfirmedAt: new Date("2026-01-10"),
      });

      const labels = steps.map((step) => step.label);
      expect(labels).toContain("Returned by buyer");
      expect(steps.find((step) => step.key === "returned")?.completed).toBe(true);
    });
  });
});

const {
  FULFILLMENT,
  getFulfillmentLabel,
  getFulfillmentVariant,
  isRentalPeriodComplete,
  getReturnAvailableLabel,
  ensurePaid,
  syncProductForOrder,
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
  });

  describe("getReturnAvailableLabel", () => {
    it("TC-OS-07: shows available-from date after rental ends", () => {
      const label = getReturnAvailableLabel("2026-01-03");
      expect(label).toMatch(/Available from/);
      expect(label).toMatch(/Jan/);
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
  });
});

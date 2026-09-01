const mongoose = require("mongoose");
const {
  parseAmount,
  calculateRentalEscrow,
  getEscrowLabel,
  formatPkr,
  releaseRentalEscrow,
} = require("../services/escrowService");

jest.mock("../models/SellerVerification", () => ({
  findOne: jest.fn().mockResolvedValue(null),
}));
describe("Escrow Service — Chapter 5: Rental Payment Hold & Release", () => {
  describe("parseAmount", () => {
    it("TC-ES-01: parses PKR formatted strings", () => {
      expect(parseAmount("PKR 50,000")).toBe(50000);
      expect(parseAmount("2500")).toBe(2500);
      expect(parseAmount("Rs 15000")).toBe(15000);
    });
  });

  describe("calculateRentalEscrow", () => {
    it("TC-ES-02: deducts rental charges from deposit refund", () => {
      const result = calculateRentalEscrow(
        { amountPkr: 50000, rentalDays: 3 },
        { itemPrice: "50000", rentPrice: "2000" },
      );
      expect(result.depositPkr).toBe(50000);
      expect(result.rentalChargePkr).toBe(6000);
      expect(result.refundAmountPkr).toBe(44000);
    });

    it("TC-ES-03: refund is zero when rental exceeds deposit", () => {
      const result = calculateRentalEscrow(
        { amountPkr: 5000, rentalDays: 10 },
        { rentPrice: "2000" },
      );
      expect(result.refundAmountPkr).toBe(0);
      expect(result.sellerPayoutPkr).toBe(5000);
      expect(result.additionalChargePkr).toBe(15000);
    });

    it("TC-ES-03b: includes damage in total deductions", () => {
      const result = calculateRentalEscrow(
        { amountPkr: 50000, rentalDays: 3 },
        { rentPrice: "2000" },
        { damageDeductionPkr: 5000 },
      );
      expect(result.rentalChargePkr).toBe(6000);
      expect(result.damageDeductionPkr).toBe(5000);
      expect(result.refundAmountPkr).toBe(39000);
      expect(result.sellerPayoutPkr).toBe(11000);
    });
  });

  describe("getEscrowLabel", () => {
    it("TC-ES-04: shows held label for paid rental deposit", () => {
      const label = getEscrowLabel({
        type: "rental",
        escrowStatus: "held",
        amountPkr: 50000,
      });
      expect(label).toContain("held in escrow");
      expect(label).toContain("50,000");
    });

    it("TC-ES-05: shows refund label after escrow release", () => {
      const label = getEscrowLabel({
        type: "rental",
        escrowStatus: "released",
        refundAmountPkr: 44000,
      });
      expect(label).toContain("refunded");
    });
  });

  describe("formatPkr", () => {
    it("TC-ES-06: formats amounts in PKR", () => {
      expect(formatPkr(44000)).toBe("PKR 44,000");
    });
  });

  describe("releaseRentalEscrow", () => {
    it("TC-ES-07: rejects release for non-rental orders", async () => {
      await expect(
        releaseRentalEscrow({ type: "sale", paymentStatus: "paid" }),
      ).rejects.toThrow(/Escrow release only applies to rental/);
    });

    it("TC-ES-08: rejects release when deposit unpaid", async () => {
      await expect(
        releaseRentalEscrow({
          type: "rental",
          paymentStatus: "pending",
          escrowStatus: "held",
        }),
      ).rejects.toThrow(/must be paid/);
    });

    it("TC-ES-09: releases escrow in demo mode without Stripe PI", async () => {
      const save = jest.fn();
      const order = {
        _id: "order1",
        sellerId: new mongoose.Types.ObjectId(),
        type: "rental",
        paymentStatus: "paid",
        escrowStatus: "held",
        escrowSettlementStatus: "accepted",
        amountPkr: 50000,
        rentalDays: 3,
        productId: { itemPrice: 50000, rentPrice: 2000 },
        save,
      };

      const result = await releaseRentalEscrow(order);
      expect(result.demoMode).toBe(true);
      expect(result.refundAmountPkr).toBe(44000);
      expect(order.escrowStatus).toBe("released");
      expect(save).toHaveBeenCalled();
    });

    it("TC-ES-09b: blocks release before buyer accepts settlement", async () => {
      await expect(
        releaseRentalEscrow({
          type: "rental",
          paymentStatus: "paid",
          escrowStatus: "held",
          escrowSettlementStatus: "proposed",
          amountPkr: 50000,
          rentalDays: 3,
          productId: { itemPrice: 50000, rentPrice: 2000 },
          save: jest.fn(),
        }),
      ).rejects.toThrow(/buyer accepts or admin resolves/);
    });

    it("TC-ES-10: skips duplicate release when already released", async () => {
      const order = {
        type: "rental",
        paymentStatus: "paid",
        escrowStatus: "released",
        amountPkr: 50000,
        rentalDays: 3,
      };
      const result = await releaseRentalEscrow(order);
      expect(result.alreadyReleased).toBe(true);
    });
  });
});

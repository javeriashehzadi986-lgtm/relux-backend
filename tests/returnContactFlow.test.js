const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
const { buildReturnInstructionsDetails } = require("../services/emailService");
const { shipOrder } = require("../controllers/sellerOrderController");
const { FULFILLMENT } = require("../services/orderStatusService");
const { mockReq, mockRes } = require("./helpers/testUtils");

describe("Return contact flow", () => {
  describe("buildReturnInstructionsDetails", () => {
    it("RC-01: includes full seller return contact for rental", () => {
      const details = buildReturnInstructionsDetails(
        {
          _id: "abc",
          orderId: "RH-RET001",
          type: "rental",
          size: "M",
          rentStart: "2026-03-01",
          rentEnd: "2026-03-03",
          rentalDays: 3,
          sellerReturnContact: {
            name: "Ayesha Seller",
            email: "ayesha@example.com",
            phone: "03001234567",
            address: "House 10, Gulberg",
            city: "Lahore",
          },
        },
        { title: "Velvet Lehenga" },
      );

      expect(details.sellerName).toBe("Ayesha Seller");
      expect(details.sellerEmail).toBe("ayesha@example.com");
      expect(details.sellerPhone).toBe("03001234567");
      expect(details.address).toBe("House 10, Gulberg");
      expect(details.city).toBe("Lahore");
      expect(details.productTitle).toBe("Velvet Lehenga");
    });
  });

  describe("User return contact helpers", () => {
    it("RC-02: builds snapshot from dedicated return fields", () => {
      const user = new User({
        name: "Zara",
        email: "zara@example.com",
        password: "secret12",
        returnContactName: "Zara Returns",
        returnPhone: "03009998877",
        returnCity: "Karachi",
        returnAddress: "Clifton Block 5",
      });

      expect(user.getReturnContactSnapshot()).toEqual({
        name: "Zara Returns",
        phone: "03009998877",
        city: "Karachi",
        address: "Clifton Block 5",
        email: "zara@example.com",
      });
      expect(user.hasCompleteReturnContact()).toBe(true);
    });

    it("RC-03: falls back to personal fields when return fields empty", () => {
      const user = new User({
        name: "Sana",
        email: "sana@example.com",
        password: "secret12",
        phone: "03001112222",
        city: "Islamabad",
        returnAddress: "F-7 Markaz",
      });

      const snapshot = user.getReturnContactSnapshot();
      expect(snapshot.name).toBe("Sana");
      expect(snapshot.phone).toBe("03001112222");
      expect(snapshot.city).toBe("Islamabad");
      expect(snapshot.address).toBe("F-7 Markaz");
    });
  });

  describe("Order.toBuyerJSON sellerReturnContact", () => {
    it("RC-04: exposes seller return contact for delivered paid rentals", () => {
      const order = new Order({
        buyerId: new mongoose.Types.ObjectId(),
        sellerId: new mongoose.Types.ObjectId(),
        productId: new mongoose.Types.ObjectId(),
        type: "rental",
        status: "approved",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.DELIVERED,
        rentStart: "2026-03-01",
        rentEnd: "2026-03-05",
        rentalDays: 5,
        sellerReturnContact: {
          name: "Seller One",
          phone: "03001234567",
          email: "seller@example.com",
          address: "12 Mall Road",
          city: "Lahore",
        },
      });

      const json = order.toBuyerJSON();
      expect(json.sellerReturnContact).toEqual({
        name: "Seller One",
        phone: "03001234567",
        email: "seller@example.com",
        city: "Lahore",
        address: "12 Mall Road",
      });
      expect(json.returnContactReady).toBe(true);
    });

    it("RC-05: hides seller return contact before delivery", () => {
      const order = new Order({
        buyerId: new mongoose.Types.ObjectId(),
        sellerId: new mongoose.Types.ObjectId(),
        productId: new mongoose.Types.ObjectId(),
        type: "rental",
        status: "approved",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.SHIPPED,
        rentStart: "2026-03-01",
        rentEnd: "2026-03-05",
        rentalDays: 5,
        sellerReturnContact: {
          name: "Seller One",
          phone: "03001234567",
          email: "seller@example.com",
          address: "12 Mall Road",
          city: "Lahore",
        },
      });

      const json = order.toBuyerJSON();
      expect(json.sellerReturnContact).toBeNull();
      expect(json.returnContactReady).toBe(true);
    });
  });

  describe("shipOrder rental gate", () => {
    it("RC-06: blocks shipping rental when seller return contact incomplete", async () => {
      const sellerId = new mongoose.Types.ObjectId();
      const order = {
        _id: new mongoose.Types.ObjectId(),
        sellerId,
        type: "rental",
        status: "approved",
        paymentStatus: "paid",
        fulfillmentStatus: FULFILLMENT.PROCESSING,
      };

      Order.findOne = jest.fn().mockResolvedValue(order);
      User.findById = jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          hasCompleteReturnContact: () => false,
        }),
      });

      const req = mockReq({ user: { _id: sellerId }, params: { id: String(order._id) } });
      const res = mockRes();

      await shipOrder(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/return contact/i);
    });
  });
});

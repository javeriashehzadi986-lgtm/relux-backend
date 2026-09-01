const {
  buildDispatchDetails,
  buildReturnInstructionsDetails,
  buildActionUrl,
  isConfigured,
} = require("../services/emailService");

describe("Email / Dispatch Service — Chapter 5: Seller Notifications", () => {
  describe("buildDispatchDetails", () => {
    it("TC-EM-01: includes full buyer shipping details for rental", () => {
      const details = buildDispatchDetails(
        {
          _id: "abc123",
          orderId: "RH-TEST001",
          type: "rental",
          size: "M",
          rentStart: "2026-02-01",
          rentEnd: "2026-02-03",
          rentalDays: 3,
          amountPkr: 50000,
          shipping: {
            fullName: "Sara Ahmed",
            email: "sara@example.com",
            phone: "+923001234567",
            address: "12 Mall Road",
            city: "Lahore",
            specialInstructions: "Call on arrival",
          },
        },
        { title: "Silk Lehenga" },
        { name: "Sara Ahmed", email: "sara@example.com", phone: "+923001234567" },
      );

      expect(details.orderType).toBe("Rental");
      expect(details.buyerName).toBe("Sara Ahmed");
      expect(details.buyerEmail).toBe("sara@example.com");
      expect(details.buyerPhone).toBe("+923001234567");
      expect(details.address).toBe("12 Mall Road");
      expect(details.city).toBe("Lahore");
      expect(details.specialInstructions).toBe("Call on arrival");
      expect(details.productTitle).toBe("Silk Lehenga");
      expect(details.rentalDays).toBe("3");
    });

    it("TC-EM-02: includes buyer details for sale purchase", () => {
      const details = buildDispatchDetails(
        {
          _id: "sale1",
          orderId: "RH-SALE001",
          type: "sale",
          size: "L",
          amountPkr: 85000,
          shipping: {
            fullName: "Ali Khan",
            email: "ali@example.com",
            phone: "03001234567",
            address: "House 5, Street 2",
            city: "Karachi",
          },
        },
        { title: "Designer Sherwani" },
        null,
      );

      expect(details.orderType).toBe("Purchase");
      expect(details.buyerName).toBe("Ali Khan");
      expect(details.city).toBe("Karachi");
      expect(details.rentStart).toBe("");
    });

    it("TC-EM-03: falls back to em dash for missing fields", () => {
      const details = buildDispatchDetails(
        { _id: "x", type: "sale", shipping: {} },
        null,
        null,
      );
      expect(details.address).toBe("—");
      expect(details.buyerPhone).toBe("—");
    });
  });

  describe("buildReturnInstructionsDetails", () => {
    it("TC-EM-06: includes seller return contact details", () => {
      const details = buildReturnInstructionsDetails(
        {
          _id: "rent1",
          orderId: "RH-RET001",
          type: "rental",
          size: "M",
          rentStart: "2026-02-01",
          rentEnd: "2026-02-03",
          rentalDays: 3,
          sellerReturnContact: {
            name: "Seller Ali",
            email: "ali@example.com",
            phone: "03001234567",
            address: "House 5",
            city: "Karachi",
          },
        },
        { title: "Designer Gown" },
      );

      expect(details.sellerName).toBe("Seller Ali");
      expect(details.sellerPhone).toBe("03001234567");
      expect(details.address).toBe("House 5");
      expect(details.city).toBe("Karachi");
    });
  });

  describe("buildActionUrl", () => {
    it("TC-EM-04: builds absolute seller orders link", () => {
      const url = buildActionUrl("/sellerProfile?section=orders");
      expect(url).toContain("/sellerProfile?section=orders");
    });
  });

  describe("isConfigured", () => {
    it("TC-EM-05: reports SendGrid configuration state", () => {
      expect(typeof isConfigured()).toBe("boolean");
    });
  });
});

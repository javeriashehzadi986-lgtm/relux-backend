/**
 * Chapter 5 — Testing & Evaluation
 * Maps thesis test cases (UT/FT/IT) to actual Relux Hub backend behavior.
 */
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { mockRes, mockReq, mockOrderFindOne, mockBidQueries } = require("./helpers/testUtils");

jest.mock("../models/PendingSignup");
jest.mock("../models/User");
jest.mock("../models/Product");
jest.mock("../models/Category");
jest.mock("../models/Bid");
jest.mock("../models/Order");
jest.mock("../models/SellerReview");
jest.mock("../models/SellerVerification");
jest.mock("../utils/releaseBlockedEmail");
jest.mock("../services/emailService");
jest.mock("../services/notificationService");
jest.mock("../services/auctionSocketService");
jest.mock("../services/stripeService");
jest.mock("../services/orderStatusService", () => ({
  syncProductForOrder: jest.fn(),
  FULFILLMENT: {},
  ensurePaid: jest.fn(),
  isRentalPeriodComplete: jest.fn(),
}));

const PendingSignup = require("../models/PendingSignup");
const User = require("../models/User");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Bid = require("../models/Bid");
const Order = require("../models/Order");
const SellerReview = require("../models/SellerReview");
const SellerVerification = require("../models/SellerVerification");
const { releaseEmailForNewSignup } = require("../utils/releaseBlockedEmail");
const { sendNotificationEmail } = require("../services/emailService");
const { emitAuctionUpdate } = require("../services/auctionSocketService");
const { getStripe, getCurrency, toStripeUnitAmount, getFrontendUrl } = require("../services/stripeService");

const { register } = require("../controllers/authController");
const { createListing } = require("../controllers/listingController");
const { placeBid } = require("../controllers/bidController");
const { createSaleCheckout, createRentalCheckout } = require("../controllers/paymentController");
const { createSellerReview } = require("../controllers/reviewController");
const { submitVerification } = require("../controllers/sellerVerificationController");
const { approveListing } = require("../controllers/adminListingController");
const { createRentalRequest } = require("../controllers/buyerOrderController");

describe("Chapter 5 — Unit Testing (UT)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releaseEmailForNewSignup.mockResolvedValue({ blocked: false });
    sendNotificationEmail.mockResolvedValue({ sent: true });
    PendingSignup.deleteMany = jest.fn().mockResolvedValue({});
    PendingSignup.create = jest.fn().mockResolvedValue({});
  });

  describe("UT1 — Register User with Valid Data", () => {
    it("hashes password and stores pending signup (email verification required before User record)", async () => {
      const req = mockReq({
        body: { name: "Ali Khan", email: "ali@test.com", password: "secret12" },
      });
      const res = mockRes();

      await register(req, res);

      expect(res.statusCode).toBe(201);
      expect(PendingSignup.create).toHaveBeenCalled();
      const saved = PendingSignup.create.mock.calls[0][0];
      expect(saved.email).toBe("ali@test.com");
      expect(saved.password).toMatch(/^\$2[aby]\$/);
      const match = await bcrypt.compare("secret12", saved.password);
      expect(match).toBe(true);
      expect(res.body.requiresVerification).toBe(true);
    });
  });

  describe("UT2 — Prevent Duplicate Email Registration", () => {
    it("returns 409 when email is already registered", async () => {
      releaseEmailForNewSignup.mockResolvedValue({ blocked: true });
      const req = mockReq({
        body: { name: "Ali", email: "exists@test.com", password: "secret12" },
      });
      const res = mockRes();

      await register(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.body.code).toBe("EMAIL_IN_USE");
      expect(PendingSignup.create).not.toHaveBeenCalled();
    });
  });

  describe("UT3 — Create Listing by Verified Seller", () => {
    it("saves listing as pending approval", async () => {
      Category.findOne = jest.fn().mockResolvedValue({ name: "Female" });
      Product.create = jest.fn().mockResolvedValue({
        toPublicJSON: () => ({
          verificationStatus: "pending",
          status: "pending",
          title: "Silk Gown",
        }),
      });

      const req = mockReq({
        user: { _id: "seller1", status: "active" },
        body: {
          title: "Silk Gown",
          listingType: "sale",
          mainCategory: "Female",
          mainImage: "https://example.com/img1.jpg",
          gallery: [
            "https://example.com/img1.jpg",
            "https://example.com/img2.jpg",
            "https://example.com/img3.jpg",
            "https://example.com/img4.jpg",
          ],
          salePrice: "50000",
        },
      });
      const res = mockRes();

      await createListing(req, res);

      expect(res.statusCode).toBe(201);
      expect(Product.create).toHaveBeenCalledWith(
        expect.objectContaining({
          verificationStatus: "pending",
          status: "pending",
        }),
      );
    });
  });

  describe("UT4 — Reject Invalid Low Auction Bid", () => {
    it("rejects bid below minimum next bid", async () => {
      const productId = new mongoose.Types.ObjectId();
      Product.findOne = jest.fn().mockResolvedValue({
        _id: productId,
        sellerId: "seller99",
        listingType: "sale",
        startingBid: "10000",
        minBid: "2500",
        title: "Dress",
        createdAt: new Date(),
      });
      Bid.findOne = jest.fn().mockImplementation(() => ({
        sort: jest.fn().mockResolvedValue({ amount: 15000, userId: "other" }),
      }));

      const req = mockReq({
        user: { _id: "buyer1" },
        body: { productId: String(productId), amount: 16000 },
      });
      const res = mockRes();

      await placeBid(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.minimumNextBid).toBe(17500);
      expect(Bid.create).not.toHaveBeenCalled();
    });
  });

  describe("UT5 — Checkout Creates Held Payment Order", () => {
    beforeEach(() => {
      getCurrency.mockReturnValue("pkr");
      toStripeUnitAmount.mockReturnValue(5000000);
      getFrontendUrl.mockReturnValue("http://localhost:5173");
      getStripe.mockReturnValue({
        checkout: {
          sessions: {
            create: jest.fn().mockResolvedValue({ id: "sess_1", url: "https://stripe.test/pay" }),
          },
        },
      });
    });

    it("sale checkout creates order with paymentStatus pending (not escrow-held)", async () => {
      const productId = new mongoose.Types.ObjectId();
      const past = new Date(Date.now() - 86400000);
      Product.findById = jest.fn().mockResolvedValue({
        _id: productId,
        sellerId: "seller1",
        listingType: "sale",
        verificationStatus: "approved",
        status: "active",
        title: "Gown",
        mainImage: "https://example.com/a.jpg",
        startingBid: "10000",
        salePrice: "10000",
        auctionEndDate: past.toISOString(),
        listingSize: "M",
      });
      Bid.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue({ userId: "buyer1", amount: 12000 }),
      });
      mockOrderFindOne(Order);
      Order.create = jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        orderId: "ORD-1",
        save: jest.fn(),
        toBuyerJSON: () => ({ paymentStatus: "pending", escrowStatus: "none" }),
      });

      const req = mockReq({
        user: { _id: "buyer1", role: "buyer", email: "b@test.com", name: "Buyer" },
        body: {
          productId: String(productId),
          fullName: "Buyer",
          phone: "03001234567",
          address: "Street 1",
          city: "Lahore",
        },
      });
      const res = mockRes();

      await createSaleCheckout(req, res);

      expect(res.statusCode).toBe(201);
      expect(Order.create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: "pending", type: "sale" }),
      );
      const created = Order.create.mock.calls[0][0];
      expect(created.escrowStatus).toBeUndefined();
    });

    it("rental escrow held only after payment succeeds (not at checkout creation)", async () => {
      const orderId = new mongoose.Types.ObjectId();
      const mockOrder = {
        _id: orderId,
        type: "rental",
        status: "approved",
        paymentStatus: "pending",
        buyerId: "buyer1",
        sellerId: "seller1",
        productId: new mongoose.Types.ObjectId(),
        amountPkr: 50000,
        orderId: "RNT-1",
        save: jest.fn(),
        toBuyerJSON: jest.fn().mockReturnValue({ paymentStatus: "pending" }),
      };
      Order.findOne = jest.fn().mockResolvedValue(mockOrder);
      Product.findById = jest.fn().mockResolvedValue({
        _id: mockOrder.productId,
        title: "Rent Dress",
        mainImage: "https://example.com/r.jpg",
        itemPrice: "50000",
      });

      const req = mockReq({
        user: { _id: "buyer1", role: "buyer", email: "b@test.com" },
        body: {
          orderId: String(orderId),
          fullName: "Buyer",
          phone: "03001234567",
          address: "Street 1",
          city: "Lahore",
        },
      });
      const res = mockRes();

      await createRentalCheckout(req, res);

      expect(res.statusCode).toBe(201);
      expect(mockOrder.paymentStatus).toBe("pending");
      expect(mockOrder.escrowStatus).toBeUndefined();
    });
  });

  describe("UT6 — Submit Review After Completed Order", () => {
    it("saves review and recalculates rating stats (no completed-order check enforced)", async () => {
      const sellerId = new mongoose.Types.ObjectId();
      User.findById = jest.fn().mockResolvedValue({ _id: sellerId, name: "Seller" });
      SellerReview.create = jest.fn().mockResolvedValue({
        toPublicJSON: () => ({ rating: 5, quote: "Great seller" }),
      });
      SellerReview.find = jest.fn().mockResolvedValue([
        { rating: 5, toPublicJSON: () => ({ rating: 5 }) },
      ]);

      const req = mockReq({
        user: { _id: new mongoose.Types.ObjectId(), name: "Buyer" },
        body: { sellerId: String(sellerId), rating: 5, quote: "Great seller" },
      });
      const res = mockRes();

      await createSellerReview(req, res);

      expect(res.statusCode).toBe(201);
      expect(SellerReview.create).toHaveBeenCalled();
      expect(res.body.stats).toEqual({ average: 5, count: 1 });
    });
  });
});

describe("Chapter 5 — Functional Testing (FT)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releaseEmailForNewSignup.mockResolvedValue({ blocked: false });
  });

  describe("FT1 — Buyer applies for seller verification (CNIC pending)", () => {
    it("upgrades buyer to pending seller and creates verification record", async () => {
      const userId = new mongoose.Types.ObjectId();
      const user = {
        _id: userId,
        role: "buyer",
        status: "active",
        phone: "",
        city: "",
        save: jest.fn().mockResolvedValue(undefined),
        toPublicJSON: () => ({ role: "seller", status: "pending" }),
      };
      User.findById = jest.fn().mockResolvedValue(user);
      SellerVerification.findOneAndUpdate = jest.fn().mockResolvedValue({
        toPublicJSON: () => ({ verificationStatus: "pending" }),
      });

      const req = mockReq({
        user: { _id: userId, role: "buyer" },
        body: {
          phone: "03001234567",
          city: "Lahore",
          returnContactName: "Sara Seller",
          returnPhone: "03001234567",
          returnCity: "Lahore",
          returnAddress: "12 Mall Road",
          cnicFront: "https://example.com/front.jpg",
          cnicBack: "https://example.com/back.jpg",
        },
      });
      const res = mockRes();

      await submitVerification(req, res);

      expect(res.statusCode).toBe(200);
      expect(user.role).toBe("seller");
      expect(user.status).toBe("pending");
      expect(SellerVerification.findOneAndUpdate).toHaveBeenCalledWith(
        { userId },
        expect.objectContaining({ verificationStatus: "pending" }),
        expect.any(Object),
      );
    });
  });

  describe("FT2 — Admin Approves Listing", () => {
    it("sets listing to approved and active", async () => {
      const listing = {
        _id: new mongoose.Types.ObjectId(),
        title: "Gown",
        sellerId: { _id: "seller1" },
        verificationStatus: "pending",
        status: "pending",
        save: jest.fn(),
      };
      Product.findById = jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(listing),
      });

      const req = mockReq({ params: { id: String(listing._id) } });
      const res = mockRes();

      await approveListing(req, res);

      expect(listing.verificationStatus).toBe("approved");
      expect(listing.status).toBe("active");
      expect(res.body.message).toMatch(/approved/i);
    });
  });

  describe("FT3 — Buyer Checkout for Approved Item", () => {
    it("creates Stripe checkout session and pending order for auction winner", async () => {
      getCurrency.mockReturnValue("pkr");
      toStripeUnitAmount.mockReturnValue(5000000);
      getFrontendUrl.mockReturnValue("http://localhost:5173");
      getStripe.mockReturnValue({
        checkout: {
          sessions: {
            create: jest.fn().mockResolvedValue({ id: "sess_ft3", url: "https://stripe.test/pay" }),
          },
        },
      });

      const productId = new mongoose.Types.ObjectId();
      Product.findById = jest.fn().mockResolvedValue({
        _id: productId,
        sellerId: "seller1",
        listingType: "sale",
        verificationStatus: "approved",
        status: "active",
        title: "Gown",
        auctionEndDate: new Date(Date.now() - 1000).toISOString(),
        startingBid: "10000",
        salePrice: "10000",
      });
      Bid.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue({ userId: "buyer1", amount: 15000 }),
      });
      mockOrderFindOne(Order);
      Order.create = jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        orderId: "ORD-FT3",
        save: jest.fn(),
        toBuyerJSON: () => ({ paymentStatus: "pending" }),
      });

      const req = mockReq({
        user: { _id: "buyer1", role: "buyer", email: "b@test.com", name: "Buyer" },
        body: {
          productId: String(productId),
          fullName: "Buyer",
          phone: "03001234567",
          address: "Street 1",
          city: "Lahore",
        },
      });
      const res = mockRes();

      await createSaleCheckout(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.url).toBe("https://stripe.test/pay");
      expect(getStripe().checkout.sessions.create).toHaveBeenCalled();
    });
  });

  describe("FT4 — Buyer Places Auction Bid", () => {
    it("accepts valid bid and emits real-time auction update", async () => {
      const productId = new mongoose.Types.ObjectId();
      const future = new Date(Date.now() + 7 * 86400000);
      Product.findOne = jest.fn().mockResolvedValue({
        _id: productId,
        sellerId: "seller1",
        listingType: "sale",
        startingBid: "10000",
        minBid: "2500",
        title: "Dress",
        createdAt: new Date(),
        auctionEndDate: future.toISOString(),
      });
      mockBidQueries(Bid, User, { highestBid: null, userHighest: null });
      Bid.create = jest.fn().mockResolvedValue({
        toPublicJSON: () => ({ amount: 10000 }),
      });

      const req = mockReq({
        user: { _id: "buyer1" },
        body: { productId: String(productId), amount: 10000 },
      });
      const res = mockRes();

      await placeBid(req, res);

      expect(res.statusCode).toBe(201);
      expect(Bid.create).toHaveBeenCalled();
      expect(emitAuctionUpdate).toHaveBeenCalled();
    });
  });

  describe("FT5 — Renter Books Item", () => {
    it("creates rental order request in pending status", async () => {
      const productId = new mongoose.Types.ObjectId();
      Product.findById = jest.fn().mockResolvedValue({
        _id: productId,
        sellerId: "seller1",
        listingType: "rent",
        verificationStatus: "approved",
        status: "active",
        title: "Rent Gown",
      });
      Order.findOne = jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
      Order.create = jest.fn().mockResolvedValue({
        toBuyerJSON: () => ({ type: "rental", status: "pending" }),
      });

      const req = mockReq({
        user: { _id: "buyer1", role: "buyer", name: "Renter" },
        body: {
          productId: String(productId),
          rentStart: "2026-09-01",
          rentEnd: "2026-09-03",
        },
      });
      const res = mockRes();

      await createRentalRequest(req, res);

      expect(res.statusCode).toBe(201);
      expect(Order.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "rental", status: "pending" }),
      );
    });
  });

  describe("FT6 — Buyer Submits Rating and Review", () => {
    it("stores review with recalculated seller stats", async () => {
      const sellerId = new mongoose.Types.ObjectId();
      User.findById = jest.fn().mockResolvedValue({ _id: sellerId });
      SellerReview.create = jest.fn().mockResolvedValue({
        toPublicJSON: () => ({ rating: 4, quote: "Good" }),
      });
      SellerReview.find = jest.fn().mockResolvedValue([
        { rating: 4, toPublicJSON: () => ({ rating: 4 }) },
        { rating: 5, toPublicJSON: () => ({ rating: 5 }) },
      ]);

      const req = mockReq({
        user: { _id: new mongoose.Types.ObjectId(), name: "Buyer" },
        body: { sellerId: String(sellerId), rating: 4, quote: "Good experience" },
      });
      const res = mockRes();

      await createSellerReview(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.body.stats.average).toBe(4.5);
      expect(res.body.stats.count).toBe(2);
    });
  });
});

describe("Chapter 5 — Integration Testing (IT)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    releaseEmailForNewSignup.mockResolvedValue({ blocked: false });
    sendNotificationEmail.mockResolvedValue({ sent: true });
    PendingSignup.deleteMany = jest.fn().mockResolvedValue({});
    PendingSignup.create = jest.fn().mockResolvedValue({});
  });

  describe("IT1 — Frontend → Backend → Database Registration Flow", () => {
    it("step 1 stores hashed credentials in PendingSignup (User created after email verify)", async () => {
      const req = mockReq({
        body: { name: "Test User", email: "it1@test.com", password: "pass1234" },
      });
      const res = mockRes();

      await register(req, res);

      expect(PendingSignup.create).toHaveBeenCalled();
      expect(res.body.requiresVerification).toBe(true);
    });
  });

  describe("IT2 — Checkout → Backend → Stripe Payment Integration", () => {
    it("backend calls Stripe sessions.create when buyer checks out", async () => {
      getCurrency.mockReturnValue("pkr");
      toStripeUnitAmount.mockReturnValue(1000000);
      getFrontendUrl.mockReturnValue("http://localhost:5173");
      const stripeCreate = jest.fn().mockResolvedValue({ id: "sess_it2", url: "https://pay" });
      getStripe.mockReturnValue({ checkout: { sessions: { create: stripeCreate } } });

      const productId = new mongoose.Types.ObjectId();
      Product.findById = jest.fn().mockResolvedValue({
        _id: productId,
        sellerId: "seller1",
        listingType: "sale",
        verificationStatus: "approved",
        status: "active",
        title: "Item",
        auctionEndDate: new Date(Date.now() - 1000).toISOString(),
        startingBid: "5000",
        salePrice: "5000",
      });
      Bid.findOne = jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue({ userId: "buyer1", amount: 8000 }),
      });
      mockOrderFindOne(Order);
      Order.create = jest.fn().mockResolvedValue({
        _id: new mongoose.Types.ObjectId(),
        orderId: "IT2",
        save: jest.fn(),
        toBuyerJSON: () => ({}),
      });

      const req = mockReq({
        user: { _id: "buyer1", role: "buyer", email: "b@test.com", name: "B" },
        body: {
          productId: String(productId),
          fullName: "B",
          phone: "0300",
          address: "Addr",
          city: "City",
        },
      });
      await createSaleCheckout(req, mockRes());

      expect(stripeCreate).toHaveBeenCalled();
    });
  });

  describe("IT3 — Bid Placement → Database → Real-time Update", () => {
    it("persists bid and broadcasts via socket after successful placement", async () => {
      const productId = new mongoose.Types.ObjectId();
      Product.findOne = jest.fn().mockResolvedValue({
        _id: productId,
        sellerId: "seller1",
        listingType: "sale",
        startingBid: "5000",
        minBid: "1000",
        title: "Auction Item",
        createdAt: new Date(),
        auctionEndDate: new Date(Date.now() + 86400000).toISOString(),
      });
      mockBidQueries(Bid, User, { highestBid: null });
      Bid.create = jest.fn().mockResolvedValue({ toPublicJSON: () => ({ amount: 5000 }) });

      await placeBid(
        mockReq({ user: { _id: "buyer1" }, body: { productId: String(productId), amount: 5000 } }),
        mockRes(),
      );

      expect(Bid.create).toHaveBeenCalled();
      expect(emitAuctionUpdate).toHaveBeenCalledWith(
        productId,
        expect.objectContaining({ summary: expect.any(Object), history: expect.any(Array) }),
      );
    });
  });

  describe("IT4 — Review Submission → Rating Calculation", () => {
    it("returns updated average rating after review is saved", async () => {
      const sellerId = new mongoose.Types.ObjectId();
      User.findById = jest.fn().mockResolvedValue({ _id: sellerId });
      SellerReview.create = jest.fn().mockResolvedValue({
        toPublicJSON: () => ({ rating: 3 }),
      });
      SellerReview.find = jest.fn().mockResolvedValue([
        { rating: 5, toPublicJSON: () => ({ rating: 5 }) },
        { rating: 3, toPublicJSON: () => ({ rating: 3 }) },
      ]);

      const res = mockRes();
      await createSellerReview(
        mockReq({
          user: { _id: new mongoose.Types.ObjectId(), name: "Buyer" },
          body: { sellerId: String(sellerId), rating: 3, quote: "OK" },
        }),
        res,
      );

      expect(res.body.stats).toEqual({ average: 4, count: 2 });
    });
  });
});

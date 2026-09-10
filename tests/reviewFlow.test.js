const mongoose = require("mongoose");
const { mockRes, mockReq } = require("./helpers/testUtils");

jest.mock("../models/SellerReview");
jest.mock("../models/User");
jest.mock("../models/Product");

const SellerReview = require("../models/SellerReview");
const User = require("../models/User");
const Product = require("../models/Product");

const { getSellerReviews } = require("../controllers/reviewController");
const {
  updateReviewStatus,
  deleteReview,
} = require("../controllers/adminReviewController");

function makeReview(overrides = {}) {
  const doc = {
    _id: new mongoose.Types.ObjectId(),
    sellerId: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    productId: new mongoose.Types.ObjectId(),
    rating: 4,
    quote: "Great seller",
    authorName: "Ayesha",
    reportReason: "",
    reportDetails: "",
    status: "active",
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
  doc.toPublicJSON = function toPublicJSON() {
    return {
      id: this._id.toString(),
      sellerId: this.sellerId,
      productId: this.productId,
      rating: this.rating,
      quote: this.quote,
      author: this.authorName || "Verified Buyer",
      createdAt: this.createdAt,
      hasReport: false,
    };
  };
  return doc;
}

function mockFindChain(result) {
  return {
    sort: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue(result),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getSellerReviews — product scoping", () => {
  test("without productId returns all seller reviews", async () => {
    const sellerId = new mongoose.Types.ObjectId().toString();
    User.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: sellerId,
        name: "Sania",
        createdAt: new Date("2022-01-01"),
      }),
    });
    const reviews = [makeReview(), makeReview()];
    SellerReview.find = jest.fn().mockReturnValue(mockFindChain(reviews));

    const req = mockReq({ params: { sellerId }, query: {} });
    const res = mockRes();
    await getSellerReviews(req, res);

    expect(SellerReview.find).toHaveBeenCalledWith({
      sellerId,
      status: { $in: ["active", "flagged"] },
    });
    expect(res.body.reviews).toHaveLength(2);
  });

  test("with productId filters the query by that product", async () => {
    const sellerId = new mongoose.Types.ObjectId().toString();
    const productId = new mongoose.Types.ObjectId().toString();
    User.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: sellerId,
        name: "Sania",
        createdAt: new Date("2022-01-01"),
      }),
    });
    SellerReview.find = jest.fn().mockReturnValue(mockFindChain([makeReview()]));

    const req = mockReq({ params: { sellerId }, query: { productId } });
    const res = mockRes();
    await getSellerReviews(req, res);

    expect(SellerReview.find).toHaveBeenCalledWith({
      sellerId,
      status: { $in: ["active", "flagged"] },
      productId,
    });
    expect(res.body.reviews).toHaveLength(1);
  });

  test("rejects an invalid productId", async () => {
    const sellerId = new mongoose.Types.ObjectId().toString();
    const req = mockReq({ params: { sellerId }, query: { productId: "not-an-id" } });
    const res = mockRes();
    await getSellerReviews(req, res);
    expect(res.statusCode).toBe(400);
  });

  test("hidden (removed) reviews never reach the public payload", async () => {
    const sellerId = new mongoose.Types.ObjectId().toString();
    User.findById = jest.fn().mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: sellerId,
        name: "Sania",
        createdAt: new Date("2022-01-01"),
      }),
    });
    // find() query already excludes "removed"; simulate a flagged one slipping through
    SellerReview.find = jest.fn().mockReturnValue(
      mockFindChain([makeReview({ status: "active" }), makeReview({ status: "flagged" })]),
    );

    const req = mockReq({ params: { sellerId }, query: {} });
    const res = mockRes();
    await getSellerReviews(req, res);

    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.stats.count).toBe(1);
  });
});

describe("adminReviewController — action buttons", () => {
  test("Hide Review maps 'hidden' -> 'removed' and persists", async () => {
    const id = new mongoose.Types.ObjectId();
    const updatedDoc = makeReview({ _id: id, status: "removed" });
    SellerReview.findByIdAndUpdate = jest.fn().mockResolvedValue(updatedDoc);
    SellerReview.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(updatedDoc),
        }),
      }),
    });
    SellerReview.countDocuments = jest.fn().mockResolvedValue(0);
    SellerReview.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    const req = mockReq({ params: { id: id.toString() }, body: { status: "hidden" } });
    const res = mockRes();
    await updateReviewStatus(req, res);

    expect(SellerReview.findByIdAndUpdate).toHaveBeenCalledWith(
      id.toString(),
      { $set: { status: "removed" } },
      expect.objectContaining({ new: true }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.review.status).toBe("hidden");
  });

  test("Set Active persists 'active'", async () => {
    const id = new mongoose.Types.ObjectId();
    const updatedDoc = makeReview({ _id: id, status: "active" });
    SellerReview.findByIdAndUpdate = jest.fn().mockResolvedValue(updatedDoc);
    SellerReview.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue(updatedDoc),
        }),
      }),
    });
    SellerReview.countDocuments = jest.fn().mockResolvedValue(0);
    SellerReview.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    const req = mockReq({ params: { id: id.toString() }, body: { status: "active" } });
    const res = mockRes();
    await updateReviewStatus(req, res);

    expect(SellerReview.findByIdAndUpdate).toHaveBeenCalledWith(
      id.toString(),
      { $set: { status: "active" } },
      expect.objectContaining({ new: true }),
    );
    expect(res.body.review.status).toBe("active");
  });

  test("rejects an unknown status", async () => {
    const req = mockReq({ params: { id: "x" }, body: { status: "bogus" } });
    const res = mockRes();
    await updateReviewStatus(req, res);
    expect(res.statusCode).toBe(400);
  });

  test("Remove permanently deletes", async () => {
    const id = new mongoose.Types.ObjectId();
    SellerReview.findByIdAndDelete = jest.fn().mockResolvedValue(makeReview({ _id: id }));
    SellerReview.countDocuments = jest.fn().mockResolvedValue(0);
    SellerReview.find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    const req = mockReq({ params: { id: id.toString() } });
    const res = mockRes();
    await deleteReview(req, res);

    expect(SellerReview.findByIdAndDelete).toHaveBeenCalledWith(id.toString());
    expect(res.statusCode).toBe(200);
  });
});

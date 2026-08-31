const mongoose = require("mongoose");
const Product = require("../models/Product");
const Order = require("../models/Order");
const {
  resolveMainBySlug,
  buildNameToSlugMap,
  categoryPathForSlug,
} = require("../utils/categoryResolve");

const LIST_IMAGE_MAX_CHARS = 50000;

function safeListImage(src) {
  if (!src || typeof src !== "string") return "";
  if (src.length > LIST_IMAGE_MAX_CHARS) return "";
  return src;
}

function mapPublicListing(product, nameToSlug, { includeGallery = true } = {}) {
  const seller = product.sellerId;
  const sellerId =
    seller && typeof seller === "object"
      ? seller._id?.toString?.() ?? String(seller._id)
      : product.sellerId?.toString?.() ?? product.sellerId;

  const slug = nameToSlug[product.mainCategory];
  const base =
    typeof product.toPublicJSON === "function"
      ? product.toPublicJSON()
      : {
          id: product._id,
          sellerId: product.sellerId,
          title: product.title,
          brand: product.brand || "",
          description: product.description || "",
          listingType: product.listingType,
          listingSize: product.listingSize || "",
          listingCondition: product.listingCondition || "",
          mainCategory: product.mainCategory,
          style: product.style || "",
          clothingType: product.clothingType || "",
          salePrice: product.salePrice || "",
          startingBid: product.startingBid || "",
          minBid: product.minBid || "",
          auctionEndDate: product.auctionEndDate || "",
          rentPrice: product.rentPrice || "",
          itemPrice: product.itemPrice || "",
          mainImage: product.mainImage || "",
          gallery: product.gallery || [],
          verificationStatus: product.verificationStatus,
          status: product.status,
          adminNote: product.adminNote || "",
          submittedAt: product.createdAt,
          reviewedAt: product.reviewedAt,
        };

  return {
    ...base,
    id: product._id.toString(),
    sellerId: sellerId ? String(sellerId) : null,
    categoryPath: categoryPathForSlug(slug),
    sellerName: seller?.name || "Relux Seller",
    seller: seller?.name || "Relux Seller",
    updatedAt: product.updatedAt,
    mainImage: safeListImage(base.mainImage || product.mainImage),
    gallery: includeGallery
      ? (base.gallery || product.gallery || [])
          .map(safeListImage)
          .filter(Boolean)
          .slice(0, 8)
      : [],
  };
}

async function getPublicListings(req, res) {
  try {
    const slug = req.query.category;
    const type = String(req.query.type ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 12, 1), 24);
    const query = { verificationStatus: "approved", status: "active" };

    if (slug) {
      const main = await resolveMainBySlug(slug);
      if (main?.name) {
        query.mainCategory = main.name;
      }
    }

    if (type === "rent") {
      query.listingType = "rent";
    } else if (type === "sale" || type === "resale") {
      query.listingType = "sale";
    }

    // Project away huge base64 blobs BEFORE they leave MongoDB (fixes Atlas timeouts)
    const pipeline = [
      { $match: query },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $addFields: {
          mainImage: {
            $cond: [
              {
                $gt: [{ $strLenCP: { $ifNull: ["$mainImage", ""] } }, LIST_IMAGE_MAX_CHARS],
              },
              "",
              { $ifNull: ["$mainImage", ""] },
            ],
          },
          gallery: [],
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sellerId",
          foreignField: "_id",
          as: "sellerDocs",
          pipeline: [{ $project: { name: 1, city: 1 } }],
        },
      },
      {
        $addFields: {
          sellerId: { $arrayElemAt: ["$sellerDocs", 0] },
        },
      },
      { $project: { sellerDocs: 0 } },
    ];

    const [listings, nameToSlug] = await Promise.all([
      Product.aggregate(pipeline).option({ maxTimeMS: 12000 }),
      buildNameToSlugMap(),
    ]);

    const mapped = listings.map((item) =>
      mapPublicListing(item, nameToSlug, { includeGallery: false }),
    );

    res.json({ listings: mapped });
  } catch (error) {
    const timedOut =
      error.name === "MongoNetworkTimeoutError" ||
      error.code === 50 ||
      /timed out|MaxTimeMS/i.test(error.message || "");
    res.status(timedOut ? 504 : 500).json({
      message: timedOut
        ? "Database is slow or unreachable. Check MongoDB Atlas Network Access / internet, then restart the backend."
        : error.message || "Failed to load catalog",
    });
  }
}

async function userCanViewNonActiveListing(user, product) {
  if (!user || !product) return false;
  if (user.role === "admin") return true;

  const userId = user._id.toString();
  const sellerId =
    product.sellerId?._id?.toString?.() ??
    product.sellerId?.toString?.() ??
    String(product.sellerId);

  if (sellerId === userId) return true;

  const order = await Order.findOne({
    productId: product._id,
    $or: [{ buyerId: user._id }, { sellerId: user._id }],
    status: { $nin: ["cancelled", "rejected"] },
    removedByBuyer: { $ne: true },
  }).select("_id");

  return Boolean(order);
}

async function getPublicListing(req, res) {
  try {
    const productId = req.params.id;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(404).json({ message: "Listing not found" });
    }

    const rows = await Product.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(productId),
          verificationStatus: "approved",
          status: { $in: ["active", "sold"] },
        },
      },
      {
        $addFields: {
          mainImage: {
            $cond: [
              {
                $gt: [{ $strLenCP: { $ifNull: ["$mainImage", ""] } }, LIST_IMAGE_MAX_CHARS],
              },
              "",
              { $ifNull: ["$mainImage", ""] },
            ],
          },
          gallery: {
            $filter: {
              input: { $ifNull: ["$gallery", []] },
              as: "img",
              cond: {
                $lte: [{ $strLenCP: { $ifNull: ["$$img", ""] } }, LIST_IMAGE_MAX_CHARS],
              },
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "sellerId",
          foreignField: "_id",
          as: "sellerDocs",
          pipeline: [{ $project: { name: 1, city: 1 } }],
        },
      },
      {
        $addFields: {
          sellerId: { $arrayElemAt: ["$sellerDocs", 0] },
        },
      },
      { $project: { sellerDocs: 0 } },
      { $limit: 1 },
    ]).option({ maxTimeMS: 15000 });

    let product = rows[0];
    if (!product) {
      const inactiveProduct = await Product.findOne({
        _id: productId,
        verificationStatus: "approved",
      }).populate("sellerId", "name city");

      if (
        inactiveProduct &&
        (await userCanViewNonActiveListing(req.user, inactiveProduct))
      ) {
        product = inactiveProduct;
      }
    }

    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }

    const nameToSlug = await buildNameToSlugMap();
    res.json({ listing: mapPublicListing(product, nameToSlug, { includeGallery: true }) });
  } catch (error) {
    const timedOut =
      error.name === "MongoNetworkTimeoutError" ||
      error.code === 50 ||
      /timed out|MaxTimeMS/i.test(error.message || "");
    res.status(timedOut ? 504 : 500).json({
      message: timedOut
        ? "Database is slow or unreachable. Check MongoDB Atlas / internet."
        : error.message || "Failed to load listing",
    });
  }
}

module.exports = { getPublicListings, getPublicListing };

const Product = require("../models/Product");
const Order = require("../models/Order");
const {
  resolveMainBySlug,
  buildNameToSlugMap,
  categoryPathForSlug,
} = require("../utils/categoryResolve");

function mapPublicListing(product, nameToSlug) {
  const seller = product.sellerId;
  const sellerId =
    seller && typeof seller === "object"
      ? seller._id?.toString?.() ?? String(seller._id)
      : product.sellerId?.toString?.() ?? product.sellerId;

  const slug = nameToSlug[product.mainCategory];

  return {
    ...product.toPublicJSON(),
    id: product._id.toString(),
    sellerId: sellerId ? String(sellerId) : null,
    categoryPath: categoryPathForSlug(slug),
    sellerName: seller?.name || "Relux Seller",
    seller: seller?.name || "Relux Seller",
    updatedAt: product.updatedAt,
  };
}

async function getPublicListings(req, res) {
  try {
    const slug = req.query.category;
    const type = String(req.query.type ?? "").trim().toLowerCase();
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 0, 0), 24);
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

    let listingQuery = Product.find(query)
      .populate("sellerId", "name city")
      .sort({ createdAt: -1 })
      .maxTimeMS(15000);

    if (limit > 0) {
      listingQuery = listingQuery.limit(limit);
    } else {
      listingQuery = listingQuery.limit(24);
    }

    const listings = await listingQuery;
    const nameToSlug = await buildNameToSlugMap();
    const mapped = listings.map((item) => mapPublicListing(item, nameToSlug));

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

    let product = await Product.findOne({
      _id: productId,
      verificationStatus: "approved",
      status: "active",
    }).populate("sellerId", "name city");

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
    res.json({ listing: mapPublicListing(product, nameToSlug) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load listing" });
  }
}

module.exports = { getPublicListings, getPublicListing };

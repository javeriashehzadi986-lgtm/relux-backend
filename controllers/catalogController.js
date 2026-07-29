const Product = require("../models/Product");

const CATEGORY_BY_SLUG = {
  female: "Female",
  male: "Male",
  kids: "Kids",
};

const CATEGORY_PATH = {
  Female: "/femaleFashion",
  Male: "/maleFashion",
  Kids: "/kidsFashion",
};

function mapPublicListing(product) {
  const seller = product.sellerId;
  const sellerId =
    seller && typeof seller === "object"
      ? seller._id?.toString?.() ?? String(seller._id)
      : product.sellerId?.toString?.() ?? product.sellerId;

  return {
    ...product.toPublicJSON(),
    id: product._id.toString(),
    sellerId: sellerId ? String(sellerId) : null,
    categoryPath: CATEGORY_PATH[product.mainCategory] ?? "/categories",
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

    if (slug && CATEGORY_BY_SLUG[slug]) {
      query.mainCategory = CATEGORY_BY_SLUG[slug];
    }

    if (type === "rent") {
      query.listingType = "rent";
    } else if (type === "sale" || type === "resale") {
      query.listingType = "sale";
    }

    let listingQuery = Product.find(query)
      .populate("sellerId", "name city")
      .sort({ createdAt: -1 });

    if (limit > 0) {
      listingQuery = listingQuery.limit(limit);
    }

    const listings = await listingQuery;

    res.json({ listings: listings.map(mapPublicListing) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load catalog" });
  }
}

async function getPublicListing(req, res) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      verificationStatus: "approved",
      status: "active",
    }).populate("sellerId", "name city");

    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }

    res.json({ listing: mapPublicListing(product) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load listing" });
  }
}

module.exports = { getPublicListings, getPublicListing };

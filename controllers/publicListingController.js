const Product = require("../models/Product");
const { resolveMainBySlug } = require("../utils/categoryResolve");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

const publicListingFilter = {
  verificationStatus: "approved",
  status: "active",
};

async function listPublicListings(req, res) {
  try {
    const { category } = req.query;
    const filter = { ...publicListingFilter };

    if (category) {
      const main = await resolveMainBySlug(category);
      if (main?.name) {
        filter.mainCategory = main.name;
      }
    }

    const listings = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ listings: listings.map((listing) => listing.toPublicJSON()) });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getPublicListing(req, res) {
  try {
    const listing = await Product.findOne({
      _id: req.params.id,
      ...publicListingFilter,
    });

    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    res.json({ listing: listing.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = { listPublicListings, getPublicListing };

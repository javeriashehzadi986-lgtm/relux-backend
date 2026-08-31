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

    const listings = await Product.find(filter)
      .select("-gallery")
      .sort({ createdAt: -1 })
      .limit(24)
      .maxTimeMS(12000)
      .lean();

    res.json({
      listings: listings.map((listing) => {
        const mainImage =
          typeof listing.mainImage === "string" && listing.mainImage.length > 50000
            ? ""
            : listing.mainImage;
        return {
          id: listing._id,
          sellerId: listing.sellerId,
          title: listing.title,
          brand: listing.brand,
          description: listing.description,
          listingType: listing.listingType,
          listingSize: listing.listingSize,
          listingCondition: listing.listingCondition,
          mainCategory: listing.mainCategory,
          style: listing.style,
          clothingType: listing.clothingType,
          salePrice: listing.salePrice,
          startingBid: listing.startingBid,
          minBid: listing.minBid,
          auctionEndDate: listing.auctionEndDate,
          rentPrice: listing.rentPrice,
          itemPrice: listing.itemPrice,
          mainImage,
          gallery: [],
          verificationStatus: listing.verificationStatus,
          status: listing.status,
          submittedAt: listing.createdAt,
          reviewedAt: listing.reviewedAt,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getPublicListing(req, res) {
  try {
    const listing = await Product.findOne({
      _id: req.params.id,
      verificationStatus: "approved",
      status: { $in: ["active", "sold"] },
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

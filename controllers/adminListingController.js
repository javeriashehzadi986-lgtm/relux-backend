const Product = require("../models/Product");
const {
  notifyListingApproved,
  notifyListingRejected,
} = require("../services/notificationService");

const CATEGORY_SLUG = {
  Female: "female",
  Male: "male",
  Kids: "kids",
};

function getInitials(name) {
  return String(name || "")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatPrice(listing) {
  if (listing.listingType === "rent") {
    return listing.rentPrice ? `$${listing.rentPrice} / day` : "—";
  }
  return listing.salePrice ? `$${listing.salePrice}` : "—";
}

function mapListingForAdmin(listing) {
  const seller = listing.sellerId;
  const sellerName = seller?.name || "Unknown seller";

  const verificationStatus = listing.verificationStatus;
  const displayStatus =
    verificationStatus === "pending"
      ? "pending"
      : verificationStatus === "rejected"
        ? "removed"
        : listing.status;

  return {
    id: listing._id.toString(),
    title: listing.title,
    image: listing.mainImage,
    sellerInitials: getInitials(sellerName),
    sellerName,
    sellerFullName: sellerName,
    sellerAvatar: null,
    sellerRating: 0,
    sellerReviews: 0,
    category: CATEGORY_SLUG[listing.mainCategory] || "female",
    listingType: listing.listingType,
    price: formatPrice(listing),
    status: displayStatus,
    verificationStatus,
    subcategory: listing.clothingType || listing.style || "General",
    size: listing.listingSize,
    condition: listing.listingCondition,
    description: listing.description,
    gallery: listing.gallery?.length ? listing.gallery : [listing.mainImage],
    extraGalleryCount: Math.max(0, (listing.gallery?.length || 1) - 4),
    brand: listing.brand,
    style: listing.style,
    adminNote: listing.adminNote,
    appliedAt: listing.createdAt?.toISOString().slice(0, 10),
    sellerEmail: seller?.email || "Not linked",
    sellerPhone: seller?.phone || "Not provided",
    sellerCity: seller?.city || "Not provided",
  };
}

async function listListings(req, res) {
  try {
    const statusFilter = req.query.status;
    const query = {};

    if (statusFilter === "pending") {
      query.verificationStatus = "pending";
    } else if (statusFilter === "approved") {
      query.verificationStatus = "approved";
    } else if (statusFilter === "rejected") {
      query.verificationStatus = "rejected";
    }

    const listings = await Product.find(query)
      .populate("sellerId", "name email phone city role status")
      .sort({ createdAt: -1 });

    const mapped = listings.map(mapListingForAdmin);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [pendingReview, approvedThisWeek, rejectedThisWeek] = await Promise.all([
      Product.countDocuments({ verificationStatus: "pending" }),
      Product.countDocuments({ verificationStatus: "approved", reviewedAt: { $gte: weekAgo } }),
      Product.countDocuments({ verificationStatus: "rejected", reviewedAt: { $gte: weekAgo } }),
    ]);

    res.json({
      listings: mapped,
      total: mapped.length,
      stats: {
        pendingReview,
        approvedThisWeek,
        rejectedThisWeek,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load listings" });
  }
}

async function approveListing(req, res) {
  try {
    const listing = await Product.findById(req.params.id).populate(
      "sellerId",
      "name email phone city role status",
    );
    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    listing.verificationStatus = "approved";
    listing.status = "active";
    listing.isAvailable = true;
    listing.reviewedAt = new Date();
    listing.adminNote = "";
    await listing.save();

    const sellerId = listing.sellerId?._id ?? listing.sellerId;
    notifyListingApproved({
      sellerId,
      productTitle: listing.title,
      productId: listing._id,
    });

    res.json({
      message: "Listing approved successfully",
      listing: mapListingForAdmin(listing),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to approve listing" });
  }
}

async function rejectListing(req, res) {
  try {
    const listing = await Product.findById(req.params.id).populate(
      "sellerId",
      "name email phone city role status",
    );
    if (!listing) {
      return res.status(404).json({ message: "Listing not found" });
    }

    listing.verificationStatus = "rejected";
    listing.status = "removed";
    listing.reviewedAt = new Date();
    listing.adminNote = req.body?.adminNote?.trim() || "Listing rejected by admin";
    await listing.save();

    const sellerId = listing.sellerId?._id ?? listing.sellerId;
    notifyListingRejected({
      sellerId,
      productTitle: listing.title,
    });

    res.json({
      message: "Listing rejected",
      listing: mapListingForAdmin(listing),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to reject listing" });
  }
}

module.exports = { listListings, approveListing, rejectListing };

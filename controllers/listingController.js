const Product = require("../models/Product");
const Category = require("../models/Category");
const Order = require("../models/Order");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  if (error.code === 11000 && error.message?.includes("productId")) {
    return "Database index conflict. Restart the backend server once, then try adding the listing again.";
  }
  return error.message || "Something went wrong";
}

async function validateListingBody(body) {
  const { title, listingType, mainCategory, mainImage } = body;

  if (!title?.trim()) {
    return "Title is required";
  }
  if (!listingType || !["sale", "rent"].includes(listingType)) {
    return "Listing type must be sale or rent";
  }
  if (!mainCategory?.trim()) {
    return "Main category is required";
  }

  const main = await Category.findOne({
    type: "main",
    isActive: true,
    name: mainCategory.trim(),
  });
  if (!main) {
    return "Select a valid main category from the list";
  }

  const galleryImages = Array.isArray(body.gallery)
    ? body.gallery.filter((img) => typeof img === "string" && img.trim())
    : [];
  if (galleryImages.length < 4) {
    return "Please add at least 4 pictures from different angles";
  }
  if (!mainImage?.trim()) {
    return "At least one product image is required";
  }
  if (listingType === "sale" && !body.salePrice?.trim()) {
    return "Sale price is required for sale listings";
  }
  if (listingType === "rent" && !body.rentPrice?.trim()) {
    return "Rent price is required for rent listings";
  }
  return null;
}

function buildListingPayload(body) {
  return {
    title: body.title.trim(),
    brand: body.brand?.trim() || "",
    description: body.description?.trim() || "",
    listingType: body.listingType,
    listingSize: body.listingSize?.trim() || "M",
    listingCondition: body.listingCondition?.trim() || "Like New",
    mainCategory: body.mainCategory.trim(),
    style: body.style?.trim() || "",
    clothingType: body.clothingType?.trim() || "",
    salePrice: body.salePrice?.trim() || "",
    startingBid: body.startingBid?.trim() || "",
    minBid: body.minBid?.trim() || "",
    auctionEndDate: body.auctionEndDate?.trim() || "",
    rentPrice: body.rentPrice?.trim() || "",
    itemPrice: body.itemPrice?.trim() || "",
    mainImage: body.mainImage.trim(),
    gallery: Array.isArray(body.gallery) ? body.gallery.filter(Boolean) : [],
    isAvailable: true,
    verificationStatus: "pending",
    status: "pending",
    adminNote: "",
    reviewedAt: null,
  };
}

async function createListing(req, res) {
  try {
    if (req.user.status !== "active") {
      return res.status(403).json({
        message: "Your seller account must be approved before you can publish listings",
      });
    }

    const validationError = await validateListingBody(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const product = await Product.create({
      sellerId: req.user._id,
      ...buildListingPayload(req.body),
    });

    res.status(201).json({
      message: "Listing submitted for admin review",
      listing: product.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getMyListings(req, res) {
  try {
    const listings = await Product.find({
      sellerId: req.user._id,
      status: { $ne: "removed" },
    }).sort({ createdAt: -1 });
    res.json({ listings: listings.map((listing) => listing.toPublicJSON()) });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getListing(req, res) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
      status: { $ne: "removed" },
    });
    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }

    res.json({ listing: product.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function updateListing(req, res) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
      status: { $ne: "removed" },
    });
    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }
    if (product.status === "sold" || product.status === "rented") {
      return res.status(400).json({
        message: "Sold or rented listings cannot be edited",
      });
    }

    const validationError = await validateListingBody(req.body);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    Object.assign(product, buildListingPayload(req.body));
    await product.save();

    res.json({
      message: "Listing updated and sent for admin review",
      listing: product.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function deleteListing(req, res) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
      status: { $ne: "removed" },
    });
    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }
    if (product.status === "sold" || product.status === "rented") {
      return res.status(400).json({
        message: "Sold or rented listings cannot be deleted",
      });
    }

    const activeOrder = await Order.findOne({
      productId: product._id,
      status: { $in: ["pending", "approved"] },
      removedByBuyer: false,
    }).select("_id");

    if (activeOrder) {
      return res.status(400).json({
        message: "This listing has an active order and cannot be deleted yet",
      });
    }

    product.status = "removed";
    product.isAvailable = false;
    await product.save();

    res.json({ message: "Listing deleted" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function updateListingAvailability(req, res) {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
      status: { $ne: "removed" },
    });

    if (!product) {
      return res.status(404).json({ message: "Listing not found" });
    }

    if (product.status === "sold" || product.status === "rented") {
      return res.status(400).json({
        message: "Sold or rented listings cannot be marked available or unavailable manually",
      });
    }

    if (product.verificationStatus !== "approved" || product.status !== "active") {
      return res.status(400).json({
        message: "Only approved active listings can change availability",
      });
    }

    const { isAvailable } = req.body;
    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({ message: "isAvailable must be true or false" });
    }

    product.isAvailable = isAvailable;
    await product.save();

    res.json({
      message: isAvailable ? "Listing is now available" : "Listing marked unavailable",
      listing: product.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = { createListing, getMyListings, getListing, updateListing, deleteListing, updateListingAvailability };

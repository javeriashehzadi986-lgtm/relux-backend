const mongoose = require("mongoose");
const Wishlist = require("../models/Wishlist");
const Product = require("../models/Product");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function normalizeListingType(value) {
  if (value === "rent") return "rent";
  if (value === "sale") return "sale";
  return "resale";
}

function formatProductPrice(product) {
  if (product.listingType === "rent") {
    return product.rentPrice ? `$${product.rentPrice} / day` : "—";
  }
  return product.salePrice ? `$${product.salePrice}` : "—";
}

function parseSortPrice(value) {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

async function assertProductWishlistable(productId) {
  if (!productId) return null;

  const product = await Product.findById(productId);
  if (!product) {
    return "This listing is no longer available";
  }
  if (product.verificationStatus !== "approved") {
    return "Only admin-approved listings can be saved to your wishlist";
  }
  if (product.status !== "active") {
    return "This listing is not available right now";
  }

  return null;
}

function buildWishlistPayload(body) {
  const itemId = String(body.itemId ?? body.id ?? "").trim();
  if (!itemId) {
    return { error: "Item id is required" };
  }

  let productId = null;
  if (body.productId && mongoose.Types.ObjectId.isValid(body.productId)) {
    productId = body.productId;
  } else if (mongoose.Types.ObjectId.isValid(itemId)) {
    productId = itemId;
  }

  return {
    itemId,
    productId,
    title: body.title?.trim() || "Saved item",
    brand: body.brand?.trim() || "",
    image: body.image?.trim() || "",
    listingType: normalizeListingType(body.listingType),
    price: body.price?.trim() || "",
    badge: body.badge?.trim() || "Pre-owned",
    badgeVariant: body.badgeVariant?.trim() || "secondary",
    sortPrice: parseSortPrice(body.sortPrice ?? body.price),
  };
}

async function enrichFromProduct(entry) {
  if (!entry.productId) {
    return entry.toPublicJSON();
  }

  const product = await Product.findOne({
    _id: entry.productId,
    verificationStatus: "approved",
    status: "active",
  });
  if (!product) {
    return entry.toPublicJSON();
  }

  entry.title = product.title;
  entry.brand = product.brand || entry.brand;
  entry.image = product.mainImage || entry.image;
  entry.listingType = product.listingType === "rent" ? "rent" : "sale";
  entry.price = formatProductPrice(product);
  entry.sortPrice = parseSortPrice(
    product.listingType === "rent" ? product.rentPrice : product.salePrice,
  );
  await entry.save();

  return entry.toPublicJSON();
}

async function getMyWishlist(req, res) {
  try {
    const entries = await Wishlist.find({ userId: req.user._id }).sort({ createdAt: -1 });
    const items = await Promise.all(entries.map((entry) => enrichFromProduct(entry)));

    res.json({
      items,
      ids: items.map((item) => item.id),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function upsertWishlistEntry(userId, payload) {
  return Wishlist.findOneAndUpdate(
    { userId, itemId: payload.itemId },
    { $set: { userId, ...payload } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function addWishlistItem(req, res) {
  try {
    const payload = buildWishlistPayload(req.body);
    if (payload.error) {
      return res.status(400).json({ message: payload.error });
    }

    const productError = await assertProductWishlistable(payload.productId);
    if (productError) {
      return res.status(400).json({ message: productError });
    }

    const entry = await upsertWishlistEntry(req.user._id, payload);
    const item = await enrichFromProduct(entry);
    res.status(201).json({ message: "Added to wishlist", item, saved: true });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.userId && !error?.keyPattern?.itemId) {
      return res.status(503).json({
        message:
          "Wishlist database index is outdated. Run: node scripts/fix-wishlist-index.js in the Backend folder, then restart the server.",
        code: "WISHLIST_INDEX_OUTDATED",
      });
    }
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function removeWishlistItem(req, res) {
  try {
    const itemId = String(req.params.itemId ?? "").trim();
    if (!itemId) {
      return res.status(400).json({ message: "Item id is required" });
    }

    const entry = await Wishlist.findOneAndDelete({
      userId: req.user._id,
      itemId,
    });

    if (!entry) {
      return res.status(404).json({ message: "Wishlist item not found" });
    }

    res.json({ message: "Removed from wishlist", itemId, saved: false });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function toggleWishlistItem(req, res) {
  try {
    const payload = buildWishlistPayload(req.body);
    if (payload.error) {
      return res.status(400).json({ message: payload.error });
    }

    const existing = await Wishlist.findOne({
      userId: req.user._id,
      itemId: payload.itemId,
    });

    if (existing) {
      await existing.deleteOne();
      return res.json({
        message: "Removed from wishlist",
        itemId: payload.itemId,
        saved: false,
      });
    }

    const productError = await assertProductWishlistable(payload.productId);
    if (productError) {
      return res.status(400).json({ message: productError });
    }

    const entry = await upsertWishlistEntry(req.user._id, payload);

    const item = await enrichFromProduct(entry);
    res.status(201).json({
      message: "Added to wishlist",
      item,
      saved: true,
    });
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.userId && !error?.keyPattern?.itemId) {
      return res.status(503).json({
        message:
          "Wishlist database index is outdated. Run: node scripts/fix-wishlist-index.js in the Backend folder, then restart the server.",
        code: "WISHLIST_INDEX_OUTDATED",
      });
    }
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  getMyWishlist,
  addWishlistItem,
  removeWishlistItem,
  toggleWishlistItem,
};

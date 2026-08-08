const Order = require("../models/Order");
const Product = require("../models/Product");
const {
  notifyRentalRequest,
  notifyRentalCancelled,
} = require("../services/notificationService");

function getErrorMessage(error) {
  if (error.code === 11000) {
    return "Could not save this order. Please try again.";
  }
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function getRentalDays(start, end) {
  if (!start || !end) return 1;
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const diff = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff + 1);
}

/** Buyer: create or update a rental request for a product */
async function createRentalRequest(req, res) {
  try {
    if (req.user.role !== "buyer") {
      return res.status(403).json({ message: "Only buyers can place rental requests" });
    }

    const { productId, size, rentStart, rentEnd } = req.body;
    if (!productId) {
      return res.status(400).json({ message: "Product is required" });
    }
    if (!rentStart || !rentEnd) {
      return res.status(400).json({ message: "Rental start and end dates are required" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (product.verificationStatus !== "approved" || product.status !== "active") {
      return res.status(400).json({ message: "This listing is not available for rental" });
    }
    if (product.listingType !== "rent") {
      return res.status(400).json({ message: "This listing is not a rental item" });
    }
    if (!product.sellerId) {
      return res.status(400).json({ message: "This listing has no seller linked" });
    }

    const rentalDays = getRentalDays(rentStart, rentEnd);
    const existing = await Order.findOne({
      buyerId: req.user._id,
      productId: product._id,
      type: "rental",
      status: { $in: ["pending", "cancelled", "rejected"] },
      removedByBuyer: false,
    }).sort({ updatedAt: -1 });

    let order;
    if (existing) {
      existing.size = size?.trim() || existing.size || "M";
      existing.rentStart = rentStart;
      existing.rentEnd = rentEnd;
      existing.rentalDays = rentalDays;
      existing.status = "pending";
      existing.buyerName = req.user.name;
      existing.removedByBuyer = false;
      await existing.save();
      order = existing;
    } else {
      order = await Order.create({
        buyerId: req.user._id,
        sellerId: product.sellerId,
        productId: product._id,
        type: "rental",
        status: "pending",
        size: size?.trim() || product.listingSize || "M",
        rentStart,
        rentEnd,
        rentalDays,
        buyerName: req.user.name,
      });
    }

    notifyRentalRequest({
      sellerId: product.sellerId,
      productTitle: product.title,
      orderId: order._id,
    });

    res.status(201).json({
      message: "Rental request submitted",
      order: order.toBuyerJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getMyBuyerOrders(req, res) {
  try {
    const orders = await Order.find({
      buyerId: req.user._id,
      removedByBuyer: false,
    })
      .populate("productId", "title")
      .populate("sellerId", "name")
      .sort({ createdAt: -1 });

    res.json({
      orders: orders.map((order) => {
        const json = order.toBuyerJSON();
        const product = order.productId;
        const seller = order.sellerId;
        return {
          ...json,
          productTitle:
            (product && typeof product === "object" && product.title) || "",
          sellerName:
            (seller && typeof seller === "object" && seller.name) || "",
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function cancelMyOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
      removedByBuyer: false,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({ message: "Only pending requests can be cancelled" });
    }

    order.status = "cancelled";
    await order.save();

    const product = await Product.findById(order.productId).select("title sellerId");
    if (product) {
      notifyRentalCancelled({
        sellerId: product.sellerId,
        productTitle: product.title,
      });
    }

    res.json({ message: "Request cancelled", order: order.toBuyerJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function removeMyOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.status !== "cancelled" && order.status !== "rejected") {
      return res.status(400).json({
        message: "Only cancelled or rejected orders can be removed from your list",
      });
    }

    order.removedByBuyer = true;
    await order.save();

    res.json({ message: "Order removed from your list" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  createRentalRequest,
  getMyBuyerOrders,
  cancelMyOrder,
  removeMyOrder,
};

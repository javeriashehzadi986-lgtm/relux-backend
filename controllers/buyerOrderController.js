const Order = require("../models/Order");
const Product = require("../models/Product");
const {
  notifyRentalRequest,
  notifyRentalCancelled,
  notifyBuyerConfirmedReceipt,
  notifyBuyerMarkedReturn,
  notifyBuyerReturnInstructions,
  notifySaleEscrowReleased,
} = require("../services/notificationService");
const {
  FULFILLMENT,
  ensurePaid,
} = require("../services/orderStatusService");
const { releaseSaleEscrow } = require("../services/escrowService");

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

    // Approved + unpaid rentals must be cancelled (or reused) before a new request.
    const activeApproved = await Order.findOne({
      buyerId: req.user._id,
      productId: product._id,
      type: "rental",
      status: "approved",
      paymentStatus: { $ne: "paid" },
      removedByBuyer: false,
    }).sort({ updatedAt: -1 });

    if (activeApproved) {
      // Reuse: update dates and send back for seller approval.
      activeApproved.size = size?.trim() || activeApproved.size || "M";
      activeApproved.rentStart = rentStart;
      activeApproved.rentEnd = rentEnd;
      activeApproved.rentalDays = rentalDays;
      activeApproved.status = "pending";
      activeApproved.buyerName = req.user.name;
      activeApproved.removedByBuyer = false;
      await activeApproved.save();

      // Close any duplicate unpaid rental rows for the same product.
      await Order.updateMany(
        {
          _id: { $ne: activeApproved._id },
          buyerId: req.user._id,
          productId: product._id,
          type: "rental",
          status: { $in: ["pending", "approved"] },
          paymentStatus: { $ne: "paid" },
          removedByBuyer: false,
        },
        { $set: { status: "cancelled" } },
      );

      notifyRentalRequest({
        sellerId: product.sellerId,
        productTitle: product.title,
        orderId: activeApproved._id,
        rentalDays,
        rentStart,
        rentEnd,
      });

      return res.status(201).json({
        message: "Rental request updated with new dates — waiting for seller approval",
        order: activeApproved.toBuyerJSON(),
      });
    }

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
      rentalDays,
      rentStart,
      rentEnd,
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
      .populate("productId", "title mainImage gallery brand listingType status isAvailable verificationStatus")
      .populate("sellerId", "name")
      .sort({ createdAt: -1 });

    res.json({
      orders: orders.map((order) => order.toBuyerJSON()),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getMyBuyerOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
      removedByBuyer: false,
    })
      .populate("productId", "title mainImage gallery brand listingType status isAvailable verificationStatus")
      .populate("sellerId", "name");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const json = order.toBuyerJSON();
    const product = order.productId;
    const seller = order.sellerId;

    res.json({
      order: {
        ...json,
        productTitle:
          (product && typeof product === "object" && product.title) || "",
        sellerName:
          (seller && typeof seller === "object" && seller.name) || "",
      },
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

    const isPending = order.status === "pending";
    const isApprovedUnpaidRental =
      order.type === "rental" &&
      order.status === "approved" &&
      order.paymentStatus !== "paid";

    if (!isPending && !isApprovedUnpaidRental) {
      return res.status(400).json({
        message:
          "Only pending requests or approved rentals that are not paid yet can be cancelled",
      });
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

async function confirmReceivedOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "approved") {
      return res.status(400).json({ message: "Only approved orders can be confirmed" });
    }
    ensurePaid(order);

    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (fs !== FULFILLMENT.SHIPPED) {
      return res.status(400).json({
        message: "Seller must ship the order before you can confirm receipt",
      });
    }

    order.fulfillmentStatus = FULFILLMENT.DELIVERED;
    order.deliveryConfirmedAt = new Date();

    if (order.escrowSettlementStatus === "disputed") {
      return res.status(400).json({
        message: "Escrow is frozen while admin reviews your delivery dispute",
      });
    }

    if (order.type === "sale" && order.escrowStatus === "held") {
      await order.save();
      const result = await releaseSaleEscrow(order, {}, "buyer_confirmed");
      const product = await Product.findById(order.productId).select("title");
      notifyBuyerConfirmedReceipt({
        sellerId: order.sellerId,
        productTitle: product?.title ?? "your item",
        orderId: order._id,
      });
      notifySaleEscrowReleased({
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        productTitle: product?.title ?? "purchase",
        orderId: order._id,
        refundLabel: "",
        sellerPayoutLabel: `PKR ${(result.sellerPayoutPkr || 0).toLocaleString("en-PK")}`,
        transferSent: Boolean(result.stripeTransferId),
      });
      return res.json({
        message: "Receipt confirmed — payment released to seller",
        order: result.order.toBuyerJSON(),
      });
    }

    await order.save();

    const product = await Product.findById(order.productId).select("title");
    notifyBuyerConfirmedReceipt({
      sellerId: order.sellerId,
      productTitle: product?.title ?? "your item",
      orderId: order._id,
    });

    notifyBuyerReturnInstructions({
      buyerId: order.buyerId,
      order,
      productTitle: product?.title ?? "your rental",
    });

    const fresh = await Order.findById(order._id)
      .populate("productId", "title mainImage gallery brand listingType status isAvailable verificationStatus")
      .populate("sellerId", "name");

    res.json({
      message: "Receipt confirmed",
      order: fresh ? fresh.toBuyerJSON() : order.toBuyerJSON(),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

async function markReturnedOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      buyerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.type !== "rental") {
      return res.status(400).json({ message: "Returns only apply to rental orders" });
    }
    if (order.status !== "approved") {
      return res.status(400).json({ message: "Only active rentals can be returned" });
    }
    ensurePaid(order);

    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (fs !== FULFILLMENT.DELIVERED) {
      return res.status(400).json({
        message: "Confirm that you received the order before marking it as returned",
      });
    }

    order.fulfillmentStatus = FULFILLMENT.RETURNED;
    order.returnConfirmedAt = new Date();
    await order.save();

    const product = await Product.findById(order.productId).select("title");
    notifyBuyerMarkedReturn({
      sellerId: order.sellerId,
      productTitle: product?.title ?? "your item",
      orderId: order._id,
    });

    const fresh = await Order.findById(order._id)
      .populate("productId", "title mainImage gallery brand listingType status isAvailable verificationStatus")
      .populate("sellerId", "name");

    res.json({
      message: "Return recorded",
      order: fresh ? fresh.toBuyerJSON() : order.toBuyerJSON(),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

module.exports = {
  createRentalRequest,
  getMyBuyerOrders,
  getMyBuyerOrder,
  cancelMyOrder,
  removeMyOrder,
  confirmReceivedOrder,
  markReturnedOrder,
};

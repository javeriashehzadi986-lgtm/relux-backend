const Order = require("../models/Order");
const Product = require("../models/Product");
const {
  notifyBookingConfirmed,
  notifyBookingRejected,
  notifyRentalCompleted,
  notifyEscrowReleased,
} = require("../services/notificationService");
const {
  FULFILLMENT,
  ensurePaid,
  syncProductForOrder,
} = require("../services/orderStatusService");
const { releaseRentalEscrow, formatPkr } = require("../services/escrowService");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

async function getMySellerOrders(req, res) {
  try {
    const orders = await Order.find({
      sellerId: req.user._id,
      status: { $nin: ["cancelled"] },
    })
      .populate("buyerId", "name email")
      .populate("productId", "title mainImage gallery brand listingType")
      .sort({ createdAt: -1 });

    // Rejected can stay briefly or be hidden — hide rejected from active seller inbox
    const visible = orders.filter((order) => order.status !== "rejected");

    res.json({ orders: visible.map((order) => order.toSellerJSON()) });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function approveOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    }).populate("buyerId", "name email");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({ message: "Only pending requests can be approved" });
    }

    const product = await Product.findById(order.productId).select(
      "title rentPrice itemPrice",
    );

    const parseAmount = (value) =>
      Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;

    const deposit = parseAmount(product?.itemPrice);
    const rentTotal =
      parseAmount(product?.rentPrice) * Math.max(1, Number(order.rentalDays) || 1);
    // Charge security deposit (matches rental page “Paid Today”); fall back to rent total
    const amountPkr = deposit > 0 ? deposit : rentTotal;

    order.status = "approved";
    if (order.type === "rental") {
      order.paymentStatus = "pending";
      order.paymentProvider = "stripe";
      order.amountPkr = amountPkr;
      order.itemAmountPkr = amountPkr;
      order.deliveryChargesPkr = 0;
    }
    await order.save();

    notifyBookingConfirmed({
      buyerId: order.buyerId,
      productTitle: product?.title ?? "your dress",
      orderId: order._id,
    });

    res.json({ message: "Request approved", order: order.toSellerJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function rejectOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({ message: "Only pending requests can be rejected" });
    }

    order.status = "rejected";
    await order.save();
    await syncProductForOrder(order);

    const product = await Product.findById(order.productId).select("title");
    notifyBookingRejected({
      buyerId: order.buyerId,
      productTitle: product?.title ?? "your dress",
    });

    res.json({ message: "Request rejected" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function completeOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    }).populate("buyerId", "name email");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "approved") {
      return res.status(400).json({ message: "Only approved orders can be completed" });
    }
    ensurePaid(order);

    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (order.type === "sale" && fs !== FULFILLMENT.DELIVERED) {
      return res.status(400).json({
        message: "Mark the order as shipped and wait for buyer confirmation before completing",
      });
    }
    if (order.type === "rental" && fs !== FULFILLMENT.RETURNED) {
      return res.status(400).json({
        message: "Buyer must mark the item as returned before you can complete this rental",
      });
    }
    if (order.type === "rental" && order.escrowStatus !== "released") {
      return res.status(400).json({
        message: "Confirm return received to release escrow before completing this rental",
      });
    }

    order.status = "completed";
    await order.save();
    await syncProductForOrder(order);

    const product = await Product.findById(order.productId).select("title");
    notifyRentalCompleted({
      buyerId: order.buyerId,
      productTitle: product?.title ?? "your dress",
    });

    res.json({ message: "Order completed", order: order.toSellerJSON() });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

async function shipOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "approved") {
      return res.status(400).json({ message: "Only approved orders can be shipped" });
    }
    ensurePaid(order);

    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (fs !== FULFILLMENT.PROCESSING) {
      return res.status(400).json({ message: "This order has already been shipped" });
    }

    order.fulfillmentStatus = FULFILLMENT.SHIPPED;
    await order.save();

    res.json({ message: "Order marked as shipped", order: order.toSellerJSON() });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

async function confirmReturnOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    }).populate("productId", "title itemPrice rentPrice");

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
    if (fs !== FULFILLMENT.RETURNED) {
      return res.status(400).json({
        message: "Buyer must mark the item as returned before you confirm receipt",
      });
    }
    if (order.escrowStatus === "released") {
      return res.json({
        message: "Escrow already released for this order",
        order: order.toSellerJSON(),
      });
    }

    const result = await releaseRentalEscrow(order);
    const product = order.productId;

    notifyEscrowReleased({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "rental item",
      orderId: order._id,
      refundLabel: formatPkr(result.refundAmountPkr),
      rentalChargeLabel: formatPkr(result.rentalChargePkr),
    });

    res.json({
      message:
        result.refundAmountPkr > 0
          ? `Return confirmed — ${formatPkr(result.refundAmountPkr)} refunded to buyer`
          : "Return confirmed — escrow settled",
      order: result.order.toSellerJSON(),
      escrow: {
        rentalChargePkr: result.rentalChargePkr,
        refundAmountPkr: result.refundAmountPkr,
      },
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

module.exports = {
  getMySellerOrders,
  approveOrder,
  rejectOrder,
  completeOrder,
  shipOrder,
  confirmReturnOrder,
};

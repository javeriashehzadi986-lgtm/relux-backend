const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const {
  notifyBookingConfirmed,
  notifyBookingRejected,
  notifyRentalCompleted,
  notifyBuyerOrderShipped,
  notifySellerConfirmedReturn,
  notifyEscrowReleased,
} = require("../services/notificationService");
const {
  FULFILLMENT,
  ensurePaid,
  syncProductForOrder,
} = require("../services/orderStatusService");
const {
  SALE_AUTO_RELEASE_MS,
  releaseRentalEscrow,
  formatPkr,
} = require("../services/escrowService");
const { emitOrderUpdated } = require("../services/orderSocketService");

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
      // Won-auction sale orders are seller-visible only once the buyer has paid —
      // the sale flow needs no seller approval, so hide the unpaid placeholder.
      $nor: [{ type: "sale", paymentStatus: { $in: ["unpaid", "pending"] } }],
    })
      .populate("buyerId", "name email")
      .populate("productId", "title mainImage gallery brand listingType status isAvailable verificationStatus")
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
    if (order.type === "sale") {
      return res.status(400).json({
        message: "Sale orders are confirmed automatically once the buyer pays",
      });
    }

    const product = await Product.findById(order.productId).select(
      "title rentPrice itemPrice",
    );

    const parseAmount = (value) =>
      Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;

const DEFAULT_DELIVERY_PKR = 300;

    const deposit = parseAmount(product?.itemPrice);
    const rentTotal =
      parseAmount(product?.rentPrice) * Math.max(1, Number(order.rentalDays) || 1);
    // Charge security deposit (matches rental page “Paid Today”); fall back to rent total
    const itemAmountPkr = deposit > 0 ? deposit : rentTotal;
    const deliveryChargesPkr = DEFAULT_DELIVERY_PKR;
    const amountPkr = itemAmountPkr + deliveryChargesPkr;

    order.status = "approved";
    if (order.type === "rental") {
      order.paymentStatus = "pending";
      order.paymentProvider = "stripe";
      order.amountPkr = amountPkr;
      order.itemAmountPkr = itemAmountPkr;
      order.deliveryChargesPkr = deliveryChargesPkr;
    }
    await order.save();
    emitOrderUpdated(order);

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
    if (order.type === "sale") {
      return res.status(400).json({
        message: "Sale orders cannot be rejected by the seller",
      });
    }

    order.status = "rejected";
    await order.save();
    await syncProductForOrder(order);
    emitOrderUpdated(order);

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
        message: "Buyer must confirm receipt before you can complete this sale",
      });
    }
    if (order.type === "sale" && order.escrowStatus !== "released") {
      return res.status(400).json({
        message: "Payment must be released from escrow before completing this sale",
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
    emitOrderUpdated(order);

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

    if (order.type === "rental") {
      const seller = await User.findById(req.user._id).select(
        "name email phone city returnContactName returnPhone returnCity returnAddress",
      );
      if (!seller?.hasCompleteReturnContact()) {
        return res.status(400).json({
          message:
            "Add your return contact (name, phone, city, address) in Seller Profile before shipping rentals",
        });
      }
      const snapshot = seller.getReturnContactSnapshot?.();
      if (snapshot) {
        order.sellerReturnContact = snapshot;
      }
    }

    order.fulfillmentStatus = FULFILLMENT.SHIPPED;
    order.shippedAt = new Date();
    if (order.type === "sale" && order.escrowStatus === "held") {
      order.saleEscrowAutoReleaseAt = new Date(Date.now() + SALE_AUTO_RELEASE_MS);
    }
    await order.save();

    const product = await Product.findById(order.productId).select("title");
    notifyBuyerOrderShipped({
      buyerId: order.buyerId,
      productTitle: product?.title ?? "your order",
      orderId: order._id,
      orderType: order.type,
    });

    const fresh = await Order.findById(order._id)
      .populate("productId", "title mainImage gallery brand listingType status isAvailable verificationStatus")
      .populate("buyerId", "name")
      .populate("sellerId", "name");

    emitOrderUpdated(fresh || order);

    res.json({
      message: "Order marked as shipped",
      order: fresh ? fresh.toSellerJSON() : order.toSellerJSON(),
    });
  } catch (error) {
    res.status(400).json({ message: error.message || getErrorMessage(error) });
  }
}

async function confirmReturnReceived(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
      type: "rental",
    }).populate("productId", "title itemPrice rentPrice");

    if (!order) {
      return res.status(404).json({ message: "Rental order not found" });
    }
    if (order.status !== "approved") {
      return res.status(400).json({ message: "Only active rentals can confirm a return" });
    }
    ensurePaid(order);

    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (fs !== FULFILLMENT.RETURNED) {
      return res.status(400).json({
        message: "Buyer must mark the item as returned before you can confirm it",
      });
    }

    if (order.escrowSettlementStatus === "disputed") {
      return res.status(400).json({
        message: "This return is under admin dispute review. Escrow cannot be released here.",
      });
    }

    if (order.escrowStatus === "released") {
      return res.json({
        message: "Return already confirmed and escrow released",
        order: order.toSellerJSON(),
      });
    }

    order.sellerConfirmedReturnAt = order.sellerConfirmedReturnAt || new Date();
    order.returnConfirmedAt = order.returnConfirmedAt || new Date();
    order.escrowSettlementStatus = "accepted";
    order.settlementAcceptedAt = new Date();
    order.damageDeductionPkr = 0;
    order.lateFeePkr = 0;
    await order.save();

    // Happy-path return: seller gets (rentPrice × rentalDays) + delivery charged at checkout.
    // Buyer gets the rest of the dress deposit back. No separate "daily rate" charge at pay time.
    const product = order.productId;
    const result = await releaseRentalEscrow(order, {
      damageDeductionPkr: 0,
      lateFeePkr: 0,
    });

    notifySellerConfirmedReturn({
      buyerId: order.buyerId,
      productTitle: product?.title ?? "your rental item",
      orderId: order._id,
    });

    notifyEscrowReleased({
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      productTitle: product?.title ?? "rental item",
      orderId: order._id,
      refundLabel: formatPkr(result.refundAmountPkr),
      rentalChargeLabel: formatPkr(result.rentalChargePkr),
      sellerPayoutLabel: formatPkr(result.sellerPayoutPkr),
      transferSent: Boolean(result.stripeTransferId),
    });

    emitOrderUpdated(result.order || order);

    let message =
      result.refundAmountPkr > 0
        ? `Return confirmed — escrow released. ${formatPkr(result.refundAmountPkr)} refunded to buyer.`
        : "Return confirmed — escrow released to seller.";

    if (result.sellerPayoutPkr > 0 && result.stripeTransferId) {
      message += ` ${formatPkr(result.sellerPayoutPkr)} sent to your Stripe Connect account (rental for ${order.rentalDays || 1} day(s) + delivery).`;
    } else if (result.sellerPayoutPkr > 0 && result.transferSkipped) {
      message += ` Seller payout ${formatPkr(result.sellerPayoutPkr)} was recorded but not transferred yet${
        result.transferMessage ? `: ${result.transferMessage}` : "."
      }`;
    }

    res.json({
      message,
      order: result.order.toSellerJSON(),
      payout: {
        sellerPayoutPkr: result.sellerPayoutPkr,
        transferId: result.stripeTransferId || "",
        transferSkipped: Boolean(result.transferSkipped),
        transferMessage: result.transferMessage || "",
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
  confirmReturnReceived,
};

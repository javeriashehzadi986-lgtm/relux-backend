const Order = require("../models/Order");
const Product = require("../models/Product");

const FULFILLMENT = {
  PROCESSING: "processing",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  RETURNED: "returned",
};

function isRentalPeriodComplete(rentEnd) {
  if (!rentEnd) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(`${rentEnd}T12:00:00`);
  end.setHours(0, 0, 0, 0);
  return today > end;
}

function getReturnAvailableLabel(rentEnd) {
  if (!rentEnd) return "Return available after rental ends";
  const end = new Date(`${rentEnd}T12:00:00`);
  const available = new Date(end);
  available.setDate(available.getDate() + 1);
  return `Available from ${available.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function getFulfillmentLabel(order) {
  const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
  if (order.status === "completed") {
    return order.type === "rental" ? "Rental Completed" : "Delivered";
  }
  if (order.status === "cancelled" || order.status === "rejected") {
    return order.status === "rejected" ? "Rejected" : "Cancelled";
  }
  if (order.status === "pending") {
    return order.type === "sale" ? "Awaiting Payment" : "Awaiting Approval";
  }
  if (order.type === "rental" && order.paymentStatus !== "paid") {
    return "Awaiting Payment";
  }

  const labels = {
    processing: "Processing",
    shipped: "Shipped",
    delivered: order.type === "rental" ? "Received by Buyer" : "Delivered",
    returned: "Returned by Buyer",
  };
  return labels[fs] || "Processing";
}

function getFulfillmentVariant(order) {
  if (order.status === "pending") return "pending";
  if (order.status === "completed") return "completed";
  if (order.status === "cancelled" || order.status === "rejected") return "cancelled";
  return order.fulfillmentStatus || FULFILLMENT.PROCESSING;
}

async function syncProductForOrder(order) {
  const product = await Product.findById(order.productId);
  if (!product) return null;

  if (order.status === "cancelled" || order.status === "rejected") {
    if (order.paymentStatus !== "paid") {
      const blocking = await Order.findOne({
        productId: order.productId,
        _id: { $ne: order._id },
        status: { $in: ["pending", "approved"] },
        paymentStatus: "paid",
        removedByBuyer: false,
      });
      if (!blocking && (product.status === "rented" || product.status === "sold")) {
        product.status = "active";
        product.isAvailable = true;
        await product.save();
      }
    }
    return product;
  }

  if (order.status === "completed") {
    if (order.type === "rental") {
      const activeRental = await Order.findOne({
        productId: order.productId,
        _id: { $ne: order._id },
        type: "rental",
        status: "approved",
        paymentStatus: "paid",
        removedByBuyer: false,
      });
      if (!activeRental) {
        product.status = "active";
        product.isAvailable = true;
        await product.save();
      }
    }
    return product;
  }

  if (order.status === "approved" && order.paymentStatus === "paid") {
    product.status = order.type === "rental" ? "rented" : "sold";
    product.isAvailable = false;
    await product.save();
  }

  return product;
}

function ensurePaid(order) {
  if (order.paymentStatus !== "paid") {
    throw new Error("Payment must be completed before updating fulfillment status");
  }
}

module.exports = {
  FULFILLMENT,
  getFulfillmentLabel,
  getFulfillmentVariant,
  isRentalPeriodComplete,
  getReturnAvailableLabel,
  syncProductForOrder,
  ensurePaid,
};

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
  const Order = require("../models/Order");
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

    if (order.type === "sale" && order.paymentStatus === "refunded") {
      const blockingSale = await Order.findOne({
        productId: order.productId,
        _id: { $ne: order._id },
        type: "sale",
        status: { $in: ["pending", "approved"] },
        paymentStatus: "paid",
        removedByBuyer: false,
      });
      if (!blockingSale && (product.status === "sold" || !product.isAvailable)) {
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

function formatPkrShort(amount) {
  return `PKR ${Math.round(Number(amount) || 0).toLocaleString("en-PK")}`;
}

function getOrderTotalPaidPkr(order) {
  if (order.type === "sale") {
    return Number(order.amountPkr) || Number(order.itemAmountPkr) || 0;
  }
  return Number(order.amountPkr) || 0;
}

function getPaymentLabel(order) {
  const status = order.paymentStatus || "unpaid";

  if (status === "unpaid") return "Unpaid";
  if (status === "pending") return "Payment Pending";
  if (status === "failed") return "Payment Failed";

  if (status === "refunded") {
    if (order.refundAmountPkr > 0) {
      return `Refunded (${formatPkrShort(order.refundAmountPkr)})`;
    }
    return "Refunded";
  }

  if (order.escrowStatus === "released") {
    const refund = Number(order.refundAmountPkr) || 0;
    const payout = Number(order.sellerPayoutPkr) || 0;

    if (refund > 0 && payout > 0) {
      return `Settled — ${formatPkrShort(refund)} refunded, ${formatPkrShort(payout)} to seller`;
    }
    if (refund > 0) {
      return `Settled — ${formatPkrShort(refund)} refunded to buyer`;
    }
    if (payout > 0) {
      return `Settled — ${formatPkrShort(payout)} paid to seller`;
    }
    return "Paid — escrow settled";
  }

  if (order.escrowStatus === "held") {
    if (order.escrowSettlementStatus === "disputed") {
      return "Paid — held (dispute under review)";
    }
    if (order.escrowSettlementStatus === "proposed") {
      return "Paid — settlement proposed";
    }
    return "Paid — held in escrow";
  }

  if (order.escrowStatus === "failed") {
    return "Paid — escrow release failed";
  }

  return "Paid";
}

function syncPaymentStatusAfterEscrowRelease(order) {
  if (order.escrowStatus !== "released") return;

  const totalPaid = getOrderTotalPaidPkr(order);
  const refund = Number(order.refundAmountPkr) || 0;

  if (refund > 0 && totalPaid > 0 && refund >= totalPaid) {
    order.paymentStatus = "refunded";
    if (!order.refundedAt) {
      order.refundedAt = new Date();
    }
  } else if (order.paymentStatus !== "refunded") {
    order.paymentStatus = "paid";
  }
}

/** Mark order complete and sync listing availability after escrow funds are released. */
async function finalizeOrderAfterEscrowRelease(order) {
  if (order.escrowStatus !== "released") return null;

  syncPaymentStatusAfterEscrowRelease(order);

  if (order.type === "rental") {
    if (order.fulfillmentStatus !== FULFILLMENT.RETURNED) {
      order.fulfillmentStatus = FULFILLMENT.RETURNED;
    }
    if (!order.returnConfirmedAt) {
      order.returnConfirmedAt = new Date();
    }
  }

  if (order.type === "sale") {
    const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
    if (fs !== FULFILLMENT.DELIVERED) {
      order.fulfillmentStatus = FULFILLMENT.DELIVERED;
    }
    if (!order.deliveryConfirmedAt) {
      order.deliveryConfirmedAt = new Date();
    }
  }

  if (order.status !== "completed") {
    order.status = "completed";
  }

  await order.save();
  return syncProductForOrder(order);
}

function ensurePaid(order) {
  if (order.paymentStatus !== "paid") {
    throw new Error("Payment must be completed before updating fulfillment status");
  }
}

function formatTrackingDate(date) {
  if (!date) return "Pending";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Pending";
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildOrderLogistics(order) {
  const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
  const steps = [];

  steps.push({
    key: "placed",
    label: "Order placed",
    date: formatTrackingDate(order.createdAt),
    active: false,
    completed: true,
  });

  if (order.status === "cancelled" || order.status === "rejected") {
    steps.push({
      key: "closed",
      label: order.status === "rejected" ? "Order rejected" : "Order cancelled",
      date: formatTrackingDate(order.updatedAt),
      active: true,
      completed: true,
    });
    return steps;
  }

  if (order.status === "pending") {
    steps.push({
      key: "pending",
      label: order.type === "sale" ? "Awaiting payment" : "Awaiting seller approval",
      date: formatTrackingDate(order.updatedAt),
      active: true,
      completed: false,
    });
    return steps;
  }

  if (order.type === "rental" && order.paymentStatus !== "paid") {
    steps.push({
      key: "awaiting-deposit",
      label: "Seller approved — awaiting security deposit",
      date: formatTrackingDate(order.updatedAt),
      active: true,
      completed: false,
    });
    return steps;
  }

  if (order.paymentStatus === "paid") {
    steps.push({
      key: "paid",
      label: order.type === "sale" ? "Payment confirmed" : "Security deposit paid",
      date: formatTrackingDate(order.paidAt),
      active: fs === FULFILLMENT.PROCESSING,
      completed: true,
    });
  }

  const shippedDone =
    fs === FULFILLMENT.SHIPPED ||
    fs === FULFILLMENT.DELIVERED ||
    fs === FULFILLMENT.RETURNED ||
    Boolean(order.shippedAt);

  if (shippedDone || fs === FULFILLMENT.PROCESSING) {
    steps.push({
      key: "shipped",
      label: order.type === "rental" ? "Shipped to buyer" : "Shipped to buyer",
      date: formatTrackingDate(order.shippedAt),
      active: fs === FULFILLMENT.SHIPPED,
      completed: shippedDone,
    });
  }

  const deliveredDone =
    fs === FULFILLMENT.DELIVERED ||
    fs === FULFILLMENT.RETURNED ||
    Boolean(order.deliveryConfirmedAt);

  if (deliveredDone) {
    steps.push({
      key: "delivered",
      label: order.type === "rental" ? "Received by buyer" : "Delivered to buyer",
      date: formatTrackingDate(order.deliveryConfirmedAt),
      active: fs === FULFILLMENT.DELIVERED,
      completed: deliveredDone,
    });
  }

  if (fs === FULFILLMENT.RETURNED || order.returnConfirmedAt) {
    steps.push({
      key: "returned",
      label: "Returned by buyer",
      date: formatTrackingDate(order.returnConfirmedAt || order.updatedAt),
      active: fs === FULFILLMENT.RETURNED && order.status !== "completed",
      completed: fs === FULFILLMENT.RETURNED,
    });
  }

  if (order.status === "completed") {
    steps.push({
      key: "completed",
      label: order.type === "rental" ? "Rental completed" : "Order completed",
      date: formatTrackingDate(order.updatedAt),
      active: true,
      completed: true,
    });
    return steps;
  }

  if (!steps.some((step) => step.active)) {
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (!steps[index].completed) {
        steps[index].active = true;
        break;
      }
      if (index === 0) {
        steps[steps.length - 1].active = true;
      }
    }
  }

  return steps;
}

module.exports = {
  FULFILLMENT,
  getFulfillmentLabel,
  getFulfillmentVariant,
  getPaymentLabel,
  syncPaymentStatusAfterEscrowRelease,
  isRentalPeriodComplete,
  getReturnAvailableLabel,
  syncProductForOrder,
  finalizeOrderAfterEscrowRelease,
  ensurePaid,
  buildOrderLogistics,
  formatTrackingDate,
};

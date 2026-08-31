const Order = require("../models/Order");
const {
  getFulfillmentLabel,
  syncProductForOrder,
} = require("../services/orderStatusService");
const { getEscrowLabel } = require("../services/escrowService");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "—";
  const str = String(value).trim();
  if (str.startsWith("$") || str.startsWith("PKR")) return str;
  const num = Number(str.replace(/[^0-9.]/g, ""));
  if (Number.isNaN(num)) return str;
  return `PKR ${Math.round(num).toLocaleString("en-PK")}`;
}

function formatPkrAmount(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) return null;
  return `PKR ${Math.round(num).toLocaleString("en-PK")}`;
}

function resolveSalePaymentStatus(order) {
  if (order.paymentStatus === "paid") return "paid";
  if (order.paymentStatus === "refunded") return "refunded";
  if (order.paymentStatus === "failed") return "failed";
  if (order.status === "cancelled" || order.status === "rejected") {
    return order.paymentStatus === "paid" ? "refunded" : "unpaid";
  }
  if (order.paymentStatus === "pending") return "pending";
  return order.paymentStatus || "unpaid";
}

function formatShortRange(start, end) {
  if (!start || !end) return "Dates TBD";
  const fmt = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
  return `${fmt(start)} - ${fmt(end)}`;
}

function formatFullRange(start, end) {
  if (!start || !end) return "Dates TBD";
  const fmt = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  return `${fmt(start)} - ${fmt(end)}`;
}

function formatDateLabel(date) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

function formatDateTimeLabel(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function avatarClassFromId(id = "") {
  const classes = ["primary", "secondary", "tertiary"];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i)) % classes.length;
  }
  return classes[hash];
}

function productImage(product) {
  if (!product) return null;
  return product.mainImage || product.gallery?.[0] || null;
}

function rentalUiStatus(order) {
  if (order.status === "completed") return "returned";
  if (order.status === "cancelled" || order.status === "rejected") return "cancelled";

  const fs = order.fulfillmentStatus || "processing";

  if (order.status === "approved" && order.rentEnd && fs !== "returned") {
    const end = new Date(`${order.rentEnd}T23:59:59`);
    if (!Number.isNaN(end.getTime()) && end < new Date()) {
      return "overdue";
    }
  }

  if (fs === "returned") return "returned";
  if (fs === "delivered") return "delivered";
  if (fs === "shipped") return "shipped";

  return "ongoing";
}

function saleUiStatus(order) {
  if (order.status === "completed") return "completed";
  if (order.status === "cancelled" || order.status === "rejected") return "cancelled";
  return order.fulfillmentStatus || "processing";
}

function saleDeliveryStatus(order) {
  if (order.status === "completed") return "delivered";
  if (order.status === "cancelled" || order.status === "rejected") return "processing";
  return order.fulfillmentStatus || "processing";
}

function rentalReturnStatus(order) {
  if (order.status === "completed") return "Returned";
  const fs = order.fulfillmentStatus || "processing";
  const labels = {
    processing: "Processing",
    shipped: "Shipped to Buyer",
    delivered: "With Buyer",
    returned: "Returned by Buyer",
  };
  return labels[fs] || "In Progress";
}

function resolveRentalPaymentStatus(order) {
  if (order.paymentStatus === "paid") return "paid";
  if (order.paymentStatus === "refunded") return "refunded";
  if (order.paymentStatus === "failed") return "failed";
  if (order.status === "cancelled" || order.status === "rejected") {
    return order.paymentStatus === "paid" ? "refunded" : "unpaid";
  }
  return order.paymentStatus || "unpaid";
}

function toRentalAdminJSON(order) {
  const product = order.productId && typeof order.productId === "object" ? order.productId : null;
  const buyer = order.buyerId && typeof order.buyerId === "object" ? order.buyerId : null;
  const seller = order.sellerId && typeof order.sellerId === "object" ? order.sellerId : null;
  const image = productImage(product);
  const uiStatus = rentalUiStatus(order);
  const days = order.rentalDays || 0;
  const amount = formatMoney(product?.rentPrice);
  const itemValue = formatMoney(product?.itemPrice || product?.salePrice);
  const paymentStatus = resolveRentalPaymentStatus(order);
  const fulfillmentStatus = order.fulfillmentStatus || "processing";
  const fulfillmentLabel = getFulfillmentLabel(order);
  const productStatus = product?.status || "—";

  let rentalDates = formatFullRange(order.rentStart, order.rentEnd);
  let rentalDaysLabel = days ? `${days} Days` : "—";
  if (uiStatus === "overdue") {
    rentalDates = order.rentEnd
      ? `Ended ${new Date(`${order.rentEnd}T12:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`
      : "Overdue";
    rentalDaysLabel = "Overdue";
  }

  return {
    id: order._id.toString(),
    displayId: `RL-${order._id.toString().slice(-4).toUpperCase()}`,
    mongoId: order._id.toString(),
    dbStatus: order.status,
    title: product?.title || "Rental item",
    image,
    detailImage: image,
    buyer: buyer?.name || order.buyerName || "Buyer",
    buyerAvatar: null,
    buyerLabel: buyer?.status === "active" ? "Buyer (Verified)" : "Buyer",
    seller: seller?.name || "Seller",
    sellerAvatar: null,
    sellerLabel: "Seller",
    rentalDates,
    rentalDays: rentalDaysLabel,
    amount,
    status: uiStatus,
    statusLabel: fulfillmentLabel,
    rentalPeriod: formatShortRange(order.rentStart, order.rentEnd),
    rentalCost: amount,
    itemValue,
    rentalType: days >= 7 ? "Weekly" : "Daily",
    paymentStatus,
    fulfillmentStatus,
    fulfillmentLabel,
    productStatus,
    escrowStatus: order.escrowStatus || "none",
    escrowLabel: getEscrowLabel(order),
    rentalChargePkr: order.rentalChargePkr || 0,
    refundAmountPkr: order.refundAmountPkr || 0,
    returnStatus: rentalReturnStatus(order),
    overdue: uiStatus === "overdue",
    size: order.size || "",
    rentStart: order.rentStart || "",
    rentEnd: order.rentEnd || "",
    createdAt: order.createdAt,
  };
}

function toSaleAdminJSON(order) {
  const product = order.productId && typeof order.productId === "object" ? order.productId : null;
  const buyer = order.buyerId && typeof order.buyerId === "object" ? order.buyerId : null;
  const seller = order.sellerId && typeof order.sellerId === "object" ? order.sellerId : null;
  const image = productImage(product);
  const uiStatus = saleUiStatus(order);
  const deliveryStatus = saleDeliveryStatus(order);
  const amount =
    formatPkrAmount(order.itemAmountPkr || order.amountPkr) ||
    formatMoney(product?.salePrice || product?.startingBid || product?.itemPrice);
  const id = order._id.toString();
  const paymentStatus = resolveSalePaymentStatus(order);
  const fulfillmentStatus = order.fulfillmentStatus || "processing";
  const fulfillmentLabel = getFulfillmentLabel(order);
  const productStatus = product?.status || "—";

  const logistics = [
    {
      label:
        order.paymentStatus === "paid"
          ? "Stripe payment confirmed"
          : order.status === "completed"
            ? "Order completed"
            : order.status === "approved"
              ? "Seller approved order"
              : order.status === "cancelled" || order.status === "rejected"
                ? "Order closed"
                : "Order placed",
      date: formatDateTimeLabel(order.paidAt || order.updatedAt || order.createdAt),
      active: true,
    },
    {
      label: "Order created",
      date: formatDateTimeLabel(order.createdAt),
      active: false,
    },
  ];

  return {
    id,
    displayId: order.orderId || `RS-${id.slice(-4).toUpperCase()}`,
    mongoId: id,
    itemId: product?._id ? `ITEM-${String(product._id).slice(-6).toUpperCase()}` : "ITEM-—",
    dbStatus: order.status,
    title: product?.title || "Resale item",
    image,
    detailImage: image,
    buyer: buyer?.name || order.buyerName || "Buyer",
    buyerAvatarClass: avatarClassFromId(String(buyer?._id || id)),
    seller: seller?.name || "Seller",
    sellerAvatarClass: avatarClassFromId(String(seller?._id || `${id}-s`)),
    winningBid: amount,
    date: formatDateLabel(order.createdAt),
    status: uiStatus,
    statusLabel: fulfillmentLabel,
    paymentStatus,
    stripeSessionId: order.stripeSessionId || "",
    deliveryStatus,
    fulfillmentStatus,
    fulfillmentLabel,
    productStatus,
    logistics,
    size: order.size || "",
    createdAt: order.createdAt,
  };
}

async function loadOrders(type) {
  return Order.find({ type })
    .populate("buyerId", "name email status role")
    .populate("sellerId", "name email status role")
    .populate(
      "productId",
      "title mainImage gallery rentPrice salePrice itemPrice startingBid status",
    )
    .sort({ createdAt: -1 })
    .limit(500);
}

/** Admin: list rental orders */
async function listRentalOrders(req, res) {
  try {
    const orders = await loadOrders("rental");
    const mapped = orders.map(toRentalAdminJSON);

    const ongoing = mapped.filter((o) => o.status === "ongoing").length;
    const overdue = mapped.filter((o) => o.status === "overdue").length;
    const active = ongoing + overdue;

    res.json({
      orders: mapped,
      total: mapped.length,
      stats: {
        totalActive: active,
        activeTrend: "",
        ongoingRentals: ongoing,
        overdueItems: overdue,
        totalRevenue: "—",
      },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: list resale/sale orders */
async function listResaleOrders(req, res) {
  try {
    const orders = await loadOrders("sale");
    const mapped = orders.map(toSaleAdminJSON);

    const pending = mapped.filter((o) => o.status === "pending").length;
    const activeDeliveries = mapped.filter(
      (o) => o.deliveryStatus === "shipped" || o.deliveryStatus === "processing",
    ).length;

    res.json({
      orders: mapped,
      total: mapped.length,
      stats: {
        totalRevenue: "—",
        revenueTrend: "",
        activeDeliveries,
        pendingOrders: pending,
      },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: update order status (complete / cancel) */
async function updateAdminOrderStatus(req, res) {
  try {
    const { status } = req.body;
    if (!["completed", "cancelled", "approved", "pending"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const order = await Order.findById(req.params.id)
      .populate("buyerId", "name email status role")
      .populate("sellerId", "name email status role")
      .populate(
        "productId",
        "title mainImage gallery rentPrice salePrice itemPrice startingBid status",
      );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.status = status;
    await order.save();
    await syncProductForOrder(order);

    const mapped =
      order.type === "rental" ? toRentalAdminJSON(order) : toSaleAdminJSON(order);

    res.json({ message: "Order updated", order: mapped });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  listRentalOrders,
  listResaleOrders,
  updateAdminOrderStatus,
};

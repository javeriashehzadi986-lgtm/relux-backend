const Order = require("../models/Order");

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

  if (order.status === "approved" && order.rentEnd) {
    const end = new Date(`${order.rentEnd}T23:59:59`);
    if (!Number.isNaN(end.getTime()) && end < new Date()) {
      return "overdue";
    }
  }

  return "ongoing";
}

function saleUiStatus(order) {
  if (order.status === "completed") return "completed";
  if (order.status === "cancelled" || order.status === "rejected") return "cancelled";
  return "pending";
}

function saleDeliveryStatus(order) {
  if (order.status === "completed") return "delivered";
  if (order.status === "approved") return "shipped";
  if (order.status === "cancelled" || order.status === "rejected") return "processing";
  return "processing";
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
    rentalPeriod: formatShortRange(order.rentStart, order.rentEnd),
    rentalCost: amount,
    itemValue,
    rentalType: days >= 7 ? "Weekly" : "Daily",
    paymentStatus: order.status === "cancelled" || order.status === "rejected" ? "unpaid" : "paid",
    returnStatus:
      uiStatus === "returned" ? "Returned" : uiStatus === "overdue" ? "Overdue" : "In Progress",
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
    paymentStatus,
    stripeSessionId: order.stripeSessionId || "",
    deliveryStatus,
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
      "title mainImage gallery rentPrice salePrice itemPrice startingBid",
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
        "title mainImage gallery rentPrice salePrice itemPrice startingBid",
      );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    order.status = status;
    await order.save();

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

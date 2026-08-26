const Order = require("../models/Order");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function formatPkr(amount) {
  const num = Number(amount) || 0;
  return `PKR ${Math.round(num).toLocaleString("en-PK")}`;
}

function formatDateLabel(date) {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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

function productImage(product) {
  if (!product) return null;
  return product.mainImage || product.gallery?.[0] || null;
}

function mapPaymentStatus(order) {
  if (order.paymentStatus === "paid") return "paid";
  if (order.paymentStatus === "refunded") return "refunded";
  if (order.paymentStatus === "failed") return "failed";
  if (order.paymentStatus === "pending") return "pending";
  if (order.status === "cancelled" || order.status === "rejected") return "unpaid";
  return order.paymentStatus || "unpaid";
}

function stripeStatusLabel(status) {
  if (status === "paid") return "Succeeded";
  if (status === "refunded") return "Refunded";
  if (status === "failed") return "Failed";
  if (status === "pending") return "Pending";
  return "Unpaid";
}

function toAdminPaymentJSON(order) {
  const product = order.productId && typeof order.productId === "object" ? order.productId : null;
  const buyer = order.buyerId && typeof order.buyerId === "object" ? order.buyerId : null;
  const seller = order.sellerId && typeof order.sellerId === "object" ? order.sellerId : null;
  const status = mapPaymentStatus(order);
  const amountValue = order.amountPkr || order.itemAmountPkr || 0;
  const when = order.paidAt || order.updatedAt || order.createdAt;
  const productId = product?._id ? String(product._id) : "";

  return {
    id: order.orderId || order._id.toString(),
    mongoId: order._id.toString(),
    buyerName: buyer?.name || order.buyerName || "Buyer",
    buyerEmail: buyer?.email || order.shipping?.email || "",
    buyerAvatar: null,
    sellerName: seller?.name || "Seller",
    sellerEmail: seller?.email || "",
    sellerAvatar: null,
    item: product?.title || "Listing item",
    itemId: productId ? `ITEM-${productId.slice(-6).toUpperCase()}` : "ITEM-—",
    itemImage: productImage(product),
    type: order.type === "rental" ? "rental" : "resale",
    amount: formatPkr(amountValue),
    amountPkr: amountValue,
    date: formatDateLabel(when),
    transactionDate: formatDateTimeLabel(when),
    status,
    stripeStatus: stripeStatusLabel(status),
    stripeSessionId: order.stripeSessionId || "",
    stripePaymentIntentId: order.stripePaymentIntentId || "",
    paymentProvider: order.paymentProvider || "",
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

/** Admin: list real Stripe / order payments */
async function listAdminPayments(req, res) {
  try {
    const orders = await Order.find({
      $or: [
        { paymentStatus: { $in: ["paid", "pending", "refunded", "failed"] } },
        { stripeSessionId: { $ne: "" } },
        { paymentProvider: "stripe" },
      ],
    })
      .populate("buyerId", "name email")
      .populate("sellerId", "name email")
      .populate("productId", "title mainImage gallery")
      .sort({ paidAt: -1, updatedAt: -1, createdAt: -1 })
      .limit(500);

    const payments = orders.map(toAdminPaymentJSON);

    const paid = payments.filter((p) => p.status === "paid");
    const resalePaid = paid.filter((p) => p.type === "resale");
    const rentalPaid = paid.filter((p) => p.type === "rental");
    const totalRevenue = paid.reduce((sum, p) => sum + (Number(p.amountPkr) || 0), 0);
    const resaleRevenue = resalePaid.reduce((sum, p) => sum + (Number(p.amountPkr) || 0), 0);
    const rentalRevenue = rentalPaid.reduce((sum, p) => sum + (Number(p.amountPkr) || 0), 0);
    const revenueShareBase = totalRevenue || 1;

    res.json({
      payments,
      total: payments.length,
      stats: {
        totalTransactions: payments.length,
        transactionTrend: `${paid.length} paid`,
        totalRevenue: formatPkr(totalRevenue),
        revenueProgress:
          payments.length === 0
            ? 0
            : Math.min(100, Math.round((paid.length / payments.length) * 100)),
        rentalPayments: formatPkr(rentalRevenue),
        rentalShare: `${Math.round((rentalRevenue / revenueShareBase) * 100)}% of paid`,
        resalePayments: formatPkr(resaleRevenue),
        resaleShare: `${Math.round((resaleRevenue / revenueShareBase) * 100)}% of paid`,
      },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  listAdminPayments,
};

const { getIO } = require("../socket/io");

function idOf(ref) {
  if (!ref) return null;
  if (typeof ref === "object" && ref._id) return String(ref._id);
  return String(ref);
}

/**
 * Notify buyer and seller rooms that an order changed.
 * Clients listen for `order:updated` on the shared authenticated socket.
 */
function emitOrderUpdated(order, extra = {}) {
  const io = getIO();
  if (!io || !order) return;

  const orderId = idOf(order._id) || idOf(order.id);
  if (!orderId) return;

  const buyerId = idOf(order.buyerId);
  const sellerId = idOf(order.sellerId);

  let buyerOrder = null;
  let sellerOrder = null;
  try {
    if (typeof order.toBuyerJSON === "function") {
      buyerOrder = order.toBuyerJSON();
    }
  } catch {
    // Serialization is best-effort; clients can silent-refresh.
  }
  try {
    if (typeof order.toSellerJSON === "function") {
      sellerOrder = order.toSellerJSON();
    }
  } catch {
    // Serialization is best-effort; clients can silent-refresh.
  }

  const base = {
    orderId,
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus || "processing",
    paymentStatus: order.paymentStatus || "unpaid",
    ...extra,
  };

  if (buyerId) {
    io.to(`user:${buyerId}`).emit("order:updated", {
      ...base,
      role: "buyer",
      order: buyerOrder,
    });
  }

  if (sellerId) {
    io.to(`user:${sellerId}`).emit("order:updated", {
      ...base,
      role: "seller",
      order: sellerOrder,
    });
  }
}

module.exports = {
  emitOrderUpdated,
};

const { getIO } = require("../socket/io");

function emitAuctionUpdate(productId, payload) {
  const io = getIO();
  if (!io) return;

  io.to(`auction:${String(productId)}`).emit("auction:update", {
    productId: String(productId),
    summary: payload.summary,
    history: payload.history,
  });
}

function emitAuctionViewerUpdate(userId, payload) {
  const io = getIO();
  if (!io || !userId) return;

  io.to(`user:${String(userId)}`).emit("auction:viewer", payload);
}

module.exports = {
  emitAuctionUpdate,
  emitAuctionViewerUpdate,
};

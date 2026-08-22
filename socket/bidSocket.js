const mongoose = require("mongoose");

function initBidSocket(io) {
  io.on("connection", (socket) => {
    socket.on("auction:join", ({ productId }) => {
      const id = String(productId ?? "").trim();
      if (!id || !mongoose.Types.ObjectId.isValid(id)) return;

      socket.join(`auction:${id}`);
      socket.data.activeAuctionId = id;
    });

    socket.on("auction:leave", ({ productId }) => {
      const id = String(productId ?? socket.data.activeAuctionId ?? "").trim();
      if (!id) return;

      socket.leave(`auction:${id}`);
      if (socket.data.activeAuctionId === id) {
        socket.data.activeAuctionId = null;
      }
    });

    socket.on("disconnect", () => {
      socket.data.activeAuctionId = null;
    });
  });
}

module.exports = { initBidSocket };

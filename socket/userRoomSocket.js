/**
 * Join every authenticated socket to user:{id} so order/support emits reach clients
 * even if they never open chat.
 */
function initUserRooms(io) {
  io.on("connection", (socket) => {
    if (!socket.user?._id) return;
    socket.join(`user:${String(socket.user._id)}`);
  });
}

module.exports = { initUserRooms };

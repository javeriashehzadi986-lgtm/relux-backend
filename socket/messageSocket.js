const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../middleware/auth");
const {
  findConversationForUser,
  sendMessageToConversation,
  markConversationReadForUser,
} = require("../services/messageService");

function initMessageSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");
      if (!user) {
        return next(new Error("User not found"));
      }

      socket.user = user;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const userId = String(socket.user._id);
    socket.join(`user:${userId}`);

    socket.on("conversation:join", async ({ conversationId }) => {
      if (!conversationId) return;

      const conversation = await findConversationForUser(conversationId, socket.user._id);
      if (!conversation) return;

      socket.join(`conversation:${conversationId}`);
      socket.data.activeConversationId = conversationId;
    });

    socket.on("conversation:leave", ({ conversationId }) => {
      const id = conversationId || socket.data.activeConversationId;
      if (!id) return;
      socket.leave(`conversation:${id}`);
      if (socket.data.activeConversationId === id) {
        socket.data.activeConversationId = null;
      }
    });

    socket.on("message:send", async (payload, callback) => {
      try {
        const { conversationId, text, image } = payload ?? {};
        const result = await sendMessageToConversation({
          conversationId,
          user: socket.user,
          text,
          image,
        });

        if (typeof callback === "function") {
          callback({ ok: true, message: result.message });
        }
      } catch (error) {
        if (typeof callback === "function") {
          callback({
            ok: false,
            message: error.message || "Failed to send message",
          });
        }
      }
    });

    socket.on("conversation:read", async ({ conversationId }) => {
      if (!conversationId) return;
      try {
        await markConversationReadForUser(conversationId, socket.user._id);
      } catch {
        // ignore read errors over socket
      }
    });

    socket.on("typing:start", async ({ conversationId }) => {
      if (!conversationId) return;
      const conversation = await findConversationForUser(conversationId, socket.user._id);
      if (!conversation) return;

      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId,
        userId,
        userName: socket.user.name,
        isTyping: true,
      });
    });

    socket.on("typing:stop", async ({ conversationId }) => {
      if (!conversationId) return;
      const conversation = await findConversationForUser(conversationId, socket.user._id);
      if (!conversation) return;

      socket.to(`conversation:${conversationId}`).emit("typing:update", {
        conversationId,
        userId,
        userName: socket.user.name,
        isTyping: false,
      });
    });

    socket.on("disconnect", () => {
      const activeId = socket.data.activeConversationId;
      if (activeId) {
        socket.to(`conversation:${activeId}`).emit("typing:update", {
          conversationId: activeId,
          userId,
          userName: socket.user.name,
          isTyping: false,
        });
      }
    });
  });
}

module.exports = { initMessageSocket };

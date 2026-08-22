const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { notifyNewMessage } = require("./notificationService");
const { getIO } = require("../socket/io");

function formatMessageTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatTimeLabel(date) {
  if (!date) return "";
  const diffMin = Math.floor(Math.max(0, Date.now() - new Date(date).getTime()) / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isParticipant(conversation, userId) {
  const id = String(userId);
  return (
    String(conversation.buyerId?._id ?? conversation.buyerId) === id ||
    String(conversation.sellerId?._id ?? conversation.sellerId) === id
  );
}

function mapMessageForUser(message, userId) {
  const isSent = String(message.senderId?._id ?? message.senderId) === String(userId);
  return {
    id: String(message._id),
    type: isSent ? "sent" : "received",
    text: message.text,
    time: formatMessageTime(message.createdAt),
    status: isSent ? (message.readAt ? "Read" : "Sent") : undefined,
    image: message.image || undefined,
    senderId: String(message.senderId?._id ?? message.senderId),
    createdAt: message.createdAt,
  };
}

function mapConversationPreview(conversation, userId) {
  const isBuyer =
    String(conversation.buyerId?._id ?? conversation.buyerId) === String(userId);
  const partner = isBuyer ? conversation.sellerId : conversation.buyerId;

  return {
    id: String(conversation._id),
    preview: conversation.lastMessageText || "No messages yet",
    timeLabel: formatTimeLabel(conversation.lastMessageAt),
    unread: isBuyer ? conversation.unreadBuyer ?? 0 : conversation.unreadSeller ?? 0,
    partnerName: partner?.name ?? (isBuyer ? "Seller" : "Buyer"),
  };
}

async function findConversationForUser(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId)
    .populate("buyerId", "name email role")
    .populate("sellerId", "name email role");

  if (!conversation || !isParticipant(conversation, userId)) {
    return null;
  }

  return conversation;
}

function emitConversationUpdate(conversation, senderId) {
  const io = getIO();
  if (!io) return;

  const buyerId = String(conversation.buyerId?._id ?? conversation.buyerId);
  const sellerId = String(conversation.sellerId?._id ?? conversation.sellerId);
  const conversationId = String(conversation._id);

  [buyerId, sellerId].forEach((userId) => {
    io.to(`user:${userId}`).emit("conversation:updated", {
      conversationId,
      preview: mapConversationPreview(conversation, userId),
      senderId: String(senderId),
    });
  });
}

function emitNewMessage(conversation, message, senderId) {
  const io = getIO();
  if (!io) return;

  const conversationId = String(conversation._id);
  const buyerId = String(conversation.buyerId?._id ?? conversation.buyerId);
  const sellerId = String(conversation.sellerId?._id ?? conversation.sellerId);

  [buyerId, sellerId].forEach((userId) => {
    io.to(`user:${userId}`).emit("message:new", {
      conversationId,
      message: mapMessageForUser(message, userId),
    });
  });

  io.to(`conversation:${conversationId}`).emit("message:new", {
    conversationId,
    message: {
      id: String(message._id),
      senderId: String(message.senderId?._id ?? message.senderId),
      text: message.text,
      time: formatMessageTime(message.createdAt),
      image: message.image || undefined,
      createdAt: message.createdAt,
    },
  });
}

function emitMessagesRead(conversation, readerId) {
  const io = getIO();
  if (!io) return;

  const conversationId = String(conversation._id);
  const buyerId = String(conversation.buyerId?._id ?? conversation.buyerId);
  const sellerId = String(conversation.sellerId?._id ?? conversation.sellerId);
  const otherUserId = String(readerId) === buyerId ? sellerId : buyerId;

  io.to(`user:${otherUserId}`).emit("messages:read", {
    conversationId,
    readerId: String(readerId),
  });
}

async function sendMessageToConversation({ conversationId, user, text, image = "" }) {
  const trimmed = text?.trim();
  if (!trimmed) {
    const error = new Error("Message text is required");
    error.statusCode = 400;
    throw error;
  }

  const conversation = await findConversationForUser(conversationId, user._id);
  if (!conversation) {
    const error = new Error("Conversation not found");
    error.statusCode = 404;
    throw error;
  }

  const isBuyer =
    String(conversation.buyerId?._id ?? conversation.buyerId) === String(user._id);

  if (isBuyer && conversation.blockedBySeller) {
    const error = new Error("This conversation is blocked");
    error.statusCode = 403;
    throw error;
  }
  if (!isBuyer && conversation.blockedByBuyer) {
    const error = new Error("This conversation is blocked");
    error.statusCode = 403;
    throw error;
  }

  const message = await Message.create({
    conversationId: conversation._id,
    senderId: user._id,
    text: trimmed,
    image: image?.trim() || "",
  });

  conversation.lastMessageText = trimmed;
  conversation.lastMessageAt = message.createdAt;

  if (isBuyer) {
    conversation.unreadSeller += 1;
  } else {
    conversation.unreadBuyer += 1;
  }

  await conversation.save();

  const recipientId = isBuyer
    ? conversation.sellerId?._id ?? conversation.sellerId
    : conversation.buyerId?._id ?? conversation.buyerId;

  notifyNewMessage({
    userId: recipientId,
    senderName: user.name,
    preview: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
    conversationId: conversation._id,
    listingTitle: conversation.listingTitle,
  });

  emitNewMessage(conversation, message, user._id);
  emitConversationUpdate(conversation, user._id);

  return {
    message: mapMessageForUser(message, user._id),
    conversation,
  };
}

async function markConversationReadForUser(conversationId, userId) {
  const conversation = await findConversationForUser(conversationId, userId);
  if (!conversation) {
    const error = new Error("Conversation not found");
    error.statusCode = 404;
    throw error;
  }

  const isBuyer =
    String(conversation.buyerId?._id ?? conversation.buyerId) === String(userId);

  if (isBuyer) {
    conversation.unreadBuyer = 0;
  } else {
    conversation.unreadSeller = 0;
  }

  await conversation.save();
  await Message.updateMany(
    {
      conversationId: conversation._id,
      senderId: { $ne: userId },
      readAt: null,
    },
    { readAt: new Date() },
  );

  emitMessagesRead(conversation, userId);
  emitConversationUpdate(conversation, userId);

  return conversation;
}

module.exports = {
  formatMessageTime,
  formatTimeLabel,
  isParticipant,
  mapMessageForUser,
  mapConversationPreview,
  findConversationForUser,
  sendMessageToConversation,
  markConversationReadForUser,
};

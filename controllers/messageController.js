const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Product = require("../models/Product");
const User = require("../models/User");
const { notifyNewMessage } = require("../services/notificationService");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function formatTimeLabel(date) {
  if (!date) return "";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = Math.max(0, now - then);
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "Last week";

  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatMessageTime(date) {
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateLabel(date) {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function isParticipant(conversation, userId) {
  const id = String(userId);
  return (
    String(conversation.buyerId?._id ?? conversation.buyerId) === id ||
    String(conversation.sellerId?._id ?? conversation.sellerId) === id
  );
}

function getUnreadForUser(conversation, userId) {
  const id = String(userId);
  if (String(conversation.buyerId?._id ?? conversation.buyerId) === id) {
    return conversation.unreadBuyer ?? 0;
  }
  return conversation.unreadSeller ?? 0;
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
  };
}

function mapConversationForBuyer(conversation) {
  const seller = conversation.sellerId;
  return {
    id: String(conversation._id),
    sellerName: seller?.name ?? "Seller",
    preview: conversation.lastMessageText || "No messages yet",
    timeLabel: formatTimeLabel(conversation.lastMessageAt),
    dressTitle: conversation.listingTitle,
    dressImage: conversation.listingImage,
    dressId: conversation.listingKey,
    listingKey: conversation.listingKey,
    productId: conversation.productId ? String(conversation.productId) : null,
    unread: conversation.unreadBuyer ?? 0,
    online: false,
  };
}

function mapConversationForSeller(conversation) {
  const buyer = conversation.buyerId;
  return {
    id: String(conversation._id),
    buyerName: buyer?.name ?? "Buyer",
    preview: conversation.lastMessageText || "No messages yet",
    timeLabel: formatTimeLabel(conversation.lastMessageAt),
    listingTitle: conversation.listingTitle,
    listingImage: conversation.listingImage,
    listingId: conversation.listingKey,
    listingKey: conversation.listingKey,
    productId: conversation.productId ? String(conversation.productId) : null,
    unread: conversation.unreadSeller ?? 0,
    online: false,
  };
}

function mapThreadForUser(conversation, messages, userId) {
  const isBuyer =
    String(conversation.buyerId?._id ?? conversation.buyerId) === String(userId);
  const buyer = conversation.buyerId;
  const seller = conversation.sellerId;

  if (isBuyer) {
    const sellerName = seller?.name ?? "Seller";
    return {
      dateLabel: formatDateLabel(conversation.createdAt),
      sellerName,
      sellerFirstName: sellerName.split(" ")[0] || sellerName,
      dressTitle: conversation.listingTitle,
      dressId: conversation.listingKey,
      listingId: conversation.listingKey,
      productId: conversation.productId ? String(conversation.productId) : null,
      online: false,
      messages: messages.map((message) => mapMessageForUser(message, userId)),
    };
  }

  const buyerName = buyer?.name ?? "Buyer";
  return {
    dateLabel: formatDateLabel(conversation.createdAt),
    buyerName,
    buyerFirstName: buyerName.split(" ")[0] || buyerName,
    listingTitle: conversation.listingTitle,
    listingId: conversation.listingKey,
    productId: conversation.productId ? String(conversation.productId) : null,
    online: false,
    messages: messages.map((message) => mapMessageForUser(message, userId)),
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

async function resolveListingContext(body) {
  const listingKey = String(body.listingKey ?? body.dressId ?? body.productId ?? "").trim();
  if (!listingKey) {
    return { error: "Listing id is required" };
  }

  let product = null;
  if (body.productId && mongoose.Types.ObjectId.isValid(body.productId)) {
    product = await Product.findById(body.productId);
  } else if (mongoose.Types.ObjectId.isValid(listingKey)) {
    product = await Product.findById(listingKey);
  }

  if (product) {
    if (product.verificationStatus !== "approved" || product.status !== "active") {
      return { error: "This listing is not available for messaging yet" };
    }

    return {
      listingKey: String(product._id),
      productId: product._id,
      sellerId: product.sellerId,
      listingTitle: product.title,
      listingImage: product.mainImage,
    };
  }

  if (!body.sellerId || !mongoose.Types.ObjectId.isValid(body.sellerId)) {
    return {
      error: "Seller id is required for this listing",
    };
  }

  return {
    listingKey,
    productId: null,
    sellerId: body.sellerId,
    listingTitle: body.listingTitle?.trim() || "Listing inquiry",
    listingImage: body.listingImage?.trim() || "",
  };
}

async function listConversations(req, res) {
  try {
    const userId = req.user._id;
    const isSeller = req.user.role === "seller";

    const filter = isSeller ? { sellerId: userId } : { buyerId: userId };
    const conversations = await Conversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .populate("buyerId", "name email role")
      .populate("sellerId", "name email role");

    const items = conversations.map((conversation) =>
      isSeller
        ? mapConversationForSeller(conversation)
        : mapConversationForBuyer(conversation),
    );

    res.json({ conversations: items });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getConversation(req, res) {
  try {
    const conversation = await findConversationForUser(req.params.id, req.user._id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const messages = await Message.find({ conversationId: conversation._id }).sort({
      createdAt: 1,
    });

    if (getUnreadForUser(conversation, req.user._id) > 0) {
      const isBuyer =
        String(conversation.buyerId?._id ?? conversation.buyerId) ===
        String(req.user._id);
      if (isBuyer) {
        conversation.unreadBuyer = 0;
      } else {
        conversation.unreadSeller = 0;
      }
      await conversation.save();

      await Message.updateMany(
        {
          conversationId: conversation._id,
          senderId: { $ne: req.user._id },
          readAt: null,
        },
        { readAt: new Date() },
      );
    }

    const isSeller = req.user.role === "seller";
    const isBuyer =
      String(conversation.buyerId?._id ?? conversation.buyerId) === String(req.user._id);

    res.json({
      conversation: isSeller
        ? mapConversationForSeller(conversation)
        : mapConversationForBuyer(conversation),
      thread: mapThreadForUser(conversation, messages, req.user._id),
      muted: isBuyer ? conversation.mutedByBuyer : conversation.mutedBySeller,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function openConversation(req, res) {
  try {
    const listing = await resolveListingContext(req.body);
    if (listing.error) {
      return res.status(400).json({ message: listing.error });
    }

    const seller = await User.findById(listing.sellerId);
    if (!seller || seller.role !== "seller") {
      return res.status(400).json({ message: "Seller not found for this listing" });
    }

    let buyerId = req.user._id;
    let sellerId = listing.sellerId;

    if (req.user.role === "seller") {
      if (!req.body.buyerId || !mongoose.Types.ObjectId.isValid(req.body.buyerId)) {
        return res.status(400).json({ message: "Buyer id is required" });
      }
      buyerId = req.body.buyerId;
      sellerId = req.user._id;
    } else if (String(sellerId) === String(buyerId)) {
      return res.status(400).json({ message: "You cannot message yourself" });
    }

    let conversation = await Conversation.findOne({
      buyerId,
      sellerId,
      listingKey: listing.listingKey,
    })
      .populate("buyerId", "name email role")
      .populate("sellerId", "name email role");

    if (!conversation) {
      conversation = await Conversation.create({
        buyerId,
        sellerId,
        productId: listing.productId,
        listingKey: listing.listingKey,
        listingTitle: listing.listingTitle,
        listingImage: listing.listingImage,
        lastMessageText: "",
        lastMessageAt: new Date(),
      });
      conversation = await conversation.populate([
        { path: "buyerId", select: "name email role" },
        { path: "sellerId", select: "name email role" },
      ]);
    } else if (listing.listingTitle || listing.listingImage) {
      conversation.listingTitle = listing.listingTitle || conversation.listingTitle;
      conversation.listingImage = listing.listingImage || conversation.listingImage;
      if (listing.productId) {
        conversation.productId = listing.productId;
      }
      await conversation.save();
    }

    const messages = await Message.find({ conversationId: conversation._id }).sort({
      createdAt: 1,
    });

    const isSeller = req.user.role === "seller";
    res.json({
      conversation: isSeller
        ? mapConversationForSeller(conversation)
        : mapConversationForBuyer(conversation),
      thread: mapThreadForUser(conversation, messages, req.user._id),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function sendMessage(req, res) {
  try {
    const text = req.body.text?.trim();
    if (!text) {
      return res.status(400).json({ message: "Message text is required" });
    }

    const conversation = await findConversationForUser(req.params.id, req.user._id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isBuyer =
      String(conversation.buyerId?._id ?? conversation.buyerId) ===
      String(req.user._id);

    if (isBuyer && conversation.blockedBySeller) {
      return res.status(403).json({ message: "This conversation is blocked" });
    }
    if (!isBuyer && conversation.blockedByBuyer) {
      return res.status(403).json({ message: "This conversation is blocked" });
    }

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: req.user._id,
      text,
      image: req.body.image?.trim() || "",
    });

    conversation.lastMessageText = text;
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
      senderName: req.user.name,
      preview: text.length > 120 ? `${text.slice(0, 117)}...` : text,
      conversationId: conversation._id,
      listingTitle: conversation.listingTitle,
    });

    res.status(201).json({
      message: mapMessageForUser(message, req.user._id),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function markConversationRead(req, res) {
  try {
    const conversation = await findConversationForUser(req.params.id, req.user._id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isBuyer =
      String(conversation.buyerId?._id ?? conversation.buyerId) ===
      String(req.user._id);

    if (isBuyer) {
      conversation.unreadBuyer = 0;
    } else {
      conversation.unreadSeller = 0;
    }

    await conversation.save();
    await Message.updateMany(
      {
        conversationId: conversation._id,
        senderId: { $ne: req.user._id },
        readAt: null,
      },
      { readAt: new Date() },
    );

    res.json({ message: "Conversation marked as read" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function markAllConversationsRead(req, res) {
  try {
    const isSeller = req.user.role === "seller";
    const filter = isSeller ? { sellerId: req.user._id } : { buyerId: req.user._id };

    if (isSeller) {
      await Conversation.updateMany(filter, { unreadSeller: 0 });
    } else {
      await Conversation.updateMany(filter, { unreadBuyer: 0 });
    }

    const conversations = await Conversation.find(filter).select("_id");
    const ids = conversations.map((item) => item._id);
    if (ids.length > 0) {
      await Message.updateMany(
        {
          conversationId: { $in: ids },
          senderId: { $ne: req.user._id },
          readAt: null,
        },
        { readAt: new Date() },
      );
    }

    res.json({ message: "All conversations marked as read" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function toggleConversationMute(req, res) {
  try {
    const conversation = await findConversationForUser(req.params.id, req.user._id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isBuyer =
      String(conversation.buyerId?._id ?? conversation.buyerId) ===
      String(req.user._id);

    if (isBuyer) {
      conversation.mutedByBuyer = !conversation.mutedByBuyer;
    } else {
      conversation.mutedBySeller = !conversation.mutedBySeller;
    }

    await conversation.save();
    res.json({
      muted: isBuyer ? conversation.mutedByBuyer : conversation.mutedBySeller,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function clearConversationMessages(req, res) {
  try {
    const conversation = await findConversationForUser(req.params.id, req.user._id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    await Message.deleteMany({ conversationId: conversation._id });
    conversation.lastMessageText = "";
    conversation.lastMessageAt = new Date();
    await conversation.save();

    res.json({ message: "Chat history cleared" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function blockConversation(req, res) {
  try {
    const conversation = await findConversationForUser(req.params.id, req.user._id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const isBuyer =
      String(conversation.buyerId?._id ?? conversation.buyerId) ===
      String(req.user._id);

    if (isBuyer) {
      conversation.blockedByBuyer = true;
      conversation.mutedByBuyer = true;
    } else {
      conversation.blockedBySeller = true;
      conversation.mutedBySeller = true;
    }

    await conversation.save();
    res.json({ message: "Conversation blocked" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getUnreadCount(req, res) {
  try {
    const isSeller = req.user.role === "seller";
    const filter = isSeller ? { sellerId: req.user._id } : { buyerId: req.user._id };
    const conversations = await Conversation.find(filter).select(
      isSeller ? "unreadSeller" : "unreadBuyer",
    );

    const unreadCount = conversations.reduce(
      (total, conversation) =>
        total + (isSeller ? conversation.unreadSeller : conversation.unreadBuyer),
      0,
    );

    res.json({ unreadCount });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  listConversations,
  getConversation,
  openConversation,
  sendMessage,
  markConversationRead,
  markAllConversationsRead,
  toggleConversationMute,
  clearConversationMessages,
  blockConversation,
  getUnreadCount,
};

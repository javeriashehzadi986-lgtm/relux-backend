const mongoose = require("mongoose");
const Notification = require("../models/Notification");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function buildFilter(userId, filter) {
  const query = { userId };

  if (filter === "unread") {
    query.read = false;
  } else if (filter === "orders") {
    query.category = "orders";
  } else if (filter === "payments") {
    query.category = "payments";
  } else if (filter === "bids") {
    query.category = "bids";
  }

  return query;
}

async function getMyNotifications(req, res) {
  try {
    const filter = String(req.query.filter ?? "all").trim().toLowerCase();
    const notifications = await Notification.find(buildFilter(req.user._id, filter))
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      read: false,
    });

    res.json({
      notifications: notifications.map((entry) => entry.toPublicJSON()),
      unreadCount,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getNotificationById(req, res) {
  try {
    const notificationId = String(req.params.id ?? "").trim();
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      userId: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    if (!notification.read) {
      notification.read = true;
      await notification.save();
    }

    res.json({ notification: notification.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function markNotificationRead(req, res) {
  try {
    const notificationId = String(req.params.id ?? "").trim();
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId: req.user._id },
      { read: true },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({
      message: "Notification marked as read",
      notification: notification.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function markAllNotificationsRead(req, res) {
  try {
    await Notification.updateMany(
      { userId: req.user._id, read: false },
      { read: true },
    );

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getUnreadCount(req, res) {
  try {
    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      read: false,
    });
    res.json({ unreadCount });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  getMyNotifications,
  getNotificationById,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
};

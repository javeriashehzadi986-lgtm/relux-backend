const User = require("../models/User");
const Broadcast = require("../models/Broadcast");
const { notifyBroadcast } = require("../services/notificationService");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function recipientFilter(recipients) {
  if (recipients === "buyers") return { role: "buyer", status: "active" };
  if (recipients === "sellers") return { role: "seller", status: "active" };
  return { role: { $in: ["buyer", "seller"] }, status: "active" };
}

async function getRecipientCounts(req, res) {
  try {
    const [buyers, sellers] = await Promise.all([
      User.countDocuments({ role: "buyer", status: "active" }),
      User.countDocuments({ role: "seller", status: "active" }),
    ]);

    res.json({
      counts: {
        all: buyers + sellers,
        buyers,
        sellers,
      },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function listBroadcasts(req, res) {
  try {
    const broadcasts = await Broadcast.find().sort({ createdAt: -1 }).limit(50);
    res.json({
      broadcasts: broadcasts.map((item) => item.toAdminJSON()),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function sendBroadcast(req, res) {
  try {
    const title = String(req.body.title ?? "").trim();
    const message = String(req.body.message ?? "").trim();
    const recipients = String(req.body.recipients ?? "all").trim();
    const priority = String(req.body.priority ?? "normal").trim();

    if (!title) {
      return res.status(400).json({ message: "Title is required" });
    }
    if (!message) {
      return res.status(400).json({ message: "Message is required" });
    }
    if (!["all", "buyers", "sellers"].includes(recipients)) {
      return res.status(400).json({ message: "Invalid recipients" });
    }
    if (!["normal", "important", "urgent"].includes(priority)) {
      return res.status(400).json({ message: "Invalid priority" });
    }

    const users = await User.find(recipientFilter(recipients)).select("_id");
    const sentCount = await notifyBroadcast({
      userIds: users.map((user) => user._id),
      title,
      message,
      priority,
    });

    const broadcast = await Broadcast.create({
      title,
      message,
      recipients,
      priority,
      sentCount,
      sentBy: req.user._id,
    });

    res.status(201).json({
      message: sentCount
        ? `Notification sent to ${sentCount} user${sentCount === 1 ? "" : "s"}`
        : "No matching users to send to",
      broadcast: broadcast.toAdminJSON(),
      sentCount,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  getRecipientCounts,
  listBroadcasts,
  sendBroadcast,
};

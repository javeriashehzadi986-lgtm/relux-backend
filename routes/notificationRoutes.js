const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getMyNotifications,
  getNotificationById,
  markNotificationRead,
  markAllNotificationsRead,
  getUnreadCount,
} = require("../controllers/notificationController");

const router = express.Router();

router.get("/me", protect, getMyNotifications);
router.get("/unread-count", protect, getUnreadCount);
router.patch("/read-all", protect, markAllNotificationsRead);
router.get("/:id", protect, getNotificationById);
router.patch("/:id/read", protect, markNotificationRead);

module.exports = router;

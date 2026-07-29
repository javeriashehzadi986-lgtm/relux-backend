const express = require("express");
const { protect } = require("../middleware/auth");
const {
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
} = require("../controllers/messageController");

const router = express.Router();

router.use(protect);

router.get("/conversations", listConversations);
router.get("/unread-count", getUnreadCount);
router.post("/conversations/open", openConversation);
router.patch("/conversations/read-all", markAllConversationsRead);
router.get("/conversations/:id", getConversation);
router.post("/conversations/:id/messages", sendMessage);
router.patch("/conversations/:id/read", markConversationRead);
router.patch("/conversations/:id/mute", toggleConversationMute);
router.delete("/conversations/:id/messages", clearConversationMessages);
router.patch("/conversations/:id/block", blockConversation);

module.exports = router;

const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  getRecipientCounts,
  listBroadcasts,
  sendBroadcast,
} = require("../controllers/adminNotificationController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/recipients", getRecipientCounts);
router.get("/", listBroadcasts);
router.post("/", sendBroadcast);

module.exports = router;

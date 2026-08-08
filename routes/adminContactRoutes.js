const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listContactMessages,
  updateContactMessage,
  replyContactMessage,
} = require("../controllers/contactController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", listContactMessages);
router.patch("/:id", updateContactMessage);
router.post("/:id/reply", replyContactMessage);

module.exports = router;

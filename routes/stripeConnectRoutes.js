const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createConnectOnboardingLink,
  getConnectStatus,
} = require("../controllers/stripeConnectController");

const router = express.Router();

router.use(protect, authorize("seller"));

router.post("/connect", createConnectOnboardingLink);
router.get("/status", getConnectStatus);

module.exports = router;

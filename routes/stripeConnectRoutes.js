const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createConnectOnboardingLink,
  createExpressDashboardLink,
  getConnectStatus,
  getSellerPayoutOverview,
} = require("../controllers/stripeConnectController");

const router = express.Router();

router.use(protect, authorize("seller"));

router.post("/connect", createConnectOnboardingLink);
router.post("/dashboard-link", createExpressDashboardLink);
router.get("/status", getConnectStatus);
router.get("/payouts", getSellerPayoutOverview);

module.exports = router;

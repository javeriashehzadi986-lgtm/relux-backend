const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createConnectOnboardingLink,
  createExpressDashboardLink,
  getConnectStatus,
  getSellerPayoutOverview,
  retrySellerStripePayouts,
} = require("../controllers/stripeConnectController");

const router = express.Router();

router.use(protect, authorize("seller"));

router.post("/connect", createConnectOnboardingLink);
router.post("/dashboard-link", createExpressDashboardLink);
router.get("/status", getConnectStatus);
router.get("/payouts", getSellerPayoutOverview);
router.post("/payouts/retry", retrySellerStripePayouts);

module.exports = router;

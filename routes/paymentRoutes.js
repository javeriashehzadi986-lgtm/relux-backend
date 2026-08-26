const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createSaleCheckout,
  createRentalCheckout,
  getCheckoutSessionStatus,
} = require("../controllers/paymentController");

const router = express.Router();

router.post("/checkout/sale", protect, authorize("buyer"), createSaleCheckout);
router.post("/checkout/rental", protect, authorize("buyer"), createRentalCheckout);
router.get(
  "/session/:sessionId",
  protect,
  authorize("buyer"),
  getCheckoutSessionStatus,
);

module.exports = router;

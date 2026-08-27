const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  getSaleCheckoutListing,
  createSaleCheckout,
  createRentalCheckout,
  getCheckoutSessionStatus,
} = require("../controllers/paymentController");

const router = express.Router();

router.get(
  "/checkout/sale-listing/:productId",
  protect,
  authorize("buyer"),
  getSaleCheckoutListing,
);
router.post("/checkout/sale", protect, authorize("buyer"), createSaleCheckout);
router.post("/checkout/rental", protect, authorize("buyer"), createRentalCheckout);
router.get(
  "/session/:sessionId",
  protect,
  authorize("buyer"),
  getCheckoutSessionStatus,
);

module.exports = router;

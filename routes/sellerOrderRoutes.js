const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  getMySellerOrders,
  approveOrder,
  rejectOrder,
  completeOrder,
  shipOrder,
  confirmReturnOrder,
} = require("../controllers/sellerOrderController");

const router = express.Router();

router.use(protect, authorize("seller"));

router.get("/me", getMySellerOrders);
router.patch("/:id/approve", approveOrder);
router.patch("/:id/reject", rejectOrder);
router.patch("/:id/ship", shipOrder);
router.patch("/:id/confirm-return", confirmReturnOrder);
router.patch("/:id/complete", completeOrder);

module.exports = router;

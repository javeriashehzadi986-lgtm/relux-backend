const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  getMySellerOrders,
  approveOrder,
  rejectOrder,
  completeOrder,
  shipOrder,
  confirmReturnReceived,
} = require("../controllers/sellerOrderController");
const { proposeSettlement, disputeRentalReturn } = require("../controllers/settlementController");

const router = express.Router();

router.use(protect, authorize("seller"));

router.get("/me", getMySellerOrders);
router.patch("/:id/approve", approveOrder);
router.patch("/:id/reject", rejectOrder);
router.patch("/:id/ship", shipOrder);
router.patch("/:id/confirm-return", confirmReturnReceived);
router.post("/:id/return/dispute", disputeRentalReturn);
router.post("/:id/settlement/propose", proposeSettlement);
router.patch("/:id/complete", completeOrder);

module.exports = router;

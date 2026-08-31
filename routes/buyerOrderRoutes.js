const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createRentalRequest,
  getMyBuyerOrders,
  getMyBuyerOrder,
  cancelMyOrder,
  removeMyOrder,
  confirmReceivedOrder,
  markReturnedOrder,
} = require("../controllers/buyerOrderController");

const router = express.Router();

router.use(protect, authorize("buyer"));

router.get("/me", getMyBuyerOrders);
router.post("/rental", createRentalRequest);
router.get("/:id", getMyBuyerOrder);
router.patch("/:id/cancel", cancelMyOrder);
router.patch("/:id/confirm-received", confirmReceivedOrder);
router.patch("/:id/mark-returned", markReturnedOrder);
router.delete("/:id", removeMyOrder);

module.exports = router;

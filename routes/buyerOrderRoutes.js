const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createRentalRequest,
  getMyBuyerOrders,
  cancelMyOrder,
  removeMyOrder,
} = require("../controllers/buyerOrderController");

const router = express.Router();

router.use(protect, authorize("buyer"));

router.get("/me", getMyBuyerOrders);
router.post("/rental", createRentalRequest);
router.patch("/:id/cancel", cancelMyOrder);
router.delete("/:id", removeMyOrder);

module.exports = router;

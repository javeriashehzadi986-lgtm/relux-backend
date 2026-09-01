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
const {
  getSettlement,
  acceptSettlement,
  disputeSettlement,
} = require("../controllers/settlementController");
const {
  getSaleEscrow,
  disputeSaleDelivery,
} = require("../controllers/saleEscrowController");

const router = express.Router();

router.use(protect, authorize("buyer"));

router.get("/me", getMyBuyerOrders);
router.post("/rental", createRentalRequest);
router.get("/:id", getMyBuyerOrder);
router.patch("/:id/cancel", cancelMyOrder);
router.patch("/:id/confirm-received", confirmReceivedOrder);
router.patch("/:id/mark-returned", markReturnedOrder);
router.get("/:id/settlement", getSettlement);
router.post("/:id/settlement/accept", acceptSettlement);
router.post("/:id/settlement/dispute", disputeSettlement);
router.get("/:id/sale-escrow", getSaleEscrow);
router.post("/:id/sale-escrow/dispute", disputeSaleDelivery);
router.delete("/:id", removeMyOrder);

module.exports = router;

const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listRentalOrders,
  listResaleOrders,
  updateAdminOrderStatus,
} = require("../controllers/adminOrderController");
const {
  getSettlement,
  adminResolveSettlement,
} = require("../controllers/settlementController");
const { adminResolveSaleEscrow } = require("../controllers/saleEscrowController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/rental", listRentalOrders);
router.get("/resale", listResaleOrders);
router.get("/:id/settlement", getSettlement);
router.post("/:id/settlement/resolve", adminResolveSettlement);
router.post("/:id/sale-escrow/resolve", adminResolveSaleEscrow);
router.patch("/:id/status", updateAdminOrderStatus);

module.exports = router;

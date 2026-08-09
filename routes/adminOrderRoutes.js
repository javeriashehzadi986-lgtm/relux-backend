const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listRentalOrders,
  listResaleOrders,
  updateAdminOrderStatus,
} = require("../controllers/adminOrderController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/rental", listRentalOrders);
router.get("/resale", listResaleOrders);
router.patch("/:id/status", updateAdminOrderStatus);

module.exports = router;

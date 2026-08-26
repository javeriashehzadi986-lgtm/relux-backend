const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const { listAdminPayments } = require("../controllers/adminPaymentController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", listAdminPayments);

module.exports = router;

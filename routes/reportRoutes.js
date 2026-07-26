const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createReport,
  getMyReports,
  submitSellerResponse,
} = require("../controllers/reportController");

const router = express.Router();

router.use(protect, authorize("buyer", "seller"));

router.get("/me", getMyReports);
router.post("/", createReport);
router.post("/:id/seller-response", authorize("seller"), submitSellerResponse);

module.exports = router;

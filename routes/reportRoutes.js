const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createReport,
  getMyReports,
  submitSellerResponse,
  submitBuyerResponse,
} = require("../controllers/reportController");

const router = express.Router();

router.use(protect, authorize("buyer", "seller"));

router.get("/me", getMyReports);
router.post("/", createReport);
router.post("/:id/seller-response", authorize("seller"), submitSellerResponse);
router.post("/:id/buyer-response", authorize("buyer"), submitBuyerResponse);

module.exports = router;

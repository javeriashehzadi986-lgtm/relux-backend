const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  getAdminReports,
  updateAdminReport,
} = require("../controllers/reportController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", getAdminReports);
router.patch("/:id", updateAdminReport);

module.exports = router;

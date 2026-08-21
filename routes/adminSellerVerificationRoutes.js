const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listApplications,
  approveApplication,
  rejectApplication,
  requestMoreInfo,
} = require("../controllers/adminSellerVerificationController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", listApplications);
router.patch("/:id/approve", approveApplication);
router.patch("/:id/reject", rejectApplication);
router.patch("/:id/request-info", requestMoreInfo);

module.exports = router;

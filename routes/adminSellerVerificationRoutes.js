const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listApplications,
  approveApplication,
  rejectApplication,
} = require("../controllers/adminSellerVerificationController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", listApplications);
router.patch("/:id/approve", approveApplication);
router.patch("/:id/reject", rejectApplication);

module.exports = router;

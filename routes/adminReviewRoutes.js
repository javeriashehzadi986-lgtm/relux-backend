const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listReviews,
  updateReviewStatus,
  deleteReview,
} = require("../controllers/adminReviewController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", listReviews);
router.patch("/:id/status", updateReviewStatus);
router.delete("/:id", deleteReview);

module.exports = router;

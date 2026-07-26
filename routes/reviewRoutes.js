const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getSellerReviews,
  createSellerReview,
} = require("../controllers/reviewController");

const router = express.Router();

router.get("/seller/:sellerId", getSellerReviews);
router.post("/", protect, createSellerReview);

module.exports = router;

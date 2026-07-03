const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listListings,
  approveListing,
  rejectListing,
} = require("../controllers/adminListingController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", listListings);
router.patch("/:id/approve", approveListing);
router.patch("/:id/reject", rejectListing);

module.exports = router;

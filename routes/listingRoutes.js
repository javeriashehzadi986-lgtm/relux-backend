const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  createListing,
  getMyListings,
  getListing,
  updateListing,
  deleteListing,
  updateListingAvailability,
} = require("../controllers/listingController");

const router = express.Router();

router.use(protect, authorize("seller"));

router.get("/me", getMyListings);
router.get("/:id", getListing);
router.post("/", createListing);
router.put("/:id", updateListing);
router.patch("/:id/availability", updateListingAvailability);
router.delete("/:id", deleteListing);

module.exports = router;

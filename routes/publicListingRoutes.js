const express = require("express");
const {
  listPublicListings,
  getPublicListing,
} = require("../controllers/publicListingController");

const router = express.Router();

router.get("/", listPublicListings);
router.get("/:id", getPublicListing);

module.exports = router;

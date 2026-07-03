const express = require("express");
const { getPublicListings, getPublicListing } = require("../controllers/catalogController");

const router = express.Router();

router.get("/listings", getPublicListings);
router.get("/listings/:id", getPublicListing);

module.exports = router;

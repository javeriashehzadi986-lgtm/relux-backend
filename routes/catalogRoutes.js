const express = require("express");
const { optionalProtect } = require("../middleware/auth");
const { getPublicListings, getPublicListing } = require("../controllers/catalogController");

const router = express.Router();

router.get("/listings", getPublicListings);
router.get("/listings/:id", optionalProtect, getPublicListing);

module.exports = router;

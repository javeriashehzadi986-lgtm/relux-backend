const express = require("express");
const { protect } = require("../middleware/auth");
const {
  getMyWishlist,
  addWishlistItem,
  removeWishlistItem,
  toggleWishlistItem,
} = require("../controllers/wishlistController");

const router = express.Router();

router.use(protect);

router.get("/me", getMyWishlist);
router.post("/", addWishlistItem);
router.post("/toggle", toggleWishlistItem);
router.delete("/:itemId", removeWishlistItem);

module.exports = router;

const express = require("express");
const { protect, optionalProtect } = require("../middleware/auth");
const {
  getProductBids,
  placeBid,
  getMyBids,
} = require("../controllers/bidController");

const router = express.Router();

router.get("/me", protect, getMyBids);
router.post("/", protect, placeBid);
router.get("/product/:productId", optionalProtect, getProductBids);

module.exports = router;

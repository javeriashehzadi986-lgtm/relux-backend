const express = require("express");
const { protect, optionalProtect, authorize } = require("../middleware/auth");
const {
  getProductBids,
  placeBid,
  getMyBids,
} = require("../controllers/bidController");

const router = express.Router();

router.get("/me", protect, authorize("buyer"), getMyBids);
router.post("/", protect, authorize("buyer"), placeBid);
router.get("/product/:productId", optionalProtect, getProductBids);

module.exports = router;

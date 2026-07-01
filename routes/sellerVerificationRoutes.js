const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  applyAsSeller,
  submitVerification,
  updateDocuments,
  getMyVerification,
} = require("../controllers/sellerVerificationController");

const router = express.Router();

router.post("/apply", applyAsSeller);
router.post("/", protect, submitVerification);
router.get("/me", protect, getMyVerification);
router.put("/documents", protect, authorize("seller"), updateDocuments);

module.exports = router;

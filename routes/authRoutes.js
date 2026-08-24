const express = require("express");
const { protect } = require("../middleware/auth");
const {
  register,
  verifyEmail,
  resendVerification,
  login,
  googleAuth,
  getMe,
  updateMe,
  updateEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  deactivateMe,
} = require("../controllers/authController");

const router = express.Router();

router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/login", login);
router.post("/google", googleAuth);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", protect, getMe);
router.patch("/me", protect, updateMe);
router.patch("/me/email", protect, updateEmail);
router.patch("/me/password", protect, changePassword);
router.post("/me/deactivate", protect, deactivateMe);

module.exports = router;

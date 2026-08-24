const express = require("express");
const { protect } = require("../middleware/auth");
const {
  register,
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

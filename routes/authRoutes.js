const express = require("express");
const { protect } = require("../middleware/auth");
const { register, login, getMe, updateMe, updateEmail, deactivateMe } = require("../controllers/authController");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, getMe);
router.patch("/me", protect, updateMe);
router.patch("/me/email", protect, updateEmail);
router.post("/me/deactivate", protect, deactivateMe);

module.exports = router;

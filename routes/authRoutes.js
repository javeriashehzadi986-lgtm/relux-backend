const express = require("express");
const { protect } = require("../middleware/auth");
const { register, login, getMe, updateMe } = require("../controllers/authController");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/me", protect, getMe);
router.patch("/me", protect, updateMe);

module.exports = router;

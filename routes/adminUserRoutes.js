const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const {
  listUsers,
  suspendUser,
  reactivateUser,
  approveUser,
} = require("../controllers/adminUserController");

const router = express.Router();

router.use(protect, authorize("admin"));

router.get("/", listUsers);
router.patch("/:id/suspend", suspendUser);
router.patch("/:id/reactivate", reactivateUser);
router.patch("/:id/approve", approveUser);

module.exports = router;

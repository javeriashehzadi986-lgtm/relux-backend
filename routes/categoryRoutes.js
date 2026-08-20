const express = require("express");
const { listPublicCategories } = require("../controllers/adminCategoryController");

const router = express.Router();

router.get("/", listPublicCategories);

module.exports = router;

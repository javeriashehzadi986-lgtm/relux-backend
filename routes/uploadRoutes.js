const express = require("express");
const { protect, authorize } = require("../middleware/auth");
const { imageUpload } = require("../middleware/upload");
const {
  uploadListingImage,
  uploadVerificationImage,
  uploadSupportImage,
  uploadCategoryImage,
  uploadChatImage,
} = require("../controllers/uploadController");

const router = express.Router();

function runUpload(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ message: "Image must be under 5MB" });
        return;
      }
      res.status(400).json({ message: error.message || "Upload failed" });
    });
  };
}

router.post(
  "/listing",
  protect,
  authorize("seller", "admin"),
  runUpload(imageUpload.single("file")),
  uploadListingImage,
);

router.post(
  "/verification",
  protect,
  runUpload(imageUpload.single("file")),
  uploadVerificationImage,
);

router.post(
  "/support",
  protect,
  runUpload(imageUpload.single("file")),
  uploadSupportImage,
);

router.post(
  "/category",
  protect,
  authorize("admin"),
  runUpload(imageUpload.single("file")),
  uploadCategoryImage,
);

router.post(
  "/chat",
  protect,
  runUpload(imageUpload.single("file")),
  uploadChatImage,
);

module.exports = router;

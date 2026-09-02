const { uploadImageFile } = require("../services/cloudinaryUploadService");

function getErrorMessage(error) {
  if (error.message?.includes("File too large")) {
    return "Image must be under 5MB";
  }
  if (error.message?.includes("Only image files")) {
    return "Only JPG, PNG, or WEBP images are allowed";
  }
  return error.message || "Image upload failed";
}

async function handleImageUpload(req, res, kind) {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Image file is required" });
    }

    const result = await uploadImageFile(req.file, kind);

    res.status(201).json({
      message: "Image uploaded",
      url: result.url,
      publicId: result.publicId,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    const status = message.includes("Cloudinary is not configured") ? 503 : 500;
    res.status(status).json({ message });
  }
}

async function uploadListingImage(req, res) {
  return handleImageUpload(req, res, "listings");
}

async function uploadVerificationImage(req, res) {
  return handleImageUpload(req, res, "verification");
}

async function uploadSupportImage(req, res) {
  return handleImageUpload(req, res, "support");
}

module.exports = {
  uploadListingImage,
  uploadVerificationImage,
  uploadSupportImage,
};

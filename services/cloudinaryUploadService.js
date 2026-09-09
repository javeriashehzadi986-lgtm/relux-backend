const { cloudinary, isCloudinaryConfigured } = require("../config/cloudinary");

const UPLOAD_FOLDERS = {
  listings: "relux/listings",
  verification: "relux/verification",
  support: "relux/support",
  categories: "relux/categories",
};

function getUploadFolder(kind) {
  return UPLOAD_FOLDERS[kind] || UPLOAD_FOLDERS.listings;
}

function uploadBuffer(buffer, { folder, mimetype }) {
  if (!isCloudinaryConfigured()) {
    return Promise.reject(
      new Error(
        "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to relux-backend/.env",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        format: mimetype?.includes("png") ? "png" : "jpg",
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );

    stream.end(buffer);
  });
}

function isCloudinaryUrl(source) {
  return typeof source === "string" && source.includes("res.cloudinary.com");
}

async function uploadImageSource(source, kind = "listings") {
  if (!source?.trim()) {
    return null;
  }
  if (isCloudinaryUrl(source)) {
    return source;
  }
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET to relux-backend/.env",
    );
  }

  const folder = getUploadFolder(kind);
  const result = await cloudinary.uploader.upload(source, {
    folder,
    resource_type: "image",
  });

  return result.secure_url;
}

async function uploadImageFile(file, kind = "listings") {
  if (!file?.buffer?.length) {
    throw new Error("Image file is required");
  }

  const folder = getUploadFolder(kind);
  const result = await uploadBuffer(file.buffer, {
    folder,
    mimetype: file.mimetype,
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    width: result.width,
    height: result.height,
    bytes: result.bytes,
  };
}

module.exports = {
  UPLOAD_FOLDERS,
  uploadImageFile,
  uploadImageSource,
  isCloudinaryUrl,
  isCloudinaryConfigured,
};

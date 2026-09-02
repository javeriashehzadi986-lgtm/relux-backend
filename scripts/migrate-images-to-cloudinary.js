/**
 * Upload existing MongoDB images (base64 / external URLs) to Cloudinary
 * and replace stored values with Cloudinary URLs.
 *
 * Usage: node scripts/migrate-images-to-cloudinary.js
 */
require("dotenv").config();

const mongoose = require("mongoose");
const Product = require("../models/Product");
const SellerVerification = require("../models/SellerVerification");
const Report = require("../models/Report");
const {
  uploadImageSource,
  isCloudinaryUrl,
  isCloudinaryConfigured,
} = require("../services/cloudinaryUploadService");

const urlCache = new Map();

function isValidDataUri(value) {
  return /^data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]{80,}/.test(value);
}

function shouldMigrate(source) {
  if (!source || typeof source !== "string") return false;
  const value = source.trim();
  if (!value) return false;
  if (isCloudinaryUrl(value)) return false;
  if (value.startsWith("data:")) {
    return isValidDataUri(value);
  }
  return value.startsWith("http://") || value.startsWith("https://");
}

async function migrateSource(source, folder) {
  const value = source.trim();
  if (!shouldMigrate(value)) {
    return value || null;
  }
  if (urlCache.has(value)) {
    return urlCache.get(value);
  }

  try {
    const uploaded = await uploadImageSource(value, folder);
    urlCache.set(value, uploaded);
    return uploaded;
  } catch (error) {
    console.warn(`  ⚠ Skipped invalid image: ${error.message || error}`);
    return value;
  }
}

async function migrateProducts() {
  const products = await Product.find({}).select("title mainImage gallery").lean(false);
  let updated = 0;
  let imagesUploaded = 0;

  for (const product of products) {
    let changed = false;
    const nextGallery = [];

    if (shouldMigrate(product.mainImage)) {
      const url = await migrateSource(product.mainImage, "listings");
      if (url && url !== product.mainImage) {
        product.mainImage = url;
        changed = true;
        imagesUploaded += 1;
      }
    }

    for (const image of product.gallery || []) {
      if (shouldMigrate(image)) {
        const url = await migrateSource(image, "listings");
        if (url) {
          nextGallery.push(url);
          if (url !== image) {
            changed = true;
            imagesUploaded += 1;
          }
        }
      } else if (image?.trim()) {
        nextGallery.push(image.trim());
      }
    }

    if (changed) {
      product.gallery = nextGallery.length ? nextGallery : [product.mainImage];
      await product.save();
      updated += 1;
      console.log(`  ✓ Product: ${product.title}`);
    }
  }

  return { updated, imagesUploaded, total: products.length };
}

async function migrateVerifications() {
  const records = await SellerVerification.find({}).select("cnicFront cnicBack").lean(false);
  let updated = 0;
  let imagesUploaded = 0;

  for (const record of records) {
    let changed = false;

    for (const field of ["cnicFront", "cnicBack"]) {
      const current = record[field];
      if (!shouldMigrate(current)) continue;

      const url = await migrateSource(current, "verification");
      if (url && url !== current) {
        record[field] = url;
        changed = true;
        imagesUploaded += 1;
      }
    }

    if (changed) {
      await record.save();
      updated += 1;
      console.log(`  ✓ Seller verification: ${record._id}`);
    }
  }

  return { updated, imagesUploaded, total: records.length };
}

async function migrateReports() {
  const reports = await Report.find({ "images.0": { $exists: true } }).select("images reportId").lean(false);
  let updated = 0;
  let imagesUploaded = 0;

  for (const report of reports) {
    const nextImages = [];
    let changed = false;

    for (const image of report.images || []) {
      if (shouldMigrate(image)) {
        const url = await migrateSource(image, "support");
        if (url) {
          nextImages.push(url);
          if (url !== image) {
            changed = true;
            imagesUploaded += 1;
          }
        }
      } else if (image?.trim()) {
        nextImages.push(image.trim());
      }
    }

    if (changed) {
      report.images = nextImages;
      await report.save();
      updated += 1;
      console.log(`  ✓ Support report: ${report.reportId || report._id}`);
    }
  }

  return { updated, imagesUploaded, total: reports.length };
}

async function main() {
  if (!process.env.MONGODB_URL) {
    throw new Error("MONGODB_URL missing in .env");
  }
  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary keys missing in .env");
  }

  await mongoose.connect(process.env.MONGODB_URL);
  console.log("Connected to MongoDB");
  console.log("Migrating old images to Cloudinary...\n");

  console.log("Products:");
  const products = await migrateProducts();
  console.log(`  ${products.updated}/${products.total} products updated (${products.imagesUploaded} images)\n`);

  console.log("Seller verification:");
  const verifications = await migrateVerifications();
  console.log(
    `  ${verifications.updated}/${verifications.total} records updated (${verifications.imagesUploaded} images)\n`,
  );

  console.log("Support reports:");
  const reports = await migrateReports();
  console.log(`  ${reports.updated}/${reports.total} reports updated (${reports.imagesUploaded} images)\n`);

  console.log("Done. Check Cloudinary → Media Library → relux/ folders.");
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("Migration failed:", error.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

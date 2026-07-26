require("dotenv").config();
const mongoose = require("mongoose");
require("../models/User");
const Product = require("../models/Product");

async function main() {
  await mongoose.connect(process.env.MONGODB_URL);

  const products = await Product.find({ sellerId: { $ne: null } })
    .populate("sellerId", "name email")
    .select("title mainCategory listingType verificationStatus status createdAt")
    .sort({ createdAt: -1 });

  console.log("Seller-added products:\n");
  products.forEach((product, index) => {
    console.log(`${index + 1}. ID: ${product._id.toString()}`);
    console.log(`   Title: ${product.title}`);
    console.log(`   Seller: ${product.sellerId?.name} (${product.sellerId?.email})`);
    console.log(`   Category: ${product.mainCategory} | Type: ${product.listingType}`);
    console.log(`   Verification: ${product.verificationStatus} | Status: ${product.status}`);
    console.log("");
  });

  console.log(`Total seller-added products: ${products.length}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

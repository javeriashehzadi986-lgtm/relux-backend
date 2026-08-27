/**
 * Fixes stale wishlists indexes from an older schema (one doc per user).
 * Run once: node scripts/fix-wishlist-index.js
 */
require("dotenv").config();
const connectDB = require("../config/db");
const Wishlist = require("../models/Wishlist");

async function fixWishlistIndexes() {
  await connectDB();

  const collection = Wishlist.collection;
  const indexes = await collection.indexes();

  console.log("Current wishlists indexes:");
  indexes.forEach((index) => {
    console.log(`- ${index.name}:`, JSON.stringify(index.key), index.unique ? "(unique)" : "");
  });

  const userIdOnlyIndex = indexes.find(
    (index) =>
      index.name === "userId_1" &&
      index.unique &&
      Object.keys(index.key).length === 1 &&
      index.key.userId === 1,
  );

  if (userIdOnlyIndex) {
    console.log("\nDropping stale unique index userId_1...");
    await collection.dropIndex("userId_1");
    console.log("Dropped userId_1");
  } else {
    console.log("\nNo stale unique userId_1 index found.");
  }

  console.log("\nSyncing model indexes...");
  await Wishlist.syncIndexes();

  const nextIndexes = await collection.indexes();
  console.log("\nUpdated wishlists indexes:");
  nextIndexes.forEach((index) => {
    console.log(`- ${index.name}:`, JSON.stringify(index.key), index.unique ? "(unique)" : "");
  });

  console.log("\nDone.");
  process.exit(0);
}

fixWishlistIndexes().catch((error) => {
  console.error(error);
  process.exit(1);
});

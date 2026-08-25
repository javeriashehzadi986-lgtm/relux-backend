/**
 * Mark Google-only accounts as not having a user-chosen Relux password,
 * unless they already set one (passwordSetByUser === true).
 *
 *   node scripts/fix-google-password-flag.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

async function main() {
  await mongoose.connect(process.env.MONGODB_URL);

  const result = await User.updateMany(
    {
      authProvider: "google",
      passwordSetByUser: { $ne: true },
    },
    { $set: { passwordSetByUser: false } },
  );

  console.log(
    `Updated Google accounts without a set password: matched=${result.matchedCount} modified=${result.modifiedCount}`,
  );

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

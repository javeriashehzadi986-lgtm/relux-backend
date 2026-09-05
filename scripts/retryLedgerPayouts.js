require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { retryPendingSellerPayouts } = require("../services/escrowService");

async function main() {
  await mongoose.connect(process.env.MONGODB_URL);
  const seller = await User.findOne({ email: "javeriashehzadi986@gmail.com" });
  if (!seller) throw new Error("seller not found");
  const results = await retryPendingSellerPayouts(seller._id);
  console.log(JSON.stringify(results, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

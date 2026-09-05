/**
 * One-off: retry Stripe transfers for released escrow payouts stuck as ledger_only/failed.
 * Usage: node scripts/retryLedgerPayouts.js [sellerEmail]
 */
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const User = require("../models/User");
const { retryPendingSellerPayouts } = require("../services/escrowService");

async function main() {
  await mongoose.connect(process.env.MONGODB_URL);

  const email = process.argv[2] || "javeriashehzadi986@gmail.com";
  const seller = await User.findOne({ email }).select("_id name email role");
  if (!seller) {
    throw new Error(`Seller not found: ${email}`);
  }

  console.log(`Retrying pending payouts for ${seller.email} (${seller._id})`);
  const results = await retryPendingSellerPayouts(seller._id);
  console.log(JSON.stringify(results, null, 2));
  console.log(
    `Done: ${results.filter((r) => r.ok).length}/${results.length} transferred`,
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});

/**
 * One-time helper: free an email that is stuck on a deleted/suspended account
 * so the user can sign up again.
 *
 * Usage:
 *   node scripts/free-deleted-email.js youremail@gmail.com
 */
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

async function main() {
  const email = String(process.argv[2] ?? "")
    .trim()
    .toLowerCase();

  if (!email || !email.includes("@")) {
    console.error("Usage: node scripts/free-deleted-email.js youremail@gmail.com");
    process.exit(1);
  }

  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) {
    console.error("MONGODB_URL missing in .env");
    process.exit(1);
  }

  await mongoose.connect(mongoUrl);

  const user = await User.findOne({ email }).select("name email status role");
  if (!user) {
    console.log("No user found with that email. You can sign up normally.");
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log("Found user:", {
    name: user.name,
    status: user.status,
    role: user.role,
  });

  if (user.status !== "suspended" && user.status !== "rejected") {
    console.log(
      `Account status is "${user.status}" (not deleted). Sign up is blocked — log in, or delete the account from Profile first.`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  user.email = `deactivated.${user._id}.${Date.now()}@reluxhub.local`;
  user.status = "suspended";
  await user.save();

  console.log("Email freed. Go to /signup and create a new account with that email.");
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

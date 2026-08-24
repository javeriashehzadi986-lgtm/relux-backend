require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

const query = String(process.argv[2] ?? "saniya").trim();

async function main() {
  await mongoose.connect(process.env.MONGODB_URL);
  const users = await User.find({
    $or: [
      { name: new RegExp(query, "i") },
      { email: new RegExp(query, "i") },
    ],
  })
    .select("name email status role updatedAt")
    .sort({ updatedAt: -1 })
    .limit(10)
    .lean();

  console.log(JSON.stringify(users, null, 2));
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

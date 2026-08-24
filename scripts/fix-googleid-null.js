require("dotenv").config();

const connectDB = require("../config/db");
const User = require("../models/User");

async function fixGoogleIdNulls() {
  await connectDB();

  const result = await User.updateMany(
    { googleId: null },
    { $unset: { googleId: "" } },
  );

  console.log(`Unset googleId on ${result.modifiedCount} user(s).`);
  process.exit(0);
}

fixGoogleIdNulls().catch((error) => {
  console.error("Fix failed:", error.message);
  process.exit(1);
});

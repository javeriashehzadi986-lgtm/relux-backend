require("dotenv").config();

const connectDB = require("../config/db");
const User = require("../models/User");

const USERS = [
  {
    name: "Admin User",
    email: "admin@reluxhub.com",
    password: "admin123",
    role: "admin",
    status: "active",
  },
];

async function seed() {
  await connectDB();
  await User.deleteMany({});

  for (const user of USERS) {
    await User.create(user);
  }

  console.log("Auth users seeded");
  console.log("Admin: admin@reluxhub.com / admin123");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed failed:", error.message);
  process.exit(1);
});

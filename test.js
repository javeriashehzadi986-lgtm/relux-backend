const mongoose = require("mongoose");
require("dotenv").config();

const Test = require("./models/Tests");

async function createTest() {
  await mongoose.connect(process.env.MONGODB_URL);

  await Test.create({
    name: "Test Data"
  });

  console.log("Test document created");

  await mongoose.disconnect();
}

createTest();
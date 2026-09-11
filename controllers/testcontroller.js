const Test = require("../models/Test");

const createTest = async () => {
  await Test.create({
    name: "Test Data"
  });
};

createTest();
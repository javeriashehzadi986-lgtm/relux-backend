/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.js"],
  collectCoverageFrom: [
    "services/**/*.js",
    "!services/**/index.js",
  ],
  coverageDirectory: "tests/reports/coverage",
  coverageReporters: ["text", "text-summary", "lcov", "json-summary"],
  verbose: true,
};

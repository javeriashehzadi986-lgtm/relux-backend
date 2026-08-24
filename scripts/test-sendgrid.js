/**
 * Test SendGrid delivery. Usage:
 *   node scripts/test-sendgrid.js youremail@gmail.com
 */
require("dotenv").config();
const { sendNotificationEmail, isConfigured } = require("../services/emailService");

async function main() {
  const to = String(process.argv[2] ?? process.env.SENDGRID_FROM_EMAIL ?? "").trim();

  console.log("SendGrid configured:", isConfigured());
  console.log("FROM email set:", Boolean(process.env.SENDGRID_FROM_EMAIL));
  console.log("API key set:", Boolean(process.env.SENDGRID_API_KEY));
  console.log("Sending test to:", to || "(missing recipient)");

  if (!to) {
    console.error("Usage: node scripts/test-sendgrid.js recipient@email.com");
    process.exit(1);
  }

  const result = await sendNotificationEmail({
    to,
    title: "Relux Hub SendGrid Test",
    message: "If you received this, SendGrid is working correctly.",
    highlight: "Test OK",
    link: "/home",
  });

  console.log("Result:", JSON.stringify(result, null, 2));
  process.exit(result.sent ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

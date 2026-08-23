const User = require("../models/User");

/**
 * If this email belongs to a deleted/suspended account, free it for a new signup.
 * Active / pending / rejected accounts keep the email (must log in).
 */
async function releaseEmailForNewSignup(email) {
  const emailNorm = String(email ?? "").trim().toLowerCase();
  if (!emailNorm) {
    return { blocked: false, released: false };
  }

  const existing = await User.findOne({ email: emailNorm });
  if (!existing) {
    return { blocked: false, released: false };
  }

  // Deleted accounts (and rejected seller apps) can re-register with the same email.
  if (existing.status === "suspended" || existing.status === "rejected") {
    await User.updateOne(
      { _id: existing._id },
      {
        $set: {
          email: `deactivated.${existing._id}.${Date.now()}@reluxhub.local`,
          status: "suspended",
        },
      },
    );
    return { blocked: false, released: true, previousUserId: existing._id };
  }

  return { blocked: true, released: false, status: existing.status };
}

module.exports = { releaseEmailForNewSignup };

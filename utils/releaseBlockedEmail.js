const User = require("../models/User");
const PendingSignup = require("../models/PendingSignup");

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
    await PendingSignup.deleteMany({ email: emailNorm });
    await User.updateOne(
      { _id: existing._id },
      {
        $set: {
          email: `deactivated.${existing._id}.${Date.now()}@reluxhub.local`,
          status: "suspended",
        },
        $unset: { googleId: "" },
      },
    );
    return { blocked: false, released: true, previousUserId: existing._id };
  }

  return { blocked: true, released: false, status: existing.status };
}

/**
 * Clears identifiers on a deleted/rejected account so the same person can sign up again
 * (email/password or Google) without hitting unique-index conflicts.
 */
async function releaseDeletedUserForReSignup(user) {
  if (!user || (user.status !== "suspended" && user.status !== "rejected")) {
    return false;
  }

  const emailAlreadyReleased = String(user.email).includes("@reluxhub.local");

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        email: emailAlreadyReleased
          ? user.email
          : `deactivated.${user._id}.${Date.now()}@reluxhub.local`,
        status: "suspended",
      },
      $unset: { googleId: "" },
    },
  );

  return true;
}

module.exports = { releaseEmailForNewSignup, releaseDeletedUserForReSignup };

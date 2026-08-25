const User = require("../models/User");
const Product = require("../models/Product");
const PendingSignup = require("../models/PendingSignup");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { signToken } = require("../middleware/auth");
const { sendNotificationEmail } = require("../services/emailService");
const { releaseEmailForNewSignup, releaseDeletedUserForReSignup } = require("../utils/releaseBlockedEmail");

function getAuthErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

async function sendSignupVerificationEmail({ to, name, rawToken }) {
  return sendNotificationEmail({
    to,
    title: "Verify Your Email",
    message:
      "Click the button below to verify your email and activate your Relux Hub account. This link expires in 24 hours.",
    highlight: name,
    link: `/verify-email?token=${rawToken}`,
  });
}

async function register(req, res) {
  try {
    const { name, email, password } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Signup can only create buyers. Sellers must go through seller verification
    // (CNIC, phone, city) and admin approval — never via /auth/register.
    if (req.body.role && req.body.role !== "buyer") {
      return res.status(400).json({
        message:
          "Seller accounts cannot be created from signup. Use Become a Seller and submit verification.",
      });
    }

    const emailNorm = email.toLowerCase().trim();
    const { blocked } = await releaseEmailForNewSignup(emailNorm);
    if (blocked) {
      return res.status(409).json({
        message: "Email already registered. Please log in with your existing account.",
        code: "EMAIL_IN_USE",
      });
    }

    await PendingSignup.deleteMany({ email: emailNorm });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const passwordHash = await require("bcryptjs").hash(password, 10);
    await PendingSignup.create({
      name: name.trim(),
      email: emailNorm,
      password: passwordHash,
      verificationToken: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
    });

    const emailResult = await sendSignupVerificationEmail({
      to: emailNorm,
      name: name.trim(),
      rawToken,
    });

    if (!emailResult.sent) {
      await PendingSignup.deleteMany({ email: emailNorm });
      console.error(
        "[register] Verification email failed:",
        emailResult.error || emailResult.reason || "unknown",
      );
      return res.status(503).json({
        message: "Could not send verification email. Please try again in a few minutes.",
        code: "EMAIL_SEND_FAILED",
      });
    }

    res.status(201).json({
      message: "Verification email sent. Check your inbox to activate your account.",
      email: emailNorm,
      requiresVerification: true,
    });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

function sendVerifiedSignupResponse(res, user, message) {
  const authToken = signToken(user);
  return res.json({
    message: message || "Email verified. Your account is now active.",
    token: authToken,
    user: user.toPublicJSON(),
  });
}

async function verifyEmail(req, res) {
  try {
    const token = String(req.query.token ?? req.body?.token ?? "").trim();
    if (!token) {
      return res.status(400).json({ message: "Verification token is required" });
    }

    const tokenHash = hashResetToken(token);
    const pending = await PendingSignup.findOne({ verificationToken: tokenHash });

    if (!pending) {
      return res.status(400).json({
        message: "This verification link is invalid or has expired. Please sign up again.",
        code: "INVALID_TOKEN",
      });
    }

    if (pending.verifiedUserId) {
      const existingUser = await User.findById(pending.verifiedUserId);
      if (existingUser && existingUser.status !== "suspended" && existingUser.status !== "rejected") {
        return sendVerifiedSignupResponse(
          res,
          existingUser,
          "Your email is already verified. Signing you in.",
        );
      }
    }

    if (pending.expiresAt <= new Date()) {
      return res.status(400).json({
        message: "This verification link is invalid or has expired. Please sign up again.",
        code: "INVALID_TOKEN",
      });
    }

    const { blocked } = await releaseEmailForNewSignup(pending.email);
    if (blocked) {
      await PendingSignup.deleteOne({ _id: pending._id });
      return res.status(409).json({
        message: "Email already registered. Please log in with your existing account.",
        code: "EMAIL_IN_USE",
      });
    }

    let user;
    try {
      user = await User.create({
        name: pending.name,
        email: pending.email,
        password: pending.password,
        authProvider: "local",
        passwordSetByUser: true,
        role: "buyer",
        status: "active",
      });
    } catch (error) {
      if (error?.code === 11000) {
        user = await User.findOne({ email: pending.email });
        if (!user) {
          throw error;
        }
      } else {
        throw error;
      }
    }

    pending.verifiedUserId = user._id;
    await pending.save();

    sendNotificationEmail({
      to: user.email,
      title: "Welcome to Relux Hub",
      message:
        "Your email is verified and your account is active. Browse listings, place bids, or apply to become a seller anytime.",
      highlight: user.name,
      link: "/home",
    }).catch(() => {});

    return sendVerifiedSignupResponse(res, user);
  } catch (error) {
    console.error("[verifyEmail]", error.message || error);
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function resendVerification(req, res) {
  try {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const generic = {
      message: "If a pending signup exists for that email, a new verification link has been sent.",
    };

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const pending = await PendingSignup.findOne({ email });
    if (!pending) {
      return res.json(generic);
    }

    const activeUser = await User.findOne({ email });
    if (activeUser && activeUser.status !== "suspended" && activeUser.status !== "rejected") {
      await PendingSignup.deleteOne({ _id: pending._id });
      return res.json(generic);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    pending.verificationToken = hashResetToken(rawToken);
    pending.expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
    await pending.save();

    const emailResult = await sendSignupVerificationEmail({
      to: pending.email,
      name: pending.name,
      rawToken,
    });

    if (!emailResult.sent) {
      console.error(
        "[resendVerification] Verification email failed:",
        emailResult.error || emailResult.reason || "unknown",
      );
      return res.status(503).json({
        message: "Could not send verification email. Please try again in a few minutes.",
        code: "EMAIL_SEND_FAILED",
      });
    }

    res.json(generic);
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const emailNorm = email.toLowerCase().trim();
    const user = await User.findOne({ email: emailNorm });
    if (!user) {
      const pending = await PendingSignup.findOne({ email: emailNorm });
      if (pending) {
        return res.status(403).json({
          message:
            "Please verify your email before logging in. Check your inbox for the verification link.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }
      return res.status(401).json({ message: "Invalid email or password" });
    }
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.status === "suspended") {
      return res.status(403).json({
        message:
          "This account was deleted. Please go to Sign Up and create a new account with the same email.",
        code: "ACCOUNT_DELETED",
      });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken(user);
    res.json({ token, user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

function getMe(req, res) {
  res.json({ user: req.user.toPublicJSON() });
}

async function updateMe(req, res) {
  try {
    const { name, phone, city, address, twoFactorEnabled, notificationPrefs } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (name !== undefined) {
      if (!name?.trim()) {
        return res.status(400).json({ message: "Name is required" });
      }
      user.name = name.trim();
    }

    if (phone !== undefined) {
      user.phone = phone.trim();
    }

    if (city !== undefined) {
      user.city = city.trim();
    }

    if (address !== undefined) {
      user.address = address.trim();
    }

    if (twoFactorEnabled !== undefined) {
      user.twoFactorEnabled = Boolean(twoFactorEnabled);
    }

    if (notificationPrefs !== undefined && typeof notificationPrefs === "object") {
      const allowed = ["email", "sellerVerification", "reports", "support"];
      for (const key of allowed) {
        if (typeof notificationPrefs[key] === "boolean") {
          user.notificationPrefs[key] = notificationPrefs[key];
        }
      }
      user.markModified("notificationPrefs");
    }

    await user.save();
    res.json({ user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function updateEmail(req, res) {
  try {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    const password = req.body.password;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!password) {
      return res.status(400).json({ message: "Current password is required" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    const exists = await User.findOne({ email, _id: { $ne: user._id } });
    if (exists) {
      return res.status(409).json({ message: "Email already in use" });
    }

    user.email = email;
    await user.save();
    res.json({ message: "Email updated", user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function forgotPassword(req, res) {
  try {
    const email = String(req.body.email ?? "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Always return the same message so attackers cannot probe emails.
    const generic = {
      message: "If an account exists for that email, a reset link has been sent.",
    };

    const user = await User.findOne({ email });
    if (!user || user.status === "suspended") {
      return res.json(generic);
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    user.passwordResetToken = hashResetToken(rawToken);
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const emailResult = await sendNotificationEmail({
      to: user.email,
      title: "Reset Your Password",
      message:
        "Click the button below to choose a new password. This link expires in 1 hour. If you did not request a reset, you can ignore this email.",
      highlight: user.name,
      link: `/reset-password?token=${rawToken}`,
    });

    if (!emailResult.sent) {
      console.error(
        "[forgotPassword] Reset email failed:",
        emailResult.error || emailResult.reason || "unknown",
      );
    }

    res.json(generic);
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function resetPassword(req, res) {
  try {
    const token = String(req.body.token ?? "").trim();
    const password = String(req.body.password ?? "");

    if (!token) {
      return res.status(400).json({ message: "Reset token is required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({
      passwordResetToken: hashResetToken(token),
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user || user.status === "suspended") {
      return res.status(400).json({
        message: "This reset link is invalid or has expired. Request a new one.",
      });
    }

    user.password = password;
    user.passwordSetByUser = true;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    sendNotificationEmail({
      to: user.email,
      title: "Password Changed",
      message:
        "Your Relux Hub password was changed successfully. If this was not you, reset your password again immediately.",
      highlight: user.name,
      link: "/login",
    }).catch(() => {});

    res.json({ message: "Password updated. You can log in with your new password." });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function changePassword(req, res) {
  try {
    const currentPassword = String(req.body.currentPassword ?? "");
    const newPassword = String(req.body.newPassword ?? "");

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hasPassword = user.hasLocalPassword();
    if (hasPassword) {
      if (!currentPassword) {
        return res.status(400).json({ message: "Current password is required" });
      }
      if (!(await user.comparePassword(currentPassword))) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }
    }

    user.password = newPassword;
    user.passwordSetByUser = true;
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    await user.save();

    sendNotificationEmail({
      to: user.email,
      title: hasPassword ? "Password Changed" : "Password Set",
      message: hasPassword
        ? "Your Relux Hub password was changed successfully. If this was not you, reset your password again immediately."
        : "You set a Relux Hub password. You can now log in with email and password, or continue with Google.",
      highlight: user.name,
      link: "/login",
    }).catch(() => {});

    res.json({
      message: hasPassword ? "Password updated successfully" : "Password set successfully",
      user: user.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function deactivateMe(req, res) {
  try {
    const password = req.body.password;
    const confirm = req.body.confirm === true;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hasPassword = user.hasLocalPassword();
    if (hasPassword) {
      if (!password) {
        return res.status(400).json({ message: "Password is required to deactivate" });
      }
      if (!(await user.comparePassword(password))) {
        return res.status(401).json({ message: "Password is incorrect" });
      }
    } else if (!confirm) {
      return res.status(400).json({
        message: "Confirm account deletion to continue",
        code: "CONFIRM_REQUIRED",
      });
    }

    const originalEmail = user.email;

    const emailResult = await sendNotificationEmail({
      to: originalEmail,
      title: "Account Deleted",
      message:
        "Your Relux Hub account has been deleted. You can sign up again anytime using the same email address.",
      highlight: user.name,
      link: "/signup",
    });

    if (!emailResult.sent) {
      console.error(
        "[deactivateMe] Delete confirmation email failed:",
        emailResult.error || emailResult.reason || "unknown",
        "to:",
        originalEmail,
      );
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          status: "suspended",
          email: `deactivated.${user._id}.${Date.now()}@reluxhub.local`,
        },
        $unset: { googleId: "" },
      },
    );

    if (user.role === "seller") {
      await Product.updateMany(
        { sellerId: user._id, status: "active" },
        { status: "removed" },
      );
    }

    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

async function googleAuth(req, res) {
  try {
    const credential = String(req.body.credential ?? "").trim();
    if (!credential) {
      return res.status(400).json({ message: "Google credential is required" });
    }

    const clientId = String(process.env.GOOGLE_CLIENT_ID ?? "").trim();
    if (!clientId) {
      return res.status(503).json({
        message: "Google sign-in is not configured. Add GOOGLE_CLIENT_ID to backend .env",
        code: "GOOGLE_NOT_CONFIGURED",
      });
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || payload.email_verified !== true) {
      return res.status(401).json({ message: "Google account email is not verified" });
    }

    const email = payload.email.toLowerCase().trim();
    const googleId = payload.sub;
    const name = String(payload.name || payload.given_name || email.split("@")[0]).trim();

    let user = await User.findOne({ $or: [{ googleId }, { email }] });
    let isNewUser = false;

    if (user) {
      if (user.status === "suspended" || user.status === "rejected") {
        await releaseDeletedUserForReSignup(user);
        user = null;
      } else {
        if (user.googleId && user.googleId !== googleId) {
          return res.status(409).json({
            message: "This email is linked to a different Google account.",
            code: "GOOGLE_ACCOUNT_MISMATCH",
          });
        }

        if (!user.googleId) {
          user.googleId = googleId;
        }

        user.lastLoginAt = new Date();
        await user.save();
      }
    }

    if (!user) {
      const { blocked } = await releaseEmailForNewSignup(email);
      if (blocked) {
        return res.status(409).json({
          message: "Email already registered. Please log in with your existing account.",
          code: "EMAIL_IN_USE",
        });
      }

      await PendingSignup.deleteMany({ email });

      user = await User.create({
        name,
        email,
        password: crypto.randomBytes(32).toString("hex"),
        googleId,
        authProvider: "google",
        passwordSetByUser: false,
        role: "buyer",
        status: "active",
      });
      isNewUser = true;

      sendNotificationEmail({
        to: user.email,
        title: "Welcome to Relux Hub",
        message:
          "Your account has been created with Google. Browse listings, place bids, or apply to become a seller anytime.",
        highlight: user.name,
        link: "/home",
      }).catch(() => {});
    }

    const token = signToken(user);
    res.json({ token, user: user.toPublicJSON(), isNewUser });
  } catch (error) {
    console.error("[googleAuth]", error.message || error);
    res.status(401).json({ message: "Google sign-in failed. Try again or use email login." });
  }
}

module.exports = {
  register,
  verifyEmail,
  resendVerification,
  login,
  googleAuth,
  getMe,
  updateMe,
  updateEmail,
  forgotPassword,
  resetPassword,
  changePassword,
  deactivateMe,
};

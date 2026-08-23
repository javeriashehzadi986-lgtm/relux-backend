const User = require("../models/User");
const Product = require("../models/Product");
const { signToken } = require("../middleware/auth");
const { sendNotificationEmail } = require("../services/emailService");
const { releaseEmailForNewSignup } = require("../utils/releaseBlockedEmail");

function getAuthErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
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
    const user = await User.create({
      name: name.trim(),
      email: emailNorm,
      password,
      role: "buyer",
      status: "active",
    });

    sendNotificationEmail({
      to: user.email,
      title: "Welcome to Relux Hub",
      message:
        "Your account has been created successfully. Browse listings, place bids, or apply to become a seller anytime.",
      highlight: user.name,
      link: "/home",
    }).catch(() => {});

    const token = signToken(user);
    res.status(201).json({ token, user: user.toPublicJSON() });
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

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !(await user.comparePassword(password))) {
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

async function deactivateMe(req, res) {
  try {
    const password = req.body.password;
    if (!password) {
      return res.status(400).json({ message: "Password is required to deactivate" });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Password is incorrect" });
    }

    const originalEmail = user.email;

    await sendNotificationEmail({
      to: originalEmail,
      title: "Account Deleted",
      message:
        "Your Relux Hub account has been deleted. You can sign up again anytime using the same email address.",
      highlight: user.name,
      link: "/signup",
    }).catch(() => {});

    user.status = "suspended";
    user.email = `deactivated.${user._id}.${Date.now()}@reluxhub.local`;
    await user.save();

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

module.exports = { register, login, getMe, updateMe, updateEmail, deactivateMe };

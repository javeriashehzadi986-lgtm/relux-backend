const User = require("../models/User");
const { signToken } = require("../middleware/auth");

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

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: "buyer",
      status: "active",
    });

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
      return res.status(403).json({ message: "Account suspended" });
    }

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
    const { name, phone, city } = req.body;
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

    await user.save();
    res.json({ user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getAuthErrorMessage(error) });
  }
}

module.exports = { register, login, getMe, updateMe };

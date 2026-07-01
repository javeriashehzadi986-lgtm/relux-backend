const User = require("../models/User");
const SellerVerification = require("../models/SellerVerification");
const { signToken } = require("../middleware/auth");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function validateCnicDocuments(cnicFront, cnicBack) {
  if (!cnicFront?.trim() || !cnicBack?.trim()) {
    return "CNIC front and back images are required";
  }
  return null;
}

async function applyAsSeller(req, res) {
  try {
    const { name, email, password, phone, city, cnicFront, cnicBack } = req.body;

    if (!name?.trim() || !email?.trim() || !password || !phone?.trim() || !city?.trim()) {
      return res.status(400).json({
        message: "Name, email, password, phone, and city are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const cnicError = validateCnicDocuments(cnicFront, cnicBack);
    if (cnicError) {
      return res.status(400).json({ message: cnicError });
    }

    const exists = await User.findOne({ email: email.toLowerCase().trim() });
    if (exists) {
      return res.status(409).json({ message: "Email already registered. Please login first." });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      phone: phone.trim(),
      city: city.trim(),
      role: "seller",
      status: "pending",
    });

    const verification = await SellerVerification.create({
      userId: user._id,
      cnicFront: cnicFront.trim(),
      cnicBack: cnicBack.trim(),
      verificationStatus: "pending",
    });

    const token = signToken(user);
    res.status(201).json({
      token,
      user: user.toPublicJSON(),
      verification: verification.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function submitVerification(req, res) {
  try {
    const { phone, city, cnicFront, cnicBack } = req.body;

    if (req.user.role === "admin") {
      return res.status(403).json({ message: "Admins cannot submit seller verification" });
    }

    if (!phone?.trim() || !city?.trim()) {
      return res.status(400).json({ message: "Phone and city are required" });
    }

    const cnicError = validateCnicDocuments(cnicFront, cnicBack);
    if (cnicError) {
      return res.status(400).json({ message: cnicError });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.phone = phone.trim();
    user.city = city.trim();
    user.role = "seller";
    user.status = "pending";
    await user.save();

    const verification = await SellerVerification.findOneAndUpdate(
      { userId: user._id },
      {
        cnicFront: cnicFront.trim(),
        cnicBack: cnicBack.trim(),
        verificationStatus: "pending",
        reviewedAt: null,
        adminNote: "",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const token = signToken(user);
    res.json({
      token,
      user: user.toPublicJSON(),
      verification: verification.toPublicJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function updateDocuments(req, res) {
  try {
    const { cnicFront, cnicBack } = req.body;

    const cnicError = validateCnicDocuments(cnicFront, cnicBack);
    if (cnicError) {
      return res.status(400).json({ message: cnicError });
    }

    const verification = await SellerVerification.findOneAndUpdate(
      { userId: req.user._id },
      {
        cnicFront: cnicFront.trim(),
        cnicBack: cnicBack.trim(),
        verificationStatus: "pending",
        reviewedAt: null,
        adminNote: "",
      },
      { new: true },
    );

    if (!verification) {
      return res.status(404).json({ message: "Seller verification record not found" });
    }

    if (req.user.status !== "pending") {
      req.user.status = "pending";
      await req.user.save();
    }

    res.json({ verification: verification.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getMyVerification(req, res) {
  try {
    const verification = await SellerVerification.findOne({ userId: req.user._id });
    res.json({
      user: req.user.toPublicJSON(),
      verification: verification ? verification.toPublicJSON() : null,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  applyAsSeller,
  submitVerification,
  updateDocuments,
  getMyVerification,
};

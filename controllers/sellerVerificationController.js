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

async function submitVerification(req, res) {
  try {
    const {
      phone,
      city,
      returnContactName,
      returnPhone,
      returnCity,
      returnAddress,
      cnicFront,
      cnicBack,
    } = req.body;

    if (req.user.role === "admin") {
      return res.status(403).json({ message: "Admins cannot submit seller verification" });
    }

    if (req.user.role === "seller" && req.user.status === "active") {
      return res.status(400).json({ message: "You are already an approved seller" });
    }

    if (!phone?.trim() || !city?.trim()) {
      return res.status(400).json({ message: "Phone and city are required" });
    }

    const resolvedReturnName = (returnContactName || req.user.name || "").trim();
    const resolvedReturnPhone = (returnPhone || phone || "").trim();
    const resolvedReturnCity = (returnCity || city || "").trim();
    const resolvedReturnAddress = (returnAddress || "").trim();

    if (
      !resolvedReturnName ||
      !resolvedReturnPhone ||
      !resolvedReturnCity ||
      !resolvedReturnAddress
    ) {
      return res.status(400).json({
        message:
          "Return contact name, phone, city, and address are required so renters can ship items back to you",
      });
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
    user.returnContactName = resolvedReturnName;
    user.returnPhone = resolvedReturnPhone;
    user.returnCity = resolvedReturnCity;
    user.returnAddress = resolvedReturnAddress;
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

    if (req.user.status === "rejected" || req.user.status !== "pending") {
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
  submitVerification,
  updateDocuments,
  getMyVerification,
};

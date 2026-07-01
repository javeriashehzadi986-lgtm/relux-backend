const User = require("../models/User");
const SellerVerification = require("../models/SellerVerification");

function mapApplication(verification) {
  const user = verification.userId;
  if (!user) return null;

  return {
    id: verification._id.toString(),
    userId: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone || "Not provided",
    city: user.city || "Not provided",
    shopName: user.name,
    appliedAt: verification.createdAt.toISOString().slice(0, 10),
    status: verification.verificationStatus === "pending" ? "pending" : verification.verificationStatus,
    avatar: null,
    cnicFront: verification.cnicFront,
    cnicBack: verification.cnicBack,
    bankName: "Not provided",
    accountTitle: user.name,
    notes: "Seller verification request",
  };
}

async function listApplications(req, res) {
  try {
    const verifications = await SellerVerification.find({ verificationStatus: "pending" })
      .populate("userId", "name email phone city role status")
      .sort({ createdAt: -1 });

    const applications = verifications.map(mapApplication).filter(Boolean);

    const [approvedThisWeek, rejectedThisWeek] = await Promise.all([
      SellerVerification.countDocuments({
        verificationStatus: "approved",
        reviewedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
      SellerVerification.countDocuments({
        verificationStatus: "rejected",
        reviewedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    res.json({
      applications,
      stats: {
        pendingReview: applications.length,
        approvedThisWeek,
        rejectedThisWeek,
        avgReviewHours: 28,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to load seller applications" });
  }
}

async function approveApplication(req, res) {
  try {
    const verification = await SellerVerification.findById(req.params.id);
    if (!verification) {
      return res.status(404).json({ message: "Application not found" });
    }

    const user = await User.findById(verification.userId);
    if (!user) {
      return res.status(404).json({ message: "Seller user not found" });
    }

    verification.verificationStatus = "approved";
    verification.reviewedAt = new Date();
    user.status = "active";
    user.role = "seller";

    await verification.save();
    await user.save();

    res.json({
      message: "Seller approved successfully",
      application: mapApplication(await verification.populate("userId", "name email phone city role status")),
    });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to approve seller" });
  }
}

async function rejectApplication(req, res) {
  try {
    const verification = await SellerVerification.findById(req.params.id);
    if (!verification) {
      return res.status(404).json({ message: "Application not found" });
    }

    verification.verificationStatus = "rejected";
    verification.reviewedAt = new Date();
    verification.adminNote = req.body?.adminNote?.trim() || "Application rejected by admin";

    await verification.save();

    res.json({ message: "Seller application rejected" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Failed to reject seller" });
  }
}

module.exports = { listApplications, approveApplication, rejectApplication };

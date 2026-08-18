require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const sellerVerificationRoutes = require("./routes/sellerVerificationRoutes");
const adminSellerVerificationRoutes = require("./routes/adminSellerVerificationRoutes");
const listingRoutes = require("./routes/listingRoutes");
const adminListingRoutes = require("./routes/adminListingRoutes");
const wishlistRoutes = require("./routes/wishlistRoutes");
const publicListingRoutes = require("./routes/publicListingRoutes");
const messageRoutes = require("./routes/messageRoutes");
const bidRoutes = require("./routes/bidRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const catalogRoutes = require("./routes/catalogRoutes");
const buyerOrderRoutes = require("./routes/buyerOrderRoutes");
const sellerOrderRoutes = require("./routes/sellerOrderRoutes");
const reportRoutes = require("./routes/reportRoutes");
const adminReportRoutes = require("./routes/adminReportRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const adminUserRoutes = require("./routes/adminUserRoutes");
const adminOrderRoutes = require("./routes/adminOrderRoutes");
const contactRoutes = require("./routes/contactRoutes");
const adminContactRoutes = require("./routes/adminContactRoutes");
const adminNotificationRoutes = require("./routes/adminNotificationRoutes");
const adminCategoryRoutes = require("./routes/adminCategoryRoutes");
const adminReviewRoutes = require("./routes/adminReviewRoutes");

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/", (req, res) => {
  res.json({ message: "ReluxHub Auth API is running" });
});

app.get("/api/health", async (req, res) => {
  const mongoose = require("mongoose");
  let database = "disconnected";

  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.admin().ping();
      database = "connected";
    }
  } catch {
    database = "disconnected";
  }

  res.json({
    status: database === "connected" ? "ok" : "error",
    database,
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/seller/verification", sellerVerificationRoutes);
app.use("/api/admin/seller-verifications", adminSellerVerificationRoutes);
app.use("/api/seller/listings", listingRoutes);
app.use("/api/admin/listings", adminListingRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use("/api/listings", publicListingRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/bids", bidRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/catalog", catalogRoutes);
app.use("/api/buyer/orders", buyerOrderRoutes);
app.use("/api/seller/orders", sellerOrderRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/admin/reports", adminReportRoutes);
app.use("/api/admin/users", adminUserRoutes);
app.use("/api/admin/orders", adminOrderRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin/contact", adminContactRoutes);
app.use("/api/admin/reviews", adminReviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin/notifications", adminNotificationRoutes);
app.use("/api/admin/categories", adminCategoryRoutes);

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      message:
        "Images are too large. Use smaller JPG/PNG files (under 4MB each) and try again.",
    });
  }
  next(error);
});

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Auth server running on http://localhost:${PORT}`);
  });
};

startServer();

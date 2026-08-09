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
app.use("/api/notifications", notificationRoutes);

const startServer = async () => {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Auth server running on http://localhost:${PORT}`);
  });
};

startServer();
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const sellerVerificationRoutes = require("./routes/sellerVerificationRoutes");
const adminSellerVerificationRoutes = require("./routes/adminSellerVerificationRoutes");

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

app.use((error, req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({
      message: "Images are too large. Use smaller JPG/PNG files (under 4MB each) and try again.",
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

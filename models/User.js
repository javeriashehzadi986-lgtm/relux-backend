const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    phone: { type: String, trim: true, default: "" },
    city: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    googleId: { type: String, trim: true, sparse: true, unique: true },
    authProvider: { type: String, enum: ["local", "google"], default: "local" },
    role: { type: String, enum: ["buyer", "seller", "admin"], default: "buyer" },
    status: { type: String, enum: ["active", "pending", "rejected", "suspended"], default: "active" },
    lastLoginAt: { type: Date, default: null },
    twoFactorEnabled: { type: Boolean, default: false },
    notificationPrefs: {
      email: { type: Boolean, default: true },
      sellerVerification: { type: Boolean, default: true },
      reports: { type: Boolean, default: false },
      support: { type: Boolean, default: true },
    },
    passwordResetToken: { type: String, default: null },
    passwordResetExpires: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    role: this.role,
    status: this.status,
    phone: this.phone,
    city: this.city,
    address: this.address,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    twoFactorEnabled: Boolean(this.twoFactorEnabled),
    notificationPrefs: {
      email: this.notificationPrefs?.email !== false,
      sellerVerification: this.notificationPrefs?.sellerVerification !== false,
      reports: Boolean(this.notificationPrefs?.reports),
      support: this.notificationPrefs?.support !== false,
    },
  };
};

module.exports = mongoose.model("User", userSchema);

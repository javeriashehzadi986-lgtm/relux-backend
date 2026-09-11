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
    returnContactName: { type: String, trim: true, default: "" },
    returnPhone: { type: String, trim: true, default: "" },
    returnCity: { type: String, trim: true, default: "" },
    returnAddress: { type: String, trim: true, default: "" },
    googleId: { type: String, trim: true, sparse: true, unique: true },
    authProvider: { type: String, enum: ["local", "google"], default: "local" },
    // true = user chose a Relux password. false/missing for Google-only until they set one.
    passwordSetByUser: { type: Boolean },
    role: { type: String, enum: ["buyer", "seller", "admin"], default: "buyer" },
    status: { type: String, enum: ["active", "pending", "rejected", "suspended", "banned"], default: "active" },
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
  // Pending signup may already store a bcrypt hash — do not hash twice.
  if (/^\$2[aby]?\$\d{2}\$/.test(String(this.password ?? ""))) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.hasLocalPassword = function hasLocalPassword() {
  // Google accounts only count as having a password after an explicit Set Password.
  if (this.authProvider === "google") {
    return this.passwordSetByUser === true;
  }
  // Email/password (and linked) accounts: treat as having a password unless marked false.
  return this.passwordSetByUser !== false;
};

userSchema.methods.getReturnContactSnapshot = function getReturnContactSnapshot() {
  return {
    name: (this.returnContactName || this.name || "").trim(),
    phone: (this.returnPhone || this.phone || "").trim(),
    city: (this.returnCity || this.city || "").trim(),
    address: (this.returnAddress || "").trim(),
    email: (this.email || "").trim(),
  };
};

userSchema.methods.hasCompleteReturnContact = function hasCompleteReturnContact() {
  const contact = this.getReturnContactSnapshot();
  return Boolean(contact.name && contact.phone && contact.city && contact.address);
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
    returnContactName: this.returnContactName || "",
    returnPhone: this.returnPhone || "",
    returnCity: this.returnCity || "",
    returnAddress: this.returnAddress || "",
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
    authProvider: this.authProvider || "local",
    hasPassword: this.hasLocalPassword(),
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

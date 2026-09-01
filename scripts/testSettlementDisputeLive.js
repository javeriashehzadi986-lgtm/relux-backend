/**
 * Live API smoke test — dispute + admin resolve path.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Report = require("../models/Report");

const BASE = `http://localhost:${process.env.PORT || 5002}`;
const TEST_TAG = `settlement-dispute-${Date.now()}`;

async function api(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(email, password) {
  const { status, data } = await api("POST", "/api/auth/login", null, { email, password });
  if (status !== 200 || !data.token) {
    throw new Error(`Login failed: ${status} ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URL);
  const password = "DisputeTest123!";
  const hashed = await bcrypt.hash(password, 10);

  const seller = await User.create({
    name: "Dispute Test Seller",
    email: `${TEST_TAG}-seller@test.local`,
    password: hashed,
    role: "seller",
    status: "active",
  });
  const buyer = await User.create({
    name: "Dispute Test Buyer",
    email: `${TEST_TAG}-buyer@test.local`,
    password: hashed,
    role: "buyer",
    status: "active",
  });
  let admin = await User.findOne({ email: `${TEST_TAG}-admin@test.local` });
  if (!admin) {
    admin = await User.create({
      name: "Dispute Test Admin",
      email: `${TEST_TAG}-admin@test.local`,
      password: hashed,
      role: "admin",
      status: "active",
    });
  }

  const product = await Product.create({
    sellerId: seller._id,
    title: `Dispute Test Dress ${TEST_TAG}`,
    listingType: "rent",
    mainCategory: "Dresses",
    rentPrice: "5000",
    itemPrice: "50000",
    mainImage: "https://example.com/test.jpg",
    verificationStatus: "approved",
    status: "rented",
  });

  const order = await Order.create({
    orderId: `RH-DISP-${Date.now()}`,
    buyerId: buyer._id,
    sellerId: seller._id,
    productId: product._id,
    type: "rental",
    status: "approved",
    paymentStatus: "paid",
    escrowStatus: "held",
    escrowSettlementStatus: "none",
    amountPkr: 50000,
    rentalDays: 3,
    fulfillmentStatus: "returned",
    paidAt: new Date(),
    escrowHeldAt: new Date(),
  });

  try {
    const sellerToken = await login(seller.email, password);
    const buyerToken = await login(buyer.email, password);
    const adminToken = await login(admin.email, password);

    const propose = await api(
      "POST",
      `/api/seller/orders/${order._id}/settlement/propose`,
      sellerToken,
      { damageDeductionPkr: 10000, settlementNote: "Significant damage" },
    );
    if (propose.status !== 200) throw new Error(`Propose failed: ${JSON.stringify(propose.data)}`);
    console.log("1. Proposed:", propose.data.message);

    const dispute = await api(
      "POST",
      `/api/buyer/orders/${order._id}/settlement/dispute`,
      buyerToken,
      { disputeReason: "Damage charge is excessive for normal wear" },
    );
    if (dispute.status !== 200) throw new Error(`Dispute failed: ${JSON.stringify(dispute.data)}`);
    console.log("2. Disputed:", dispute.data.message, "| reportId:", dispute.data.reportId);

    const resolve = await api(
      "POST",
      `/api/admin/orders/${order._id}/settlement/resolve`,
      adminToken,
      {
        rentalChargePkr: 15000,
        damageDeductionPkr: 2000,
        decision: "Admin reduced damage after review",
      },
    );
    if (resolve.status !== 200) throw new Error(`Resolve failed: ${JSON.stringify(resolve.data)}`);
    console.log("3. Admin resolved:", resolve.data.message);

    const updated = await Order.findById(order._id);
    console.log("4. Final state:", {
      escrowSettlementStatus: updated.escrowSettlementStatus,
      escrowStatus: updated.escrowStatus,
      refundAmountPkr: updated.refundAmountPkr,
      damageDeductionPkr: updated.damageDeductionPkr,
    });

    if (updated.escrowSettlementStatus !== "admin_settled" || updated.escrowStatus !== "released") {
      throw new Error("Expected admin_settled + released");
    }

    console.log("\n✓ Live dispute → admin resolve flow passed.\n");
  } finally {
    const fresh = await Order.findById(order._id);
    if (fresh?.disputeReportId) await Report.deleteOne({ _id: fresh.disputeReportId });
    await Order.deleteOne({ _id: order._id });
    await Product.deleteOne({ _id: product._id });
    await User.deleteMany({ _id: { $in: [seller._id, buyer._id, admin._id] } });
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error("\n✗ Dispute test failed:", error.message || error);
  process.exit(1);
});

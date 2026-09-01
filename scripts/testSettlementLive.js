/**
 * Live API smoke test for rental escrow settlement flow.
 * Creates a temporary order in MongoDB, exercises propose → accept via HTTP, then cleans up.
 *
 * Usage: node scripts/testSettlementLive.js
 * Requires: backend running on PORT (default 5002), MONGODB_URL in .env
 */
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Report = require("../models/Report");

const BASE = `http://localhost:${process.env.PORT || 5002}`;
const TEST_TAG = `settlement-live-${Date.now()}`;

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
    throw new Error(`Login failed for ${email}: ${status} ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function ensureTestUsers() {
  const password = "SettlementTest123!";
  const hashed = await bcrypt.hash(password, 10);

  let seller = await User.findOne({ email: `${TEST_TAG}-seller@test.local` });
  if (!seller) {
    seller = await User.create({
      name: "Settlement Test Seller",
      email: `${TEST_TAG}-seller@test.local`,
      password: hashed,
      role: "seller",
      status: "active",
    });
  }

  let buyer = await User.findOne({ email: `${TEST_TAG}-buyer@test.local` });
  if (!buyer) {
    buyer = await User.create({
      name: "Settlement Test Buyer",
      email: `${TEST_TAG}-buyer@test.local`,
      password: hashed,
      role: "buyer",
      status: "active",
    });
  }

  return { seller, buyer, password };
}

async function createTestOrder(seller, buyer) {
  const product = await Product.create({
    sellerId: seller._id,
    title: `Settlement Test Dress ${TEST_TAG}`,
    listingType: "rent",
    mainCategory: "Dresses",
    rentPrice: "5000",
    itemPrice: "50000",
    mainImage: "https://example.com/test.jpg",
    verificationStatus: "approved",
    status: "rented",
  });

  const order = await Order.create({
    orderId: `RH-LIVE-${Date.now()}`,
    buyerId: buyer._id,
    sellerId: seller._id,
    productId: product._id,
    type: "rental",
    status: "approved",
    paymentStatus: "paid",
    escrowStatus: "held",
    escrowSettlementStatus: "none",
    amountPkr: 50000,
    itemAmountPkr: 50000,
    rentalDays: 3,
    fulfillmentStatus: "returned",
    paidAt: new Date(),
    escrowHeldAt: new Date(),
    buyerName: buyer.name,
  });

  return { order, product };
}

async function cleanup({ order, product, seller, buyer }) {
  if (order?.disputeReportId) {
    await Report.deleteOne({ _id: order.disputeReportId });
  }
  if (order?._id) await Order.deleteOne({ _id: order._id });
  if (product?._id) await Product.deleteOne({ _id: product._id });
  await User.deleteMany({
    _id: { $in: [seller?._id, buyer?._id].filter(Boolean) },
  });
}

async function main() {
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health?.ok) {
    throw new Error(`Backend not reachable at ${BASE}. Start with: npm start`);
  }

  await mongoose.connect(process.env.MONGODB_URL);

  let ctx = {};
  try {
    const { seller, buyer, password } = await ensureTestUsers();
    ctx = await createTestOrder(seller, buyer);
    ctx.seller = seller;
    ctx.buyer = buyer;

    const sellerToken = await login(seller.email, password);
    const buyerToken = await login(buyer.email, password);

    console.log("\n1. Seller proposes settlement...");
    const propose = await api(
      "POST",
      `/api/seller/orders/${ctx.order._id}/settlement/propose`,
      sellerToken,
      { damageDeductionPkr: 3000, settlementNote: "Live test — minor hem mark" },
    );
    console.log(`   Status: ${propose.status}`, propose.data.message || "");
    if (propose.status !== 200) throw new Error(JSON.stringify(propose.data));

    console.log("\n2. Buyer fetches settlement breakdown...");
    const getSettle = await api(
      "GET",
      `/api/buyer/orders/${ctx.order._id}/settlement`,
      buyerToken,
    );
    console.log(`   Status: ${getSettle.status}`);
    console.log(
      `   Refund: PKR ${getSettle.data.settlement?.refundAmountPkr}, Rent: PKR ${getSettle.data.settlement?.rentalChargePkr}`,
    );
    if (getSettle.status !== 200) throw new Error(JSON.stringify(getSettle.data));

    console.log("\n3. Buyer accepts settlement...");
    const accept = await api(
      "POST",
      `/api/buyer/orders/${ctx.order._id}/settlement/accept`,
      buyerToken,
    );
    console.log(`   Status: ${accept.status}`, accept.data.message || "");
    if (accept.status !== 200) throw new Error(JSON.stringify(accept.data));

    const updated = await Order.findById(ctx.order._id);
    console.log("\n4. Order state after accept:");
    console.log(`   escrowSettlementStatus: ${updated.escrowSettlementStatus}`);
    console.log(`   escrowStatus: ${updated.escrowStatus}`);
    console.log(`   refundAmountPkr: ${updated.refundAmountPkr}`);
    console.log(`   sellerPayoutPkr: ${updated.sellerPayoutPkr}`);

    if (updated.escrowSettlementStatus !== "accepted") {
      throw new Error("Expected escrowSettlementStatus=accepted");
    }
    if (updated.escrowStatus !== "released") {
      throw new Error("Expected escrowStatus=released");
    }

    console.log("\n✓ Live settlement flow (propose → accept → release) passed.\n");
  } finally {
    await cleanup(ctx);
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error("\n✗ Live test failed:", error.message || error);
  process.exit(1);
});

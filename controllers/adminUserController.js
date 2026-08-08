const User = require("../models/User");
const Order = require("../models/Order");
const SellerVerification = require("../models/SellerVerification");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function formatJoinedAt(date) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 10);
}

async function toAdminUserJSON(user, ordersCount = 0) {
  const verified =
    user.role === "seller"
      ? user.status === "active"
      : user.status === "active" || user.status === "suspended";

  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    joinedAt: formatJoinedAt(user.createdAt),
    ordersCount,
    avatar: null,
    phone: user.phone || "Not provided",
    city: user.city || "Not provided",
    verified,
  };
}

async function getOrdersCountMap(userIds) {
  if (!userIds.length) return new Map();

  const [buyerCounts, sellerCounts] = await Promise.all([
    Order.aggregate([
      { $match: { buyerId: { $in: userIds } } },
      { $group: { _id: "$buyerId", count: { $sum: 1 } } },
    ]),
    Order.aggregate([
      { $match: { sellerId: { $in: userIds } } },
      { $group: { _id: "$sellerId", count: { $sum: 1 } } },
    ]),
  ]);

  const map = new Map();
  for (const row of buyerCounts) {
    map.set(String(row._id), (map.get(String(row._id)) || 0) + row.count);
  }
  for (const row of sellerCounts) {
    map.set(String(row._id), (map.get(String(row._id)) || 0) + row.count);
  }
  return map;
}

/** Admin: list buyers & sellers with stats */
async function listUsers(req, res) {
  try {
    const { role, status, q } = req.query;
    const filter = { role: { $in: ["buyer", "seller"] } };

    if (role === "buyer" || role === "seller") {
      filter.role = role;
    }
    if (status && status !== "all") {
      filter.status = status;
    }
    if (q?.trim()) {
      const query = q.trim();
      filter.$or = [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ];
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).limit(500);
    const ids = users.map((user) => user._id);
    const ordersMap = await getOrdersCountMap(ids);

    const mapped = await Promise.all(
      users.map((user) =>
        toAdminUserJSON(user, ordersMap.get(user._id.toString()) || 0),
      ),
    );

    const [totalUsers, buyers, sellers, pendingVerification] = await Promise.all([
      User.countDocuments({ role: { $in: ["buyer", "seller"] } }),
      User.countDocuments({ role: "buyer" }),
      User.countDocuments({ role: "seller" }),
      User.countDocuments({ role: "seller", status: "pending" }),
    ]);

    res.json({
      users: mapped,
      stats: {
        totalUsers,
        buyers,
        sellers,
        pendingVerification,
      },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function findManagedUser(id) {
  const user = await User.findById(id);
  if (!user) return { error: { status: 404, message: "User not found" } };
  if (user.role === "admin") {
    return { error: { status: 403, message: "Admin accounts cannot be managed here" } };
  }
  return { user };
}

/** Admin: suspend buyer/seller */
async function suspendUser(req, res) {
  try {
    if (String(req.user._id) === String(req.params.id)) {
      return res.status(400).json({ message: "You cannot suspend your own account" });
    }

    const { user, error } = await findManagedUser(req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    user.status = "suspended";
    await user.save();

    const ordersMap = await getOrdersCountMap([user._id]);
    res.json({
      message: "Account suspended",
      user: await toAdminUserJSON(user, ordersMap.get(user._id.toString()) || 0),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: reactivate suspended (or rejected) user */
async function reactivateUser(req, res) {
  try {
    const { user, error } = await findManagedUser(req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    if (user.role === "seller") {
      const verification = await SellerVerification.findOne({ userId: user._id });
      if (verification && verification.verificationStatus !== "approved") {
        user.status = "pending";
      } else {
        user.status = "active";
      }
    } else {
      user.status = "active";
    }

    await user.save();

    const ordersMap = await getOrdersCountMap([user._id]);
    res.json({
      message: "Account reactivated",
      user: await toAdminUserJSON(user, ordersMap.get(user._id.toString()) || 0),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: approve pending seller from Users panel */
async function approveUser(req, res) {
  try {
    const { user, error } = await findManagedUser(req.params.id);
    if (error) return res.status(error.status).json({ message: error.message });

    if (user.status !== "pending") {
      return res.status(400).json({ message: "Only pending users can be approved here" });
    }

    user.status = "active";
    if (user.role !== "seller") {
      user.role = "seller";
    }
    await user.save();

    const verification = await SellerVerification.findOne({ userId: user._id });
    if (verification) {
      verification.verificationStatus = "approved";
      verification.reviewedAt = new Date();
      await verification.save();
    }

    const ordersMap = await getOrdersCountMap([user._id]);
    res.json({
      message: "User approved",
      user: await toAdminUserJSON(user, ordersMap.get(user._id.toString()) || 0),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  listUsers,
  suspendUser,
  reactivateUser,
  approveUser,
};

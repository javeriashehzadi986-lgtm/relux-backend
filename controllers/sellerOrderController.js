const Order = require("../models/Order");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

async function getMySellerOrders(req, res) {
  try {
    const orders = await Order.find({
      sellerId: req.user._id,
      status: { $nin: ["cancelled"] },
    })
      .populate("buyerId", "name email")
      .sort({ createdAt: -1 });

    // Rejected can stay briefly or be hidden — hide rejected from active seller inbox
    const visible = orders.filter((order) => order.status !== "rejected");

    res.json({ orders: visible.map((order) => order.toSellerJSON()) });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function approveOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    }).populate("buyerId", "name email");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({ message: "Only pending requests can be approved" });
    }

    order.status = "approved";
    await order.save();

    res.json({ message: "Request approved", order: order.toSellerJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function rejectOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "pending") {
      return res.status(400).json({ message: "Only pending requests can be rejected" });
    }

    order.status = "rejected";
    await order.save();

    res.json({ message: "Request rejected" });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function completeOrder(req, res) {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      sellerId: req.user._id,
    }).populate("buyerId", "name email");

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.status !== "approved") {
      return res.status(400).json({ message: "Only approved orders can be completed" });
    }

    order.status = "completed";
    await order.save();

    res.json({ message: "Order completed", order: order.toSellerJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  getMySellerOrders,
  approveOrder,
  rejectOrder,
  completeOrder,
};

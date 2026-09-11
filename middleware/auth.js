const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "relux-hub-dev-secret";

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
}

async function protect(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) {
      return res.status(401).json({ message: "User not found" });
    }
    if (req.user.status === "banned") {
      return res.status(403).json({
        message: "This account has been suspended by an admin. Contact support for details.",
        code: "ACCOUNT_BANNED",
      });
    }
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}

async function optionalProtect(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return next();
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
  } catch {
    req.user = null;
  }

  next();
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Not authorized" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have access to this resource" });
    }
    next();
  };
}

module.exports = { signToken, protect, optionalProtect, authorize, JWT_SECRET };

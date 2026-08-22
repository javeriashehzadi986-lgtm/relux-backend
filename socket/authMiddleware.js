const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { JWT_SECRET } = require("../middleware/auth");

async function attachOptionalUser(socket, next) {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.user = null;
      return next();
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    socket.user = user ?? null;
    next();
  } catch {
    socket.user = null;
    next();
  }
}

module.exports = { attachOptionalUser };

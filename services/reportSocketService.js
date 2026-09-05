const User = require("../models/User");
const { getIO } = require("../socket/io");

function idOf(ref) {
  if (!ref) return null;
  if (typeof ref === "object" && ref._id) return String(ref._id);
  return String(ref);
}

/**
 * Notify reporter, involved parties, and admins that a support report changed.
 * Clients listen for `report:updated` on the shared authenticated socket.
 */
async function emitReportUpdated(report, extra = {}) {
  const io = getIO();
  if (!io || !report) return;

  const mongoId = idOf(report._id);
  const reportId = report.reportId || mongoId;
  if (!reportId && !mongoId) return;

  const reporterId = idOf(report.reporterId);
  const involvedSellerId = idOf(report.involvedSellerId);
  const involvedBuyerId = idOf(report.involvedBuyerId);
  const reporterRole = report.reporterRole === "seller" ? "seller" : "buyer";

  const notifiedUsers = new Set();

  const emitToUser = (userId, role, reportPayload) => {
    if (!userId || notifiedUsers.has(userId)) return;
    notifiedUsers.add(userId);
    io.to(`user:${userId}`).emit("report:updated", {
      reportId,
      mongoId,
      role,
      report: reportPayload,
      ...extra,
    });
  };

  if (reporterId) {
    let payload = null;
    try {
      payload = report.toReporterJSON(reporterId, reporterRole);
    } catch {
      // Serialization is best-effort; clients can silent-refresh.
    }
    emitToUser(reporterId, reporterRole, payload);
  }

  if (involvedSellerId) {
    let payload = null;
    try {
      payload = report.toReporterJSON(involvedSellerId, "seller");
    } catch {
      // ignore
    }
    emitToUser(involvedSellerId, "seller", payload);
  }

  if (involvedBuyerId) {
    let payload = null;
    try {
      payload = report.toReporterJSON(involvedBuyerId, "buyer");
    } catch {
      // ignore
    }
    emitToUser(involvedBuyerId, "buyer", payload);
  }

  let adminPayload = null;
  try {
    adminPayload = report.toAdminJSON();
  } catch {
    // ignore
  }

  const admins = await User.find({ role: "admin" }).select("_id").lean();
  for (const admin of admins) {
    const adminId = idOf(admin._id);
    if (!adminId || notifiedUsers.has(adminId)) continue;
    notifiedUsers.add(adminId);
    io.to(`user:${adminId}`).emit("report:updated", {
      reportId,
      mongoId,
      role: "admin",
      report: adminPayload,
      ...extra,
    });
  }
}

module.exports = {
  emitReportUpdated,
};

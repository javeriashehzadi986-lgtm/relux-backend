const Notification = require("../models/Notification");
const User = require("../models/User");
const { sendNotificationEmail } = require("./emailService");

function toUserId(value) {
  if (!value) return null;
  return String(value._id ?? value);
}

async function createNotification(payload) {
  const userId = toUserId(payload.userId);
  if (!userId) return null;

  return Notification.create({
    userId,
    title: payload.title,
    message: payload.message,
    highlight: payload.highlight ?? "",
    category: payload.category ?? "system",
    iconVariant: payload.iconVariant ?? "primary",
    imageUrl: payload.imageUrl ?? "",
    link: payload.link ?? "",
  });
}

async function sendEmailForNotification(userId, payload) {
  try {
    const user = await User.findById(userId).select("email notificationPrefs").lean();
    if (!user?.email || user.notificationPrefs?.email === false) return;

    await sendNotificationEmail({
      to: user.email,
      title: payload.title,
      message: payload.message,
      highlight: payload.highlight,
      link: payload.link,
    });
  } catch {
    // Email failures should not break in-app notifications.
  }
}

async function notifyUser(payload) {
  const userId = toUserId(payload.userId);
  if (!userId) return null;

  const notification = await createNotification(payload).catch(() => null);
  sendEmailForNotification(userId, payload);
  return notification;
}

function notifyRentalRequest({ sellerId, productTitle, orderId }) {
  return notifyUser({
    userId: sellerId,
    title: "New Rental Request",
    message: "A buyer submitted a rental request. Review and respond from your orders inbox.",
    highlight: productTitle,
    category: "orders",
    iconVariant: "secondary",
    link: "/sellerProfile?section=orders",
  });
}

function notifyRentalCancelled({ sellerId, productTitle }) {
  return notifyUser({
    userId: sellerId,
    title: "Rental Request Cancelled",
    message: "The buyer cancelled their pending rental request.",
    highlight: productTitle,
    category: "orders",
    iconVariant: "muted",
    link: "/sellerProfile?section=orders",
  });
}

function notifyBookingConfirmed({ buyerId, productTitle, orderId }) {
  return notifyUser({
    userId: buyerId,
    title: "Booking Confirmed",
    message: "Your dress booking has been confirmed. Get ready to shine!",
    highlight: productTitle,
    category: "orders",
    iconVariant: "primary",
    link: "/profile?section=orders",
  });
}

function notifyBookingRejected({ buyerId, productTitle }) {
  return notifyUser({
    userId: buyerId,
    title: "Request Declined",
    message: "The seller declined your rental request. Browse other listings to find your look.",
    highlight: productTitle,
    category: "orders",
    iconVariant: "muted",
    link: "/profile?section=orders",
  });
}

function notifyRentalCompleted({ buyerId, productTitle }) {
  return notifyUser({
    userId: buyerId,
    title: "Rental Completed",
    message: "Your rental has been marked complete. Thank you for choosing Relux Hub.",
    highlight: productTitle,
    category: "orders",
    iconVariant: "tertiary",
    link: "/profile?section=orders",
  });
}

function notifyListingApproved({ sellerId, productTitle, productId }) {
  return notifyUser({
    userId: sellerId,
    title: "Listing Accepted",
    message: "Your listing has been approved and is now live on Relux Hub.",
    highlight: productTitle,
    category: "listings",
    iconVariant: "tertiary",
    link: productId ? `/dress/${productId}` : "/sellerProfile?section=listings",
  });
}

function notifyListingRejected({ sellerId, productTitle }) {
  return notifyUser({
    userId: sellerId,
    title: "Listing Rejected",
    message: "Your listing was not approved. Update details and submit again.",
    highlight: productTitle,
    category: "listings",
    iconVariant: "muted",
    link: "/sellerProfile?section=listings",
  });
}

function notifySellerApproved({ sellerId }) {
  return notifyUser({
    userId: sellerId,
    title: "Seller Account Approved",
    message: "Your seller account is approved. You can now publish listings on Relux Hub.",
    category: "system",
    iconVariant: "primary",
    link: "/sellerProfile",
  });
}

function notifySellerRejected({ sellerId }) {
  return notifyUser({
    userId: sellerId,
    title: "Seller Application Rejected",
    message: "Your seller application was not approved. Review feedback and apply again if needed.",
    category: "system",
    iconVariant: "muted",
    link: "/seller-rejected",
  });
}

function notifySellerMoreInfoRequested({ sellerId, adminNote }) {
  return notifyUser({
    userId: sellerId,
    title: "More Information Needed",
    message: adminNote || "Please update your seller verification documents and resubmit.",
    category: "system",
    iconVariant: "secondary",
    link: "/seller-pending",
  });
}

function notifyNewBid({ sellerId, productTitle, productId, amountFormatted }) {
  return notifyUser({
    userId: sellerId,
    title: "New Bid Received",
    message: `A buyer placed a bid of ${amountFormatted} on your auction listing.`,
    highlight: productTitle,
    category: "bids",
    iconVariant: "primary",
    link: productId ? `/dress/${productId}` : "/sellerProfile?section=listings",
  });
}

function notifyOutbid({ buyerId, productTitle, productId }) {
  return notifyUser({
    userId: buyerId,
    title: "You Have Been Outbid",
    message: "Another buyer placed a higher bid. Increase your bid to stay in the lead.",
    highlight: productTitle,
    category: "bids",
    iconVariant: "secondary",
    link: productId ? `/dress/${productId}` : "/profile?section=bids",
  });
}

function notifyAuctionWon({ buyerId, productTitle, productId, amountFormatted }) {
  return notifyUser({
    userId: buyerId,
    title: "You Won the Auction",
    message: amountFormatted
      ? `Congratulations! You won with a final bid of ${amountFormatted}. The seller will follow up next.`
      : "Congratulations! You won this auction. The seller will follow up next.",
    highlight: productTitle,
    category: "bids",
    iconVariant: "primary",
    link: productId ? `/dress/${productId}` : "/profile?section=bids",
  });
}

function notifyAuctionEnded({ sellerId, productTitle, productId, amountFormatted, hasWinner }) {
  return notifyUser({
    userId: sellerId,
    title: hasWinner ? "Auction Ended — Sold" : "Auction Ended — No Bids",
    message: hasWinner
      ? `Your auction ended. Winning bid: ${amountFormatted || "N/A"}.`
      : "Your auction ended without any bids. You can update the listing and try again.",
    highlight: productTitle,
    category: "bids",
    iconVariant: hasWinner ? "tertiary" : "muted",
    link: productId ? `/dress/${productId}` : "/sellerProfile?section=listings",
  });
}

function notifyNewMessage({
  userId,
  senderName,
  preview,
  conversationId,
  listingTitle,
}) {
  return notifyUser({
    userId,
    title: "New Message",
    message: preview || "You received a new message.",
    highlight: senderName || listingTitle || "Someone",
    category: "system",
    iconVariant: "primary",
    link: conversationId ? `/messages/${conversationId}` : "/messages",
  });
}

function iconForPriority(priority) {
  if (priority === "urgent") return "muted";
  if (priority === "important") return "secondary";
  return "primary";
}

async function notifyBroadcast({ userIds, title, message, priority }) {
  const uniqueIds = [...new Set((userIds || []).map(toUserId).filter(Boolean))];
  if (!uniqueIds.length) return 0;

  const docs = uniqueIds.map((userId) => ({
    userId,
    title,
    message,
    highlight: "Relux Hub",
    category: "system",
    iconVariant: iconForPriority(priority),
    link: "/notification",
  }));

  const created = await Notification.insertMany(docs);

  const users = await User.find({ _id: { $in: uniqueIds } })
    .select("email notificationPrefs")
    .lean();

  const emailPayload = {
    title,
    message,
    highlight: "Relux Hub",
    link: "/notification",
  };

  await Promise.all(
    users
      .filter((user) => user.email && user.notificationPrefs?.email !== false)
      .map((user) =>
        sendNotificationEmail({
          to: user.email,
          ...emailPayload,
        }).catch(() => null),
      ),
  );

  return created.length;
}

module.exports = {
  createNotification,
  notifyUser,
  notifyRentalRequest,
  notifyRentalCancelled,
  notifyBookingConfirmed,
  notifyBookingRejected,
  notifyRentalCompleted,
  notifyListingApproved,
  notifyListingRejected,
  notifySellerApproved,
  notifySellerRejected,
  notifySellerMoreInfoRequested,
  notifyNewBid,
  notifyOutbid,
  notifyAuctionWon,
  notifyAuctionEnded,
  notifyNewMessage,
  notifyBroadcast,
};

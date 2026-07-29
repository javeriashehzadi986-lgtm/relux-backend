const Notification = require("../models/Notification");

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

function notifyUser(payload) {
  return createNotification(payload).catch(() => null);
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
  notifyNewBid,
  notifyOutbid,
  notifyNewMessage,
};

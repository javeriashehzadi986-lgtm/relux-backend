const Notification = require("../models/Notification");
const User = require("../models/User");
const { sendNotificationEmail, sendSellerDispatchDetailsEmail, sendBuyerReturnInstructionsEmail } = require("./emailService");

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
    if (!user?.email) {
      console.warn("[email] skip — user has no email", String(userId));
      return;
    }
    if (user.notificationPrefs?.email === false) {
      console.warn("[email] skip — email notifications disabled for", user.email);
      return;
    }

    const result = await sendNotificationEmail({
      to: user.email,
      title: payload.title,
      message: payload.message,
      highlight: payload.highlight,
      link: payload.link,
    });

    if (result?.skipped) {
      console.warn("[email] skip —", result.reason, "to", user.email, payload.title);
    } else if (result?.error) {
      console.error("[email] failed —", result.error, "to", user.email, payload.title);
    } else if (result?.sent) {
      console.log("[email] sent —", payload.title, "→", user.email);
    }
  } catch (error) {
    console.error("[email] unexpected error", error.message || error);
  }
}

async function notifyUser(payload) {
  const userId = toUserId(payload.userId);
  if (!userId) return null;

  const notification = await createNotification(payload).catch(() => null);
  sendEmailForNotification(userId, payload);
  return notification;
}

async function notifyAdmins(payload) {
  const admins = await User.find({ role: "admin" }).select("_id").lean();
  if (!admins.length) return [];

  return Promise.all(
    admins.map((admin) => notifyUser({ ...payload, userId: admin._id })),
  );
}

function notifyRentalRequest({ sellerId, productTitle, orderId, rentalDays, rentStart, rentEnd }) {
  const days = Math.max(1, Number(rentalDays) || 1);
  const daysText = days === 1 ? "1 day" : `${days} days`;
  const formatDate = (iso) => {
    if (!iso) return "";
    return new Date(`${String(iso).slice(0, 10)}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };
  const startLabel = formatDate(rentStart);
  const endLabel = formatDate(rentEnd);
  const periodText =
    startLabel && endLabel
      ? ` for ${daysText} (${startLabel} – ${endLabel})`
      : ` for ${daysText}`;

  return notifyUser({
    userId: sellerId,
    title: "New Rental Request",
    message: `A buyer requested a rental${periodText}. Review and respond from your orders inbox.`,
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
    title: "Booking Approved — Payment Due",
    message:
      "The seller approved your rental. Complete Stripe payment for the security deposit to activate it.",
    highlight: productTitle,
    category: "payments",
    iconVariant: "primary",
    link: "/profile?section=orders",
  });
}

function notifyRentalOrderPaid({ sellerId, productTitle, orderId }) {
  return notifyUser({
    userId: sellerId,
    title: "Rental Deposit Paid",
    message:
      "The buyer paid the security deposit via Stripe. Buyer shipping details were emailed to you — prepare the item for dispatch.",
    highlight: productTitle,
    category: "payments",
    iconVariant: "secondary",
    link: "/sellerProfile?section=orders",
  });
}

async function notifySellerDispatchDetails({ sellerId, order, product, buyer }) {
  const seller = await User.findById(sellerId).select("email name").lean();
  if (!seller?.email) {
    console.warn("[email] dispatch skip — seller has no email", String(sellerId));
    return null;
  }

  try {
    const result = await sendSellerDispatchDetailsEmail({
      to: seller.email,
      order,
      product,
      buyer,
    });
    if (result?.skipped) {
      console.warn("[email] dispatch skip —", result.reason, "to", seller.email);
    } else if (result?.error) {
      console.error("[email] dispatch failed —", result.error, "to", seller.email);
    } else if (result?.sent) {
      console.log("[email] dispatch sent →", seller.email);
    }
    return result;
  } catch (error) {
    console.error("[email] dispatch unexpected error", error.message || error);
    return null;
  }
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

function notifyBuyerConfirmedReceipt({ sellerId, productTitle, orderId }) {
  return notifyUser({
    userId: sellerId,
    title: "Buyer Confirmed Receipt",
    message: "The buyer confirmed they received the item. You can proceed with the next order step.",
    highlight: productTitle,
    category: "orders",
    iconVariant: "primary",
    link: "/sellerProfile?section=orders",
    meta: orderId ? { orderId: String(orderId) } : undefined,
  });
}

function notifyBuyerMarkedReturn({ sellerId, productTitle, orderId }) {
  return notifyUser({
    userId: sellerId,
    title: "Buyer Marked Item Returned",
    message:
      "The buyer marked the rental item as returned. Confirm the return to release escrow, or report a return issue for admin review.",
    highlight: productTitle,
    category: "orders",
    iconVariant: "primary",
    link: "/sellerProfile?section=orders",
    meta: orderId ? { orderId: String(orderId) } : undefined,
  });
}

function notifySellerConfirmedReturn({ buyerId, productTitle, orderId }) {
  return notifyUser({
    userId: buyerId,
    title: "Seller Confirmed Your Return",
    message:
      "The seller confirmed your return. Escrow has been released (rental charge deducted, remaining refunded where applicable).",
    highlight: productTitle,
    category: "orders",
    iconVariant: "primary",
    link: "/profile?section=orders",
    meta: orderId ? { orderId: String(orderId) } : undefined,
  });
}

function notifyBuyerOrderShipped({ buyerId, productTitle, orderId, orderType = "sale" }) {
  return notifyUser({
    userId: buyerId,
    title: "Order Shipped",
    message:
      orderType === "rental"
        ? "Your rental item has been shipped. Confirm receipt when it arrives."
        : "Your purchase has been shipped. Confirm receipt when it arrives.",
    highlight: productTitle,
    category: "orders",
    iconVariant: "primary",
    link: "/profile?section=orders",
    meta: orderId ? { orderId: String(orderId) } : undefined,
  });
}

function hasOrderReturnContact(order) {
  const contact = order?.sellerReturnContact || {};
  return Boolean(
    String(contact.name ?? "").trim() &&
      String(contact.phone ?? "").trim() &&
      String(contact.city ?? "").trim() &&
      String(contact.address ?? "").trim(),
  );
}

async function notifyBuyerReturnInstructions({ buyerId, order, productTitle }) {
  if (order?.type !== "rental" || !hasOrderReturnContact(order)) {
    return null;
  }

  const buyer = await User.findById(buyerId).select("email notificationPrefs");
  if (!buyer?.email) return null;

  try {
    await sendBuyerReturnInstructionsEmail({
      to: buyer.email,
      order,
      product: { title: productTitle },
    });
  } catch (error) {
    console.error("[notificationService] return instructions email failed", error);
  }

  const contact = order.sellerReturnContact;
  return notifyUser({
    userId: buyerId,
    title: "Return Instructions Available",
    message: `Ship the rental back to ${contact.name} at ${contact.address}, ${contact.city}. Phone: ${contact.phone}. Full details are in My Orders and your email.`,
    highlight: productTitle,
    category: "orders",
    iconVariant: "primary",
    link: "/profile?section=orders",
    meta: order._id ? { orderId: String(order._id) } : undefined,
  });
}

function notifyEscrowReleased({
  buyerId,
  sellerId,
  productTitle,
  orderId,
  refundLabel,
  rentalChargeLabel,
  sellerPayoutLabel,
  transferSent = false,
}) {
  const refundText =
    refundLabel && refundLabel !== "PKR 0"
      ? `${refundLabel} has been refunded to your payment method.`
      : "Your escrow deposit has been settled after rental charges.";

  return Promise.all([
    notifyUser({
      userId: buyerId,
      title: "Escrow Deposit Released",
      message: `${refundText} Rental charges: ${rentalChargeLabel || "PKR 0"}.`,
      highlight: productTitle,
      category: "payments",
      iconVariant: "tertiary",
      link: "/profile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
    notifyUser({
      userId: sellerId,
      title: "Escrow Settled",
      message: sellerPayoutLabel
        ? transferSent
          ? `${sellerPayoutLabel} sent to your Stripe account after rental settlement.`
          : `${sellerPayoutLabel} recorded for your payout. Link Stripe Connect to receive bank transfers.`
        : `Rental escrow settled. Rental charges: ${rentalChargeLabel || "PKR 0"}.`,
      highlight: productTitle,
      category: "payments",
      iconVariant: "primary",
      link: "/sellerProfile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
  ]);
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

function notifyBidPlaced({ buyerId, productTitle, productId, amountFormatted }) {
  return notifyUser({
    userId: buyerId,
    title: "Bid Placed Successfully",
    message: amountFormatted
      ? `Your bid of ${amountFormatted} was placed. We'll notify you if you're outbid or when the auction ends.`
      : "Your bid was placed successfully. We'll notify you if you're outbid or when the auction ends.",
    highlight: productTitle,
    category: "bids",
    iconVariant: "primary",
    link: productId ? `/dress/${productId}` : "/profile?section=bids",
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
      ? `Congratulations! You won with a final bid of ${amountFormatted}. Open checkout to complete your purchase.`
      : "Congratulations! You won this auction. Open checkout to complete your purchase.",
    highlight: productTitle,
    category: "bids",
    iconVariant: "primary",
    link: productId ? `/dress/${productId}/checkout` : "/profile?section=bids",
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

function notifyPaymentReceived({ buyerId, productTitle, orderId, amountLabel }) {
  return notifyUser({
    userId: buyerId,
    title: "Payment Successful",
    message: amountLabel
      ? `Payment received: ${amountLabel}. We are preparing your order.`
      : "Your Stripe payment was received. We are preparing your order.",
    highlight: productTitle,
    category: "payments",
    iconVariant: "primary",
    link: "/profile?section=orders",
  });
}

function notifySaleOrderPaid({ sellerId, productTitle, orderId }) {
  return notifyUser({
    userId: sellerId,
    title: "Sale Paid",
    message:
      "A buyer completed Stripe checkout for your listing. Buyer shipping details were emailed to you — prepare the item for dispatch.",
    highlight: productTitle,
    category: "payments",
    iconVariant: "secondary",
    link: "/sellerProfile?section=orders",
  });
}

function notifyPaymentFailed({ buyerId, productTitle, orderId, reason }) {
  return notifyUser({
    userId: buyerId,
    title: "Payment Failed",
    message: reason
      ? `Your Stripe payment did not go through: ${reason}. Please try again with a different card.`
      : "Your Stripe payment did not go through. Please try again with a different card.",
    highlight: productTitle,
    category: "payments",
    iconVariant: "tertiary",
    link: "/profile?section=orders",
  });
}

function notifyOrderRefunded({ buyerId, productTitle, orderId, amountLabel }) {
  return notifyUser({
    userId: buyerId,
    title: "Payment Refunded",
    message: amountLabel
      ? `Your payment of ${amountLabel} was refunded.`
      : "Your payment for this order was refunded.",
    highlight: productTitle,
    category: "payments",
    iconVariant: "primary",
    link: "/profile?section=orders",
  });
}

function notifySellerOrderRefunded({ sellerId, productTitle, orderId }) {
  return notifyUser({
    userId: sellerId,
    title: "Order Refunded",
    message:
      "This order's payment was refunded to the buyer. The order has been cancelled and no payout will be made.",
    highlight: productTitle,
    category: "payments",
    iconVariant: "muted",
    link: "/sellerProfile?section=orders",
  });
}

function notifyReportResolved({ reporterId, reporterRole, reportId, subject, decision }) {
  const link =
    reporterRole === "seller"
      ? "/sellerProfile?section=support"
      : "/profile?section=support";

  return notifyUser({
    userId: reporterId,
    title: "Support Request Resolved",
    message:
      decision ||
      "Your support request has been reviewed and marked as resolved by our team.",
    highlight: subject ? `#${reportId} — ${subject}` : `#${reportId}`,
    category: "system",
    iconVariant: "primary",
    link,
  });
}

function notifyDisputeMediationRequested({ userId, role, reportId, subject, message }) {
  const link =
    role === "seller" ? "/sellerProfile?section=support" : "/profile?section=support";

  return notifyUser({
    userId,
    title: "Admin Needs Your Response",
    message:
      message ||
      "An admin has asked you to respond to a dispute in Support Center. Open your request and submit your side.",
    highlight: subject ? `#${reportId} — ${subject}` : `#${reportId}`,
    category: "system",
    iconVariant: "tertiary",
    link,
  });
}

function notifyDisputePartyResponded({ reportId, subject, responderRole, orderId }) {
  const roleLabel = responderRole === "seller" ? "Seller" : "Buyer";
  return notifyAdmins({
    title: "Dispute Response Received",
    message: `${roleLabel} responded to dispute #${reportId}. Review both responses in Support Center before releasing escrow.`,
    highlight: subject || `#${reportId}`,
    category: "system",
    iconVariant: "primary",
    link: "/admin/support",
  });
}

function notifySettlementProposed({
  buyerId,
  productTitle,
  orderId,
  refundLabel,
  rentalChargeLabel,
  damageLabel,
}) {
  return notifyUser({
    userId: buyerId,
    title: "Review Rental Settlement",
    message: `The seller proposed a settlement: rent ${rentalChargeLabel || "PKR 0"}, damage ${damageLabel || "PKR 0"}, refund ${refundLabel || "PKR 0"}. Accept or dispute in My Orders.`,
    highlight: productTitle,
    category: "payments",
    iconVariant: "tertiary",
    link: "/profile?section=orders",
    meta: orderId ? { orderId: String(orderId) } : undefined,
  });
}

function notifySettlementAccepted({ buyerId, sellerId, productTitle, orderId }) {
  return Promise.all([
    notifyUser({
      userId: buyerId,
      title: "Settlement Accepted",
      message: "You accepted the rental settlement. Escrow is being released.",
      highlight: productTitle,
      category: "payments",
      iconVariant: "tertiary",
      link: "/profile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
    notifyUser({
      userId: sellerId,
      title: "Settlement Accepted",
      message: "The buyer accepted your settlement proposal. Escrow is being released.",
      highlight: productTitle,
      category: "payments",
      iconVariant: "primary",
      link: "/sellerProfile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
  ]);
}

function notifySettlementDisputed({ buyerId, sellerId, productTitle, orderId }) {
  return Promise.all([
    notifyUser({
      userId: buyerId,
      title: "Rental Return Disputed",
      message:
        "A return dispute was opened. An admin will contact both parties and decide the escrow split.",
      highlight: productTitle,
      category: "payments",
      iconVariant: "tertiary",
      link: "/profile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
    notifyUser({
      userId: sellerId,
      title: "Rental Return Disputed",
      message: "Escrow is frozen until admin mediates and resolves this return dispute.",
      highlight: productTitle,
      category: "payments",
      iconVariant: "primary",
      link: "/sellerProfile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
  ]);
}

function notifySaleDeliveryDisputed({ buyerId, sellerId, productTitle, orderId }) {
  return Promise.all([
    notifyUser({
      userId: buyerId,
      title: "Delivery Dispute Submitted",
      message: "Your report was sent to admin. Payment stays in escrow until the issue is resolved.",
      highlight: productTitle,
      category: "payments",
      iconVariant: "tertiary",
      link: "/profile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
    notifyUser({
      userId: sellerId,
      title: "Buyer Reported Delivery Issue",
      message: "The buyer reported a delivery problem. Payment is held until admin reviews the case.",
      highlight: productTitle,
      category: "payments",
      iconVariant: "primary",
      link: "/sellerProfile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
  ]);
}

function notifySaleEscrowReleased({
  buyerId,
  sellerId,
  productTitle,
  orderId,
  refundLabel,
  sellerPayoutLabel,
  transferSent = false,
}) {
  const buyerMsg =
    refundLabel && refundLabel !== "PKR 0"
      ? `Escrow settled — ${refundLabel} refunded to you.`
      : "You confirmed receipt. Payment was released to the seller.";
  const sellerMsg = sellerPayoutLabel
    ? transferSent
      ? `Escrow released — ${sellerPayoutLabel} sent to your Stripe account.`
      : `Escrow released — ${sellerPayoutLabel} recorded. Link Stripe Connect in your profile to receive bank payouts.`
    : "Escrow was released for this sale.";

  return Promise.all([
    notifyUser({
      userId: buyerId,
      title: "Purchase Escrow Updated",
      message: buyerMsg,
      highlight: productTitle,
      category: "payments",
      iconVariant: "tertiary",
      link: "/profile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
    notifyUser({
      userId: sellerId,
      title: "Sale Payment Released",
      message: sellerMsg,
      highlight: productTitle,
      category: "payments",
      iconVariant: "primary",
      link: "/sellerProfile?section=orders",
      meta: orderId ? { orderId: String(orderId) } : undefined,
    }),
  ]);
}

module.exports = {
  createNotification,
  notifyUser,
  notifyRentalRequest,
  notifyRentalCancelled,
  notifyBookingConfirmed,
  notifyBookingRejected,
  notifyRentalCompleted,
  notifyBuyerConfirmedReceipt,
  notifyBuyerMarkedReturn,
  notifySellerConfirmedReturn,
  notifyBuyerOrderShipped,
  notifyBuyerReturnInstructions,
  notifyEscrowReleased,
  notifyListingApproved,
  notifyListingRejected,
  notifySellerApproved,
  notifySellerRejected,
  notifySellerMoreInfoRequested,
  notifyNewBid,
  notifyBidPlaced,
  notifyOutbid,
  notifyAuctionWon,
  notifyAuctionEnded,
  notifyNewMessage,
  notifyBroadcast,
  notifyPaymentReceived,
  notifySaleOrderPaid,
  notifyPaymentFailed,
  notifyOrderRefunded,
  notifySellerOrderRefunded,
  notifyRentalOrderPaid,
  notifySellerDispatchDetails,
  notifyReportResolved,
  notifyDisputeMediationRequested,
  notifyDisputePartyResponded,
  notifySettlementProposed,
  notifySettlementAccepted,
  notifySettlementDisputed,
  notifySaleDeliveryDisputed,
  notifySaleEscrowReleased,
};

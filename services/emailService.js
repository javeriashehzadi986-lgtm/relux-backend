const sgMail = require("@sendgrid/mail");

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL;
const fromName = process.env.SENDGRID_FROM_NAME || "Relux Hub";
const appUrl = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");

if (apiKey) {
  sgMail.setApiKey(apiKey);
}

function isConfigured() {
  return Boolean(apiKey && fromEmail);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildActionUrl(link) {
  if (!link) return appUrl;
  if (/^https?:\/\//i.test(link)) return link;
  return `${appUrl}${link.startsWith("/") ? link : `/${link}`}`;
}

function buildNotificationHtml({ title, message, highlight, link }) {
  const actionUrl = buildActionUrl(link);
  const highlightBlock = highlight
    ? `<p style="margin:16px 0;padding:12px 16px;background:#f5f0eb;border-radius:8px;color:#4a3728;font-weight:600;">${escapeHtml(highlight)}</p>`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <div style="padding:24px 0;border-bottom:1px solid #e8e0d8;">
        <strong style="font-size:18px;color:#8b6914;">Relux Hub</strong>
      </div>
      <div style="padding:24px 0;">
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
        ${highlightBlock}
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">${escapeHtml(message)}</p>
        <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 20px;background:#8b6914;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View in Relux Hub</a>
      </div>
      <p style="margin:0;padding-top:16px;border-top:1px solid #e8e0d8;font-size:12px;color:#888;">
        You received this email because notifications are enabled on your Relux Hub account.
      </p>
    </div>
  `.trim();
}

function buildNotificationText({ title, message, highlight, link }) {
  const lines = [title];
  if (highlight) lines.push(highlight);
  lines.push(message, "", `Open Relux Hub: ${buildActionUrl(link)}`);
  return lines.join("\n");
}

function formatDispatchField(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function buildDispatchDetails(order, product, buyer) {
  const shipping = order.shipping || {};
  const isRental = order.type === "rental";

  return {
    orderPublicId: order.orderId || String(order._id),
    orderType: isRental ? "Rental" : "Purchase",
    productTitle: product?.title || "Relux Hub item",
    buyerName: formatDispatchField(shipping.fullName || order.buyerName || buyer?.name),
    buyerEmail: formatDispatchField(shipping.email || buyer?.email),
    buyerPhone: formatDispatchField(shipping.phone || buyer?.phone),
    address: formatDispatchField(shipping.address),
    city: formatDispatchField(shipping.city),
    specialInstructions: formatDispatchField(shipping.specialInstructions, "None"),
    size: formatDispatchField(order.size),
    rentStart: isRental ? formatDispatchField(order.rentStart) : "",
    rentEnd: isRental ? formatDispatchField(order.rentEnd) : "",
    rentalDays: isRental ? String(order.rentalDays || "—") : "",
    amountPkr: order.amountPkr
      ? `PKR ${Math.round(order.amountPkr).toLocaleString("en-PK")}`
      : "—",
  };
}

function buildDispatchDetailsHtml(details) {
  const rentalRows = details.rentStart
    ? `
      <tr><td style="padding:8px 0;color:#666;">Rental period</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.rentStart)} – ${escapeHtml(details.rentEnd)} (${escapeHtml(details.rentalDays)} days)</td></tr>
    `
    : "";

  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <div style="padding:24px 0;border-bottom:1px solid #e8e0d8;">
        <strong style="font-size:18px;color:#8b6914;">Relux Hub</strong>
      </div>
      <div style="padding:24px 0;">
        <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;">New ${escapeHtml(details.orderType)} — dispatch details</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#444;">
          A buyer completed payment for <strong>${escapeHtml(details.productTitle)}</strong>.
          Use the details below to prepare and ship the order.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">
          <tr><td style="padding:8px 0;color:#666;">Order ID</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.orderPublicId)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Item</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.productTitle)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Size</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.size)}</td></tr>
          ${rentalRows}
          <tr><td style="padding:8px 0;color:#666;">Amount paid</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.amountPkr)}</td></tr>
        </table>
        <h2 style="margin:24px 0 12px;font-size:16px;">Buyer &amp; shipping</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">
          <tr><td style="padding:8px 0;color:#666;">Name</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.buyerName)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Email</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.buyerEmail)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Phone</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.buyerPhone)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Address</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.address)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">City</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.city)}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Instructions</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.specialInstructions)}</td></tr>
        </table>
        <a href="${escapeHtml(buildActionUrl("/sellerProfile?section=orders"))}" style="display:inline-block;margin-top:24px;padding:12px 20px;background:#8b6914;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Open seller orders</a>
      </div>
      <p style="margin:0;padding-top:16px;border-top:1px solid #e8e0d8;font-size:12px;color:#888;">
        This email contains buyer shipping details for order fulfillment on Relux Hub.
      </p>
    </div>
  `.trim();
}

function buildDispatchDetailsText(details) {
  const lines = [
    `New ${details.orderType} — dispatch details`,
    "",
    `Order: ${details.orderPublicId}`,
    `Item: ${details.productTitle}`,
    `Size: ${details.size}`,
  ];

  if (details.rentStart) {
    lines.push(
      `Rental: ${details.rentStart} – ${details.rentEnd} (${details.rentalDays} days)`,
    );
  }

  lines.push(
    `Amount paid: ${details.amountPkr}`,
    "",
    "Buyer & shipping",
    `Name: ${details.buyerName}`,
    `Email: ${details.buyerEmail}`,
    `Phone: ${details.buyerPhone}`,
    `Address: ${details.address}`,
    `City: ${details.city}`,
    `Instructions: ${details.specialInstructions}`,
    "",
    `Open seller orders: ${buildActionUrl("/sellerProfile?section=orders")}`,
  );

  return lines.join("\n");
}

async function sendSellerDispatchDetailsEmail({ to, order, product, buyer }) {
  const details = buildDispatchDetails(order, product, buyer);
  const subject = `Dispatch details — ${details.productTitle} | Relux Hub`;

  return sendEmail({
    to,
    subject,
    html: buildDispatchDetailsHtml(details),
    text: buildDispatchDetailsText(details),
  });
}

async function sendEmail({ to, subject, html, text }) {
  if (!isConfigured()) {
    return { sent: false, skipped: true, reason: "sendgrid_not_configured" };
  }

  if (!to) {
    return { sent: false, skipped: true, reason: "missing_recipient" };
  }

  try {
    await sgMail.send({
      to,
      from: { email: fromEmail, name: fromName },
      subject,
      html,
      text,
    });
    return { sent: true };
  } catch (error) {
    const detail = error?.response?.body?.errors?.[0]?.message || error.message;
    console.error("[emailService] Send failed:", detail);
    return { sent: false, error: detail };
  }
}

async function sendNotificationEmail({ to, title, message, highlight, link }) {
  const subject = `${title} | Relux Hub`;
  return sendEmail({
    to,
    subject,
    html: buildNotificationHtml({ title, message, highlight, link }),
    text: buildNotificationText({ title, message, highlight, link }),
  });
}

module.exports = {
  isConfigured,
  sendEmail,
  sendNotificationEmail,
  sendSellerDispatchDetailsEmail,
  buildDispatchDetails,
  buildActionUrl,
};

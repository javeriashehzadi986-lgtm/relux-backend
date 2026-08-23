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
  buildActionUrl,
};

const ContactMessage = require("../models/ContactMessage");
const { sendNotificationEmail, sendEmail } = require("../services/emailService");

function getErrorMessage(error) {
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

/** Public: submit Contact Us form */
async function createContactMessage(req, res) {
  try {
    const { name, email, message } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }
    if (!email?.trim()) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!message?.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    if (!emailOk) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }

    const doc = await ContactMessage.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: message.trim(),
      status: "new",
    });

    sendNotificationEmail({
      to: doc.email,
      title: "We Received Your Message",
      message:
        "Thanks for contacting Relux Hub. Our team has received your message and will get back to you soon.",
      highlight: doc.name,
      link: "/contactUs",
    }).catch(() => {});

    res.status(201).json({
      message: "Your message has been sent. We will get back to you soon.",
      contact: doc.toAdminJSON(),
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: list contact messages */
async function listContactMessages(req, res) {
  try {
    const { status } = req.query;
    const filter = {};
    if (status && status !== "all") {
      filter.status = status;
    }

    const messages = await ContactMessage.find(filter).sort({ createdAt: -1 }).limit(300);
    const [total, unread] = await Promise.all([
      ContactMessage.countDocuments(),
      ContactMessage.countDocuments({ status: "new" }),
    ]);

    res.json({
      messages: messages.map((item) => item.toAdminJSON()),
      stats: { total, unread },
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: update status / note */
async function updateContactMessage(req, res) {
  try {
    const { status, adminNote } = req.body;
    const doc = await ContactMessage.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (status) {
      if (!["new", "read", "resolved"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      doc.status = status;
    }
    if (typeof adminNote === "string") {
      doc.adminNote = adminNote.trim();
    }

    doc.reviewedAt = new Date();
    doc.reviewedBy = req.user._id;
    await doc.save();

    res.json({ message: "Updated", contact: doc.toAdminJSON() });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Admin: save reply + send via SendGrid */
async function replyContactMessage(req, res) {
  try {
    const reply = typeof req.body.reply === "string" ? req.body.reply.trim() : "";
    if (!reply) {
      return res.status(400).json({ message: "Reply text is required" });
    }
    if (reply.length > 5000) {
      return res.status(400).json({ message: "Reply is too long" });
    }

    const doc = await ContactMessage.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: "Message not found" });
    }

    doc.adminReply = reply;
    doc.repliedAt = new Date();
    doc.status = "resolved";
    doc.reviewedAt = new Date();
    doc.reviewedBy = req.user._id;
    await doc.save();

    const subject = "Re: Your message to Relux Hub";
    const text = [
      `Hi ${doc.name},`,
      "",
      reply,
      "",
      "— Relux Hub Support",
      "",
      "----------",
      "Your original message:",
      doc.message,
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
        <p>Hi ${escapeHtml(doc.name)},</p>
        <p style="white-space:pre-wrap;line-height:1.6;">${escapeHtml(reply)}</p>
        <p style="color:#666;">— Relux Hub Support</p>
        <hr style="border:none;border-top:1px solid #e8e0d8;margin:24px 0;" />
        <p style="font-size:12px;color:#888;">Your original message:</p>
        <p style="font-size:13px;color:#555;white-space:pre-wrap;">${escapeHtml(doc.message)}</p>
      </div>
    `.trim();

    const emailResult = await sendEmail({
      to: doc.email,
      subject,
      text,
      html,
    });

    if (!emailResult.sent) {
      console.error(
        "[replyContactMessage] Email failed:",
        emailResult.error || emailResult.reason || "unknown",
      );
      return res.status(502).json({
        message:
          "Reply saved, but the email could not be sent. Check SendGrid and try again.",
        contact: doc.toAdminJSON(),
        emailSent: false,
      });
    }

    res.json({
      message: "Reply emailed to the user successfully.",
      contact: doc.toAdminJSON(),
      emailSent: true,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  createContactMessage,
  listContactMessages,
  updateContactMessage,
  replyContactMessage,
};

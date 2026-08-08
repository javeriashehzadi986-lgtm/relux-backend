const ContactMessage = require("../models/ContactMessage");

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

/** Admin: save reply + open email client payload */
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
    const body = [
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

    const mailto = `mailto:${encodeURIComponent(doc.email)}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;

    res.json({
      message: "Reply saved. Open your email app to send it.",
      contact: doc.toAdminJSON(),
      mailto,
    });
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  createContactMessage,
  listContactMessages,
  updateContactMessage,
  replyContactMessage,
};

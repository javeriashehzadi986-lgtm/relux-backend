const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema(
  {
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["rental", "sale"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    size: { type: String, trim: true, default: "" },
    rentStart: { type: String, trim: true, default: "" },
    rentEnd: { type: String, trim: true, default: "" },
    rentalDays: { type: Number, default: 0 },
    buyerName: { type: String, trim: true, default: "Buyer" },
    removedByBuyer: { type: Boolean, default: false },
  },
  { timestamps: true },
);

function formatRentalPeriod(start, end) {
  if (!start || !end) return null;
  const format = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    });
  return `Rental Period: ${format(start)} - ${format(end)}`;
}

function formatDateLabel(start, end) {
  if (!start || !end) return "Dates TBD";
  const format = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
  return `${format(start)} - ${format(end)}`;
}

orderSchema.methods.toBuyerJSON = function toBuyerJSON() {
  const id = this._id.toString();
  const dressId =
    this.productId?._id?.toString?.() ?? this.productId?.toString?.() ?? this.productId;

  if (this.status === "cancelled" || this.status === "rejected") {
    return {
      id,
      dressId,
      buyerId: this.buyerId?.toString?.() ?? this.buyerId,
      sellerId: this.sellerId?.toString?.() ?? this.sellerId,
      type: this.type === "sale" ? "purchase" : "rental",
      typeLabel: this.type === "sale" ? "Purchase" : "Rental",
      size: this.size,
      rentalDays: this.rentalDays,
      rentStart: this.rentStart,
      rentEnd: this.rentEnd,
      status: "cancelled",
      statusLabel: "Cancelled",
      meta:
        this.type === "rental" && this.rentStart
          ? [{ icon: "clock", text: formatRentalPeriod(this.rentStart, this.rentEnd) }]
          : [],
      actions: [
        { id: "details", label: "View Details", variant: "outline", link: true },
        { id: "remove", label: "Remove from Order List", variant: "danger" },
      ],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  if (this.status === "pending") {
    return {
      id,
      dressId,
      buyerId: this.buyerId?.toString?.() ?? this.buyerId,
      sellerId: this.sellerId?.toString?.() ?? this.sellerId,
      type: this.type === "sale" ? "purchase" : "rental",
      typeLabel: this.type === "sale" ? "Purchase" : "Rental",
      size: this.size,
      rentalDays: this.rentalDays,
      rentStart: this.rentStart,
      rentEnd: this.rentEnd,
      status: "processing",
      statusLabel: "Processing",
      meta: [
        { icon: "calendar-check", text: `${this.rentalDays || 1} Days Rental` },
        {
          icon: "clock",
          text: formatRentalPeriod(this.rentStart, this.rentEnd) || "Awaiting seller approval",
        },
      ],
      actions: [
        { id: "details", label: "View Details", variant: "outline", link: true },
        { id: "cancel", label: "Cancel Request", variant: "danger" },
      ],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  if (this.status === "approved") {
    return {
      id,
      dressId,
      buyerId: this.buyerId?.toString?.() ?? this.buyerId,
      sellerId: this.sellerId?.toString?.() ?? this.sellerId,
      type: this.type === "sale" ? "purchase" : "rental",
      typeLabel: this.type === "sale" ? "Purchase" : "Rental",
      size: this.size,
      rentalDays: this.rentalDays,
      rentStart: this.rentStart,
      rentEnd: this.rentEnd,
      status: "rental-active",
      statusLabel: "Rental Active",
      meta: [
        { icon: "calendar-check", text: `${this.rentalDays || 1} Days Rental` },
        { icon: "check-circle", text: "Seller Approved", highlight: true },
      ],
      actions: [
        { id: "details", label: "View Details", variant: "outline", link: true },
        {
          id: "rent-again",
          label: "Rent Again",
          variant: "ghost",
          icon: "history",
          alignEnd: true,
          link: true,
        },
      ],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  // completed
  return {
    id,
    dressId,
    buyerId: this.buyerId?.toString?.() ?? this.buyerId,
    sellerId: this.sellerId?.toString?.() ?? this.sellerId,
    type: this.type === "sale" ? "purchase" : "rental",
    typeLabel: this.type === "sale" ? "Purchase" : "Rental",
    size: this.size,
    rentalDays: this.rentalDays,
    rentStart: this.rentStart,
    rentEnd: this.rentEnd,
    status: "delivered",
    statusLabel: "Delivered",
    meta: [{ icon: "check-circle", text: "Rental Completed", highlight: true }],
    actions: [
      { id: "details", label: "View Details", variant: "outline", link: true },
      {
        id: "rent-again",
        label: "Rent Again",
        variant: "ghost",
        icon: "history",
        alignEnd: true,
        link: true,
      },
    ],
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

orderSchema.methods.toSellerJSON = function toSellerJSON() {
  const id = this._id.toString();
  const dressId =
    this.productId?._id?.toString?.() ?? this.productId?.toString?.() ?? this.productId;
  const buyer = this.buyerId;
  const customerName =
    (buyer && typeof buyer === "object" && buyer.name) || this.buyerName || "Buyer";

  const base = {
    id,
    dressId,
    buyerId: buyer?._id?.toString?.() ?? buyer?.toString?.() ?? this.buyerId,
    sellerId: this.sellerId?._id?.toString?.() ?? this.sellerId?.toString?.() ?? this.sellerId,
    customerName,
    customerAvatar: null,
    orderCategory: this.type === "sale" ? "sale" : "rental",
    orderType: this.type === "sale" ? "Sale Order" : "Rental Request",
    size: this.size,
    rentalDays: this.rentalDays,
    rentStart: this.rentStart,
    rentEnd: this.rentEnd,
    dateLabel: formatDateLabel(this.rentStart, this.rentEnd),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };

  if (this.status === "pending") {
    return {
      ...base,
      status: "Pending",
      statusVariant: "pending",
      dateIcon: "calendar",
      actions: "approve-reject",
      dimmed: false,
    };
  }

  if (this.status === "approved") {
    return {
      ...base,
      status: "Approved",
      statusVariant: "approved",
      dateIcon: "calendar-check",
      actions: "complete",
      dimmed: false,
    };
  }

  if (this.status === "completed") {
    return {
      ...base,
      status: "Completed",
      statusVariant: "completed",
      dateIcon: "check",
      actions: "view",
      dimmed: true,
    };
  }

  return {
    ...base,
    status: this.status === "rejected" ? "Rejected" : "Cancelled",
    statusVariant: "completed",
    dateIcon: "calendar",
    actions: "view",
    dimmed: true,
  };
};

module.exports = mongoose.model("Order", orderSchema);

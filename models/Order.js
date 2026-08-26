const mongoose = require("mongoose");

function generateOrderId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RH-${stamp}${suffix}`;
}

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
      trim: true,
      index: true,
    },
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

    // Payment (Stripe checkout for resale / auction wins)
    paymentStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid", "failed", "refunded"],
      default: "unpaid",
      index: true,
    },
    paymentProvider: { type: String, trim: true, default: "" },
    amountPkr: { type: Number, default: 0 },
    itemAmountPkr: { type: Number, default: 0 },
    deliveryChargesPkr: { type: Number, default: 0 },
    currency: { type: String, trim: true, default: "" },
    stripeAmount: { type: Number, default: 0 },
    stripeSessionId: { type: String, trim: true, default: "", index: true },
    stripePaymentIntentId: { type: String, trim: true, default: "" },
    paidAt: { type: Date, default: null },
    shipping: {
      fullName: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      specialInstructions: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true },
);

orderSchema.pre("validate", function assignOrderId() {
  if (!this.orderId) {
    this.orderId = generateOrderId();
  }
});

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

  const payment = {
    paymentStatus: this.paymentStatus || "unpaid",
    amountPkr: this.amountPkr || 0,
    paidAt: this.paidAt,
  };

  if (this.status === "cancelled" || this.status === "rejected") {
    return {
      id,
      orderId: this.orderId,
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
      ...payment,
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
    const awaitingPay =
      this.type === "sale" && this.paymentStatus !== "paid";
    return {
      id,
      orderId: this.orderId,
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
      statusLabel: awaitingPay ? "Awaiting Payment" : "Processing",
      ...payment,
      meta:
        this.type === "sale"
          ? [
              {
                icon: "clock",
                text: awaitingPay
                  ? "Complete Stripe checkout to confirm"
                  : "Payment received — preparing shipment",
              },
            ]
          : [
              { icon: "calendar-check", text: `${this.rentalDays || 1} Days Rental` },
              {
                icon: "clock",
                text:
                  formatRentalPeriod(this.rentStart, this.rentEnd) ||
                  "Awaiting seller approval",
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
    const isSale = this.type === "sale";
    return {
      id,
      orderId: this.orderId,
      dressId,
      buyerId: this.buyerId?.toString?.() ?? this.buyerId,
      sellerId: this.sellerId?.toString?.() ?? this.sellerId,
      type: isSale ? "purchase" : "rental",
      typeLabel: isSale ? "Purchase" : "Rental",
      size: this.size,
      rentalDays: this.rentalDays,
      rentStart: this.rentStart,
      rentEnd: this.rentEnd,
      status: isSale ? "paid" : "rental-active",
      statusLabel: isSale ? "Paid — Shipping" : "Rental Active",
      ...payment,
      meta: isSale
        ? [
            {
              icon: "check-circle",
              text:
                this.paymentStatus === "paid"
                  ? "Payment confirmed via Stripe"
                  : "Order approved",
              highlight: true,
            },
          ]
        : [
            { icon: "calendar-check", text: `${this.rentalDays || 1} Days Rental` },
            { icon: "check-circle", text: "Seller Approved", highlight: true },
          ],
      actions: [
        { id: "details", label: "View Details", variant: "outline", link: true },
        ...(isSale
          ? []
          : [
              {
                id: "rent-again",
                label: "Rent Again",
                variant: "ghost",
                icon: "history",
                alignEnd: true,
                link: true,
              },
            ]),
      ],
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  // completed
  return {
    id,
    orderId: this.orderId,
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
    ...payment,
    meta: [
      {
        icon: "check-circle",
        text: this.type === "sale" ? "Purchase Completed" : "Rental Completed",
        highlight: true,
      },
    ],
    actions: [
      { id: "details", label: "View Details", variant: "outline", link: true },
      {
        id: "rent-again",
        label: this.type === "sale" ? "Shop Again" : "Rent Again",
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
    orderId: this.orderId,
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

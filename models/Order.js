const mongoose = require("mongoose");
const { getFulfillmentLabel, FULFILLMENT, getFulfillmentVariant, getReturnAvailableLabel, buildOrderLogistics, getPaymentLabel } = require("../services/orderStatusService");
const { getEscrowLabel } = require("../services/escrowService");
const { getProductAvailability } = require("../services/productAvailabilityService");

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
    escrowStatus: {
      type: String,
      enum: ["none", "held", "released", "failed"],
      default: "none",
    },
    rentalChargePkr: { type: Number, default: 0 },
    refundAmountPkr: { type: Number, default: 0 },
    damageDeductionPkr: { type: Number, default: 0 },
    lateFeePkr: { type: Number, default: 0 },
    sellerPayoutPkr: { type: Number, default: 0 },
    escrowSettlementStatus: {
      type: String,
      enum: ["none", "proposed", "accepted", "disputed", "admin_settled", "released"],
      default: "none",
    },
    settlementNote: { type: String, trim: true, default: "" },
    settlementEvidence: { type: [String], default: [] },
    settlementProposedAt: { type: Date, default: null },
    settlementAcceptedAt: { type: Date, default: null },
    settlementDisputedAt: { type: Date, default: null },
    disputeReason: { type: String, trim: true, default: "" },
    disputeReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Report",
      default: null,
    },
    adminSettlementNote: { type: String, trim: true, default: "" },
    adminSettledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    stripeRefundId: { type: String, trim: true, default: "" },
    stripeTransferId: { type: String, trim: true, default: "" },
    sellerPayoutStatus: {
      type: String,
      enum: ["none", "pending", "transferred", "ledger_only", "failed"],
      default: "none",
    },
    escrowHeldAt: { type: Date, default: null },
    escrowReleasedAt: { type: Date, default: null },
    returnConfirmedAt: { type: Date, default: null },
    sellerConfirmedReturnAt: { type: Date, default: null },
    shippedAt: { type: Date, default: null },
    deliveryConfirmedAt: { type: Date, default: null },
    saleEscrowAutoReleaseAt: { type: Date, default: null },
    saleEscrowReleaseReason: {
      type: String,
      enum: ["", "buyer_confirmed", "auto_release", "admin_settled"],
      default: "",
    },
    refundedAt: { type: Date, default: null },
    fulfillmentStatus: {
      type: String,
      enum: ["processing", "shipped", "delivered", "returned"],
      default: "processing",
    },
    shipping: {
      fullName: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      specialInstructions: { type: String, trim: true, default: "" },
    },
    sellerReturnContact: {
      name: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
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

function formatDateLabel(start, end, rentalDays = 0) {
  if (!start || !end) return "Dates TBD";
  const format = (iso) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
    });
  const days = Math.max(1, Number(rentalDays) || 0);
  const daysText = days === 1 ? "1 day" : `${days} days`;
  return `${daysText} · ${format(start)} – ${format(end)}`;
}

function embeddedProductFields(doc) {
  const product = doc.productId;
  const seller = doc.sellerId;
  const fields = {};

  if (product && typeof product === "object" && product._id) {
    fields.productTitle = product.title || "";
    fields.productImage = product.mainImage || product.gallery?.[0] || "";
    fields.productBrand = product.brand || "";
    fields.productStatus = product.status || "";
    fields.productAvailabilityLabel = getProductAvailability(product).label;
  }
  if (seller && typeof seller === "object" && seller.name) {
    fields.sellerName = seller.name;
  }

  return fields;
}

function isCompleteReturnContact(contact) {
  if (!contact) return false;
  return Boolean(
    String(contact.name ?? "").trim() &&
      String(contact.phone ?? "").trim() &&
      String(contact.city ?? "").trim() &&
      String(contact.address ?? "").trim(),
  );
}

function buildBuyerReturnContact(order) {
  const contact = order.sellerReturnContact || {};
  if (!isCompleteReturnContact(contact)) return null;
  return {
    name: contact.name.trim(),
    phone: contact.phone.trim(),
    email: String(contact.email ?? "").trim(),
    city: contact.city.trim(),
    address: contact.address.trim(),
  };
}

function shouldExposeSellerReturnContact(order) {
  const fs = order.fulfillmentStatus || FULFILLMENT.PROCESSING;
  return (
    order.type === "rental" &&
    order.paymentStatus === "paid" &&
    (fs === FULFILLMENT.DELIVERED || fs === FULFILLMENT.RETURNED)
  );
}

function sellerReturnContactFields(order) {
  const contact = buildBuyerReturnContact(order);
  return {
    sellerReturnContact: shouldExposeSellerReturnContact(order) ? contact : null,
    returnContactReady: Boolean(contact),
  };
}

function formatShippedBuyerMeta(order, fulfillmentLabel) {
  if (!order.shippedAt) {
    return `${fulfillmentLabel} — confirm when you receive it`;
  }
  const shippedDate = new Date(order.shippedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Shipped on ${shippedDate} — confirm when you receive it`;
}

function buildRentalBuyerMeta(order, fs, rentalNeedsPay, fulfillmentLabel) {
  if (rentalNeedsPay) {
    return [
      { icon: "calendar-check", text: `${order.rentalDays || 1} Days Rental` },
      { icon: "clock", text: "Seller approved — pay security deposit" },
    ];
  }

  if (fs === FULFILLMENT.SHIPPED) {
    return [
      { icon: "calendar-check", text: `${order.rentalDays || 1} Days Rental` },
      {
        icon: "clock",
        text: formatShippedBuyerMeta(order, fulfillmentLabel),
        highlight: true,
      },
    ];
  }

  if (fs === FULFILLMENT.DELIVERED) {
    return [
      { icon: "calendar-check", text: `${order.rentalDays || 1} Days Rental` },
      {
        icon: "check-circle",
        text: formatRentalPeriod(order.rentStart, order.rentEnd)
          ? `${formatRentalPeriod(order.rentStart, order.rentEnd)} — mark as returned when you ship it back`
          : "Mark as returned when you ship the item back",
        highlight: true,
      },
    ];
  }

  return [
    { icon: "calendar-check", text: `${order.rentalDays || 1} Days Rental` },
    {
      icon: "check-circle",
      text: formatRentalPeriod(order.rentStart, order.rentEnd) || fulfillmentLabel,
      highlight: true,
    },
  ];
}

orderSchema.methods.toBuyerJSON = function toBuyerJSON() {
  const id = this._id.toString();
  const dressId =
    this.productId?._id?.toString?.() ?? this.productId?.toString?.() ?? this.productId;

  const payment = {
    paymentStatus: this.paymentStatus || "unpaid",
    paymentLabel: getPaymentLabel(this),
    amountPkr: this.amountPkr || 0,
    itemAmountPkr: this.itemAmountPkr || 0,
    deliveryChargesPkr: this.deliveryChargesPkr || 0,
    paidAt: this.paidAt,
    fulfillmentStatus: this.fulfillmentStatus || FULFILLMENT.PROCESSING,
    fulfillmentLabel: getFulfillmentLabel(this),
    escrowStatus: this.escrowStatus || "none",
    escrowLabel: getEscrowLabel(this),
    rentalChargePkr: this.rentalChargePkr || 0,
    refundAmountPkr: this.refundAmountPkr || 0,
    refundedAt: this.refundedAt || null,
    refundReference: this.stripeRefundId
      ? String(this.stripeRefundId).replace(/^re_/, "").slice(-10).toUpperCase()
      : "",
    damageDeductionPkr: this.damageDeductionPkr || 0,
    lateFeePkr: this.lateFeePkr || 0,
    sellerPayoutPkr: this.sellerPayoutPkr || 0,
    escrowSettlementStatus: this.escrowSettlementStatus || "none",
    settlementNote: this.settlementNote || "",
    settlementEvidence: this.settlementEvidence || [],
    disputeReason: this.disputeReason || "",
    disputeReportId: this.disputeReportId?.toString?.() || "",
    shippedAt: this.shippedAt || null,
    deliveryConfirmedAt: this.deliveryConfirmedAt || null,
    returnConfirmedAt: this.returnConfirmedAt || null,
    saleEscrowAutoReleaseAt: this.saleEscrowAutoReleaseAt || null,
    saleEscrowReleaseReason: this.saleEscrowReleaseReason || "",
    logistics: buildOrderLogistics(this),
  };

  if (this.status === "cancelled" || this.status === "rejected") {
    const wasDisputeRefund =
      this.status === "cancelled" &&
      this.escrowSettlementStatus === "admin_settled" &&
      (Number(this.refundAmountPkr) || 0) > 0 &&
      (Number(this.sellerPayoutPkr) || 0) <= 0;

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
      statusLabel: wasDisputeRefund
        ? "Cancelled — refunded"
        : this.status === "rejected"
          ? "Rejected"
          : "Cancelled",
      ...payment,
      meta:
        this.type === "rental" && this.rentStart
          ? [{ icon: "clock", text: formatRentalPeriod(this.rentStart, this.rentEnd) }]
          : [],
      actions: [
        { id: "details", label: "View Details", variant: "outline", link: true },
        { id: "remove", label: "Remove from Order List", variant: "danger" },
      ],
      ...embeddedProductFields(this),
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
      ...embeddedProductFields(this),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  if (this.status === "approved") {
    const isSale = this.type === "sale";
    const rentalNeedsPay = !isSale && this.paymentStatus !== "paid";
    const fs = this.fulfillmentStatus || FULFILLMENT.PROCESSING;
    const fulfillmentLabel = getFulfillmentLabel(this);

    let buyerStatus = "processing";
    if (isSale) {
      buyerStatus =
        fs === FULFILLMENT.DELIVERED
          ? "delivered"
          : fs === FULFILLMENT.SHIPPED
            ? "shipped"
            : "paid";
    } else if (rentalNeedsPay) {
      buyerStatus = "awaiting-payment";
    } else if (fs === FULFILLMENT.RETURNED) {
      buyerStatus = "returned";
    } else if (fs === FULFILLMENT.DELIVERED) {
      buyerStatus = "rental-active";
    } else if (fs === FULFILLMENT.SHIPPED) {
      buyerStatus = "shipped";
    } else {
      buyerStatus = "processing";
    }

    const actions = [
      { id: "details", label: "View Details", variant: "outline", link: true },
    ];

    if (rentalNeedsPay) {
      actions.push({
        id: "checkout",
        label: "Proceed to Checkout",
        variant: "primary",
        link: true,
      });
      actions.push({
        id: "cancel",
        label: "Cancel Request",
        variant: "danger",
      });
    } else if (this.paymentStatus === "paid" && fs === FULFILLMENT.SHIPPED) {
      // Always allow Confirm Received while shipped — even during a delivery dispute —
      // so the buyer can accept the item once it arrives (closes dispute, releases escrow).
      actions.push({
        id: "confirm-received",
        label: "Confirm Received",
        variant: "primary",
      });
      if (this.escrowSettlementStatus === "disputed") {
        actions.push({
          id: "dispute-pending",
          label: "Delivery Dispute Under Review",
          variant: "outline",
          disabled: true,
        });
      } else if (this.escrowStatus === "held") {
        actions.push({
          id: "dispute-delivery",
          label: "Report Delivery Issue",
          variant: "outline",
        });
      }
    } else if (
      !isSale &&
      this.paymentStatus === "paid" &&
      fs === FULFILLMENT.DELIVERED
    ) {
      actions.push({
        id: "mark-returned",
        label: "Mark as Returned",
        variant: "primary",
      });
    } else if (
      !isSale &&
      this.paymentStatus === "paid" &&
      fs === FULFILLMENT.RETURNED &&
      this.escrowStatus !== "released"
    ) {
      const settlementStatus = this.escrowSettlementStatus || "none";
      if (settlementStatus === "disputed") {
        actions.push({
          id: "dispute-pending",
          label: "Dispute Under Review",
          variant: "outline",
          disabled: true,
        });
      } else {
        actions.push({
          id: "awaiting-seller",
          label: "Awaiting Seller Confirmation",
          variant: "outline",
          disabled: true,
        });
      }
    }

    const rentalMeta = buildRentalBuyerMeta(
      this,
      fs,
      rentalNeedsPay,
      fulfillmentLabel,
    );

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
      ...payment,
      status: buyerStatus,
      statusLabel: fulfillmentLabel,
      meta: isSale
        ? [
            {
              icon: "check-circle",
              text:
                this.paymentStatus === "paid"
                  ? this.escrowStatus === "held" && fs === FULFILLMENT.SHIPPED
                    ? this.saleEscrowAutoReleaseAt
                      ? `Payment held — confirm receipt or auto-releases ${new Date(this.saleEscrowAutoReleaseAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                      : `Payment held — ${fulfillmentLabel}`
                    : this.escrowLabel || `Payment confirmed — ${fulfillmentLabel}`
                  : "Complete checkout to confirm",
              highlight: true,
            },
          ]
        : rentalNeedsPay
          ? [
              { icon: "calendar-check", text: `${this.rentalDays || 1} Days Rental` },
              { icon: "clock", text: "Seller approved — pay security deposit" },
            ]
          : rentalMeta,
      actions,
      canMarkReturned:
        !isSale &&
        this.paymentStatus === "paid" &&
        fs === FULFILLMENT.DELIVERED,
      returnAvailableLabel: getReturnAvailableLabel(this.rentEnd),
      ...embeddedProductFields(this),
      ...sellerReturnContactFields(this),
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
    ...embeddedProductFields(this),
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
    dateLabel: formatDateLabel(this.rentStart, this.rentEnd, this.rentalDays),
    paymentStatus: this.paymentStatus || "unpaid",
    paymentLabel: getPaymentLabel(this),
    fulfillmentStatus: this.fulfillmentStatus || FULFILLMENT.PROCESSING,
    fulfillmentLabel: getFulfillmentLabel(this),
    escrowStatus: this.escrowStatus || "none",
    escrowLabel: getEscrowLabel(this),
    rentalChargePkr: this.rentalChargePkr || 0,
    refundAmountPkr: this.refundAmountPkr || 0,
    damageDeductionPkr: this.damageDeductionPkr || 0,
    lateFeePkr: this.lateFeePkr || 0,
    sellerPayoutPkr: this.sellerPayoutPkr || 0,
    escrowSettlementStatus: this.escrowSettlementStatus || "none",
    settlementNote: this.settlementNote || "",
    settlementEvidence: this.settlementEvidence || [],
    disputeReason: this.disputeReason || "",
    disputeReportId: this.disputeReportId?.toString?.() || "",
    shippedAt: this.shippedAt || null,
    deliveryConfirmedAt: this.deliveryConfirmedAt || null,
    returnConfirmedAt: this.returnConfirmedAt || null,
    sellerConfirmedReturnAt: this.sellerConfirmedReturnAt || null,
    saleEscrowAutoReleaseAt: this.saleEscrowAutoReleaseAt || null,
    saleEscrowReleaseReason: this.saleEscrowReleaseReason || "",
    amountPkr: this.amountPkr || 0,
    logistics: buildOrderLogistics(this),
    ...embeddedProductFields(this),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };

  if (this.status === "pending") {
    return {
      ...base,
      status: "Pending",
      statusVariant: "pending",
      dateIcon: "calendar",
      actions: [
        { id: "reject", label: "Reject", variant: "outline" },
        { id: "approve", label: "Approve", variant: "primary" },
      ],
      dimmed: false,
    };
  }

  if (this.status === "approved") {
    const fs = this.fulfillmentStatus || FULFILLMENT.PROCESSING;
    const actions = [
      { id: "details", label: "View Details", variant: "outline", link: true },
    ];

    if (this.paymentStatus === "paid") {
      const escrowPendingRelease =
        this.type === "rental" &&
        this.escrowStatus !== "released" &&
        this.escrowStatus !== "failed";

      if (fs === FULFILLMENT.PROCESSING) {
        actions.push({ id: "ship", label: "Mark as Shipped", variant: "primary" });
      } else if (
        this.type === "rental" &&
        fs === FULFILLMENT.RETURNED &&
        escrowPendingRelease
      ) {
        const settlementStatus = this.escrowSettlementStatus || "none";

        if (settlementStatus === "disputed") {
          actions.push({
            id: "dispute-pending",
            label: "Return Dispute Under Review",
            variant: "outline",
            disabled: true,
          });
        } else {
          actions.push(
            {
              id: "confirm-return",
              label: "Confirm Returned",
              variant: "primary",
            },
            {
              id: "dispute-return",
              label: "Report Return Issue",
              variant: "outline",
            },
          );
        }
      } else if (
        (this.type === "sale" &&
          fs === FULFILLMENT.DELIVERED &&
          this.escrowStatus === "released") ||
        (this.type === "rental" && fs === FULFILLMENT.RETURNED && this.escrowStatus === "released")
      ) {
        actions.push({ id: "complete", label: "Mark as Completed", variant: "primary" });
      } else if (
        this.type === "sale" &&
        fs === FULFILLMENT.SHIPPED &&
        this.escrowStatus === "held"
      ) {
        actions.push({
          id: "details",
          label: "Awaiting Buyer Confirmation",
          variant: "outline",
          disabled: true,
        });
      } else if (
        this.type === "rental" &&
        fs === FULFILLMENT.SHIPPED
      ) {
        actions.push({
          id: "awaiting-buyer",
          label: "Awaiting Buyer Receipt",
          variant: "outline",
          disabled: true,
        });
      } else if (
        this.type === "rental" &&
        fs === FULFILLMENT.DELIVERED
      ) {
        actions.push({
          id: "awaiting-buyer",
          label: "Awaiting Buyer Return",
          variant: "outline",
          disabled: true,
        });
      }
    }

    return {
      ...base,
      status: getFulfillmentLabel(this),
      statusVariant: getFulfillmentVariant(this),
      dateIcon: "calendar-check",
      actions,
      dimmed: false,
    };
  }

  if (this.status === "completed") {
    return {
      ...base,
      status: getFulfillmentLabel(this),
      statusVariant: "completed",
      dateIcon: "check",
      actions: [{ id: "details", label: "View Details", variant: "outline", link: true }],
      dimmed: true,
    };
  }

  return {
    ...base,
    status:
      this.status === "rejected"
        ? "Rejected"
        : this.escrowSettlementStatus === "admin_settled" &&
            (Number(this.refundAmountPkr) || 0) > 0 &&
            (Number(this.sellerPayoutPkr) || 0) <= 0
          ? "Cancelled — buyer refunded"
          : "Cancelled",
    statusVariant: "completed",
    dateIcon: "calendar",
    actions: [{ id: "details", label: "View Details", variant: "outline", link: true }],
    dimmed: true,
  };
};

module.exports = mongoose.model("Order", orderSchema);

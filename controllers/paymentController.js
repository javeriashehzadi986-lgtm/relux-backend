const Bid = require("../models/Bid");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const {
  notifyPaymentReceived,
  notifySaleOrderPaid,
  notifyRentalOrderPaid,
  notifySellerDispatchDetails,
} = require("../services/notificationService");
const { syncProductForOrder } = require("../services/orderStatusService");
const {
  getStripe,
  getCurrency,
  toStripeUnitAmount,
  getFrontendUrl,
} = require("../services/stripeService");

const DEFAULT_DELIVERY_PKR = 1500;

function getErrorMessage(error) {
  if (error?.type === "StripeInvalidRequestError") {
    return error.message || "Stripe rejected this payment request";
  }
  if (error.message?.includes("STRIPE_SECRET_KEY")) {
    return error.message;
  }
  if (error.message?.includes("bad auth")) {
    return "Database connection failed. Restart the backend server and check MongoDB password in .env";
  }
  return error.message || "Something went wrong";
}

function parseAmount(value) {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  return Number(String(value ?? "").replace(/[^\d.]/g, "")) || 0;
}

function getAuctionEndDate(product) {
  if (product.auctionEndDate) {
    const parsed = new Date(product.auctionEndDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  const fallback = new Date(product.createdAt ?? Date.now());
  fallback.setDate(fallback.getDate() + 14);
  return fallback;
}

async function getHighestBid(productId) {
  return Bid.findOne({ productId }).sort({ amount: -1, createdAt: -1 });
}

function computeSaleTotals(product, highestBid) {
  const winningBid =
    highestBid?.amount ||
    parseAmount(product.startingBid) ||
    parseAmount(product.salePrice) ||
    0;
  const deliveryCharges = DEFAULT_DELIVERY_PKR;
  const totalPkr = winningBid + deliveryCharges;
  return { winningBid, deliveryCharges, totalPkr };
}

/** Buyer: create unpaid sale order + Stripe Checkout Session */
async function createSaleCheckout(req, res) {
  try {
    if (req.user.role !== "buyer") {
      return res.status(403).json({ message: "Only buyers can checkout" });
    }

    const {
      productId,
      fullName,
      phone,
      email,
      address,
      city,
      specialInstructions,
    } = req.body;

    if (!productId) {
      return res.status(400).json({ message: "Product is required" });
    }
    if (!fullName?.trim() || !phone?.trim() || !address?.trim() || !city?.trim()) {
      return res.status(400).json({ message: "Shipping details are required" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    if (product.listingType !== "sale") {
      return res.status(400).json({ message: "This listing is not a resale item" });
    }
    if (product.verificationStatus !== "approved") {
      return res.status(400).json({ message: "This listing is not available" });
    }
    if (!product.sellerId) {
      return res.status(400).json({ message: "This listing has no seller linked" });
    }
    if (String(product.sellerId) === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot buy your own listing" });
    }

    const auctionEnd = getAuctionEndDate(product);
    if (Date.now() < auctionEnd.getTime()) {
      return res.status(400).json({ message: "This auction has not ended yet" });
    }

    const highestBid = await getHighestBid(product._id);
    if (!highestBid || String(highestBid.userId) !== String(req.user._id)) {
      return res.status(403).json({
        message: "Only the auction winner can complete this purchase",
      });
    }

    const alreadyPaid = await Order.findOne({
      productId: product._id,
      type: "sale",
      paymentStatus: "paid",
      status: { $nin: ["cancelled", "rejected"] },
    });
    if (alreadyPaid) {
      return res.status(400).json({ message: "This item has already been purchased" });
    }

    const { winningBid, deliveryCharges, totalPkr } = computeSaleTotals(
      product,
      highestBid,
    );

    let order = await Order.findOne({
      buyerId: req.user._id,
      productId: product._id,
      type: "sale",
      paymentStatus: { $in: ["unpaid", "pending"] },
      status: { $in: ["pending", "cancelled"] },
      removedByBuyer: false,
    }).sort({ updatedAt: -1 });

    const shipping = {
      fullName: fullName.trim(),
      phone: phone.trim(),
      email: (email || req.user.email || "").trim(),
      address: address.trim(),
      city: city.trim(),
      specialInstructions: String(specialInstructions || "").trim(),
    };

    if (order) {
      order.status = "pending";
      order.buyerName = shipping.fullName || req.user.name;
      order.amountPkr = totalPkr;
      order.itemAmountPkr = winningBid;
      order.deliveryChargesPkr = deliveryCharges;
      order.shipping = shipping;
      order.paymentStatus = "pending";
      order.removedByBuyer = false;
      await order.save();
    } else {
      order = await Order.create({
        buyerId: req.user._id,
        sellerId: product.sellerId,
        productId: product._id,
        type: "sale",
        status: "pending",
        size: product.listingSize || "M",
        buyerName: shipping.fullName || req.user.name,
        amountPkr: totalPkr,
        itemAmountPkr: winningBid,
        deliveryChargesPkr: deliveryCharges,
        shipping,
        paymentStatus: "pending",
        paymentProvider: "stripe",
      });
    }

    const stripe = getStripe();
    const currency = getCurrency();
    const unitAmount = toStripeUnitAmount(totalPkr);
    const frontend = getFrontendUrl();

    const imageUrl =
      product.mainImage &&
      /^https?:\/\//i.test(product.mainImage) &&
      product.mainImage.length < 2000
        ? product.mainImage
        : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: shipping.email || req.user.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: product.title || "Relux Hub purchase",
              description: `Winning bid + delivery (PKR ${totalPkr.toLocaleString("en-PK")})`,
              images: imageUrl ? [imageUrl] : undefined,
            },
          },
        },
      ],
      metadata: {
        orderId: order._id.toString(),
        orderPublicId: order.orderId,
        productId: product._id.toString(),
        buyerId: req.user._id.toString(),
      },
      success_url: `${frontend}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/payment/cancel?product_id=${product._id}`,
    });

    order.stripeSessionId = session.id;
    order.currency = currency;
    order.stripeAmount = unitAmount;
    await order.save();

    res.status(201).json({
      message: "Checkout session created",
      url: session.url,
      sessionId: session.id,
      order: order.toBuyerJSON(),
    });
  } catch (error) {
    console.error("[stripe checkout]", error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

/** Buyer: pay security deposit for an approved rental via Stripe */
async function createRentalCheckout(req, res) {
  try {
    if (req.user.role !== "buyer") {
      return res.status(403).json({ message: "Only buyers can checkout" });
    }

    const { orderId, fullName, phone, email, address, city, specialInstructions } = req.body;
    if (!orderId) {
      return res.status(400).json({ message: "Order id is required" });
    }

    const order = await Order.findOne({
      _id: orderId,
      buyerId: req.user._id,
      type: "rental",
      removedByBuyer: false,
    });

    if (!order) {
      return res.status(404).json({ message: "Rental order not found" });
    }
    if (order.status !== "approved") {
      return res.status(400).json({
        message: "Payment is only available after the seller approves your request",
      });
    }
    if (order.paymentStatus === "paid") {
      return res.status(400).json({ message: "This rental is already paid" });
    }

    const product = await Product.findById(order.productId);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    const deposit = parseAmount(product.itemPrice);
    const rentTotal =
      parseAmount(product.rentPrice) * Math.max(1, Number(order.rentalDays) || 1);
    const totalPkr =
      order.amountPkr > 0 ? order.amountPkr : deposit > 0 ? deposit : rentTotal;

    if (totalPkr <= 0) {
      return res.status(400).json({ message: "This rental has no payable amount" });
    }

    if (fullName?.trim() && phone?.trim() && address?.trim() && city?.trim()) {
      order.shipping = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: (email || req.user.email || "").trim(),
        address: address.trim(),
        city: city.trim(),
        specialInstructions: String(specialInstructions || "").trim(),
      };
      order.buyerName = fullName.trim();
    }

    order.amountPkr = totalPkr;
    order.itemAmountPkr = totalPkr;
    order.paymentStatus = "pending";
    order.paymentProvider = "stripe";
    await order.save();

    const stripe = getStripe();
    const currency = getCurrency();
    const unitAmount = toStripeUnitAmount(totalPkr);
    const frontend = getFrontendUrl();
    const imageUrl =
      product.mainImage &&
      /^https?:\/\//i.test(product.mainImage) &&
      product.mainImage.length < 2000
        ? product.mainImage
        : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: req.user.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: unitAmount,
            product_data: {
              name: `Rental deposit (escrow) — ${product.title || "Relux Hub"}`,
              description: `Security deposit held in escrow until return (PKR ${totalPkr.toLocaleString("en-PK")})`,
              images: imageUrl ? [imageUrl] : undefined,
            },
          },
        },
      ],
      metadata: {
        orderId: order._id.toString(),
        orderPublicId: order.orderId,
        productId: product._id.toString(),
        buyerId: req.user._id.toString(),
        orderType: "rental",
      },
      success_url: `${frontend}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/payment/cancel?order_id=${order._id}`,
    });

    order.stripeSessionId = session.id;
    order.currency = currency;
    order.stripeAmount = unitAmount;
    await order.save();

    res.status(201).json({
      message: "Checkout session created",
      url: session.url,
      sessionId: session.id,
      order: order.toBuyerJSON(),
    });
  } catch (error) {
    console.error("[stripe rental checkout]", error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function getCheckoutSessionStatus(req, res) {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ message: "Session id is required" });
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const order = await Order.findOne({ stripeSessionId: sessionId });

    if (order && String(order.buyerId) !== String(req.user._id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    if (
      order &&
      session.payment_status === "paid" &&
      order.paymentStatus !== "paid"
    ) {
      await markOrderPaidFromSession(session, order);
    }

    const fresh = order
      ? await Order.findById(order._id)
      : null;

    res.json({
      sessionId,
      paymentStatus: session.payment_status,
      order: fresh ? fresh.toBuyerJSON() : null,
    });
  } catch (error) {
    console.error("[stripe session status]", error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

async function markOrderPaidFromSession(session, orderDoc) {
  const order =
    orderDoc ||
    (await Order.findOne({
      $or: [
        { stripeSessionId: session.id },
        { _id: session.metadata?.orderId },
      ],
    }));

  if (!order) return null;
  if (order.paymentStatus === "paid") return order;

  order.paymentStatus = "paid";
  order.paidAt = new Date();
  order.stripeSessionId = session.id;
  order.stripePaymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || order.stripePaymentIntentId;
  if (order.status === "pending" || order.status === "cancelled") {
    order.status = "approved";
  }
  if (!order.fulfillmentStatus) {
    order.fulfillmentStatus = "processing";
  }
  if (order.type === "rental") {
    order.escrowStatus = "held";
    order.escrowHeldAt = new Date();
  }
  await order.save();
  await syncProductForOrder(order);

  const [product, buyer] = await Promise.all([
    Product.findById(order.productId),
    User.findById(order.buyerId).select("name email phone"),
  ]);

  const title = product?.title || (order.type === "rental" ? "Your rental" : "Your purchase");
  notifyPaymentReceived({
    buyerId: order.buyerId,
    productTitle: title,
    orderId: order._id,
    amountLabel: `PKR ${(order.amountPkr || 0).toLocaleString("en-PK")}`,
  });

  notifySellerDispatchDetails({
    sellerId: order.sellerId,
    order,
    product,
    buyer,
  });

  if (order.type === "rental") {
    notifyRentalOrderPaid({
      sellerId: order.sellerId,
      productTitle: title,
      orderId: order._id,
    });
  } else {
    notifySaleOrderPaid({
      sellerId: order.sellerId,
      productTitle: title,
      orderId: order._id,
    });
  }

  return order;
}

async function handleStripeWebhook(req, res) {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const stripe = getStripe();
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } else {
      // Local fallback when stripe listen secret not set yet
      event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      console.warn(
        "[stripe webhook] STRIPE_WEBHOOK_SECRET missing — accepting unverified event (dev only)",
      );
    }
  } catch (error) {
    console.error("[stripe webhook] signature", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.payment_status === "paid" || session.status === "complete") {
        await markOrderPaidFromSession(session);
      }
    }
    res.json({ received: true });
  } catch (error) {
    console.error("[stripe webhook] handler", error);
    res.status(500).json({ message: getErrorMessage(error) });
  }
}

module.exports = {
  createSaleCheckout,
  createRentalCheckout,
  getCheckoutSessionStatus,
  handleStripeWebhook,
};

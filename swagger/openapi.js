/**
 * Relux Hub OpenAPI 3.0 specification.
 * Served at GET /api-docs (Swagger UI) and GET /api-docs.json
 */

function bearer(optional = false) {
  return optional
    ? { security: [{ bearerAuth: [] }, {}] }
    : { security: [{ bearerAuth: [] }] };
}

function jsonBody(schema, required = true) {
  return {
    required,
    content: { "application/json": { schema } },
  };
}

function ok(description, schema = { type: "object" }) {
  return {
    description,
    content: { "application/json": { schema } },
  };
}

const errorResponses = {
  400: { description: "Bad request" },
  401: { description: "Unauthorized — missing or invalid JWT" },
  403: { description: "Forbidden — insufficient role" },
  404: { description: "Not found" },
  410: { description: "Gone — deprecated endpoint" },
  500: { description: "Server error" },
};

function pathItem(methods) {
  const item = {};
  for (const [method, def] of Object.entries(methods)) {
    item[method] = {
      ...def,
      responses: {
        ...(def.responses || {}),
        ...Object.fromEntries(
          Object.entries(errorResponses).filter(([code]) =>
            ["401", "403", "404", "500"].includes(code),
          ),
        ),
      },
    };
  }
  return item;
}

const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Relux Hub API",
    version: "1.0.0",
    description: `
Relux Hub backend — fashion rental & resale marketplace.

**Auth:** Most protected routes need \`Authorization: Bearer <JWT>\` from \`POST /api/auth/login\` or Google login.

**Roles:** \`buyer\`, \`seller\`, \`admin\`

**Base URL (local):** \`http://localhost:5002\`

**Realtime:** Socket.IO on the same host (chat, auctions, orders, support).
    `.trim(),
    contact: { name: "Relux Hub" },
  },
  servers: [
    { url: "http://localhost:5002", description: "Local development" },
  ],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Catalog" },
    { name: "Listings — Public" },
    { name: "Listings — Seller" },
    { name: "Listings — Admin" },
    { name: "Bids" },
    { name: "Orders — Buyer" },
    { name: "Orders — Seller" },
    { name: "Orders — Admin" },
    { name: "Payments" },
    { name: "Payments — Admin" },
    { name: "Stripe Connect" },
    { name: "Reports / Support" },
    { name: "Reports — Admin" },
    { name: "Messages" },
    { name: "Notifications" },
    { name: "Notifications — Admin" },
    { name: "Reviews" },
    { name: "Reviews — Admin" },
    { name: "Wishlist" },
    { name: "Contact" },
    { name: "Contact — Admin" },
    { name: "Categories" },
    { name: "Categories — Admin" },
    { name: "Upload" },
    { name: "Seller Verification" },
    { name: "Admin — Seller Verifications" },
    { name: "Admin — Users" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT from login / Google auth",
      },
    },
    schemas: {
      MessageResponse: {
        type: "object",
        properties: { message: { type: "string" } },
      },
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" },
        },
      },
      RegisterRequest: {
        type: "object",
        required: ["name", "email", "password"],
        properties: {
          name: { type: "string" },
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password" },
        },
      },
      ShippingDetails: {
        type: "object",
        required: ["fullName", "phone", "address", "city"],
        properties: {
          fullName: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
          address: { type: "string" },
          city: { type: "string" },
          specialInstructions: { type: "string" },
        },
      },
      EscrowResolveRequest: {
        type: "object",
        description: "Admin manual dispute split (sale, delivery, or return/damage)",
        properties: {
          sellerPayoutPkr: { type: "number", example: 10300 },
          refundAmountPkr: { type: "number", example: 90000 },
          decision: { type: "string" },
          adminSettlementNote: { type: "string" },
          resolveReport: { type: "boolean", default: true },
        },
      },
      DisputeReasonRequest: {
        type: "object",
        required: ["disputeReason"],
        properties: {
          disputeReason: { type: "string", example: "Item not received / damaged" },
        },
      },
      RentalRequest: {
        type: "object",
        required: ["productId", "rentStart", "rentEnd"],
        properties: {
          productId: { type: "string" },
          size: { type: "string", example: "M" },
          rentStart: { type: "string", format: "date", example: "2026-09-10" },
          rentEnd: { type: "string", format: "date", example: "2026-09-12" },
        },
      },
      ListingCreate: {
        type: "object",
        required: ["title", "listingType", "mainCategory", "mainImage", "gallery"],
        properties: {
          title: { type: "string" },
          listingType: { type: "string", enum: ["sale", "rent"] },
          mainCategory: { type: "string" },
          mainImage: { type: "string" },
          gallery: { type: "array", items: { type: "string" }, minItems: 4 },
          brand: { type: "string" },
          description: { type: "string" },
          listingSize: { type: "string" },
          listingCondition: { type: "string" },
          salePrice: { type: "string" },
          rentPrice: { type: "string", description: "Per-day rent (PKR)" },
          itemPrice: { type: "string", description: "Full dress / deposit price (PKR)" },
          startingBid: { type: "string" },
          minBid: { type: "string" },
          auctionEndDate: { type: "string" },
        },
      },
    },
  },
  paths: {
    "/": pathItem({
      get: {
        tags: ["Health"],
        summary: "API root",
        responses: { 200: ok("API is running", { $ref: "#/components/schemas/MessageResponse" }) },
      },
    }),
    "/api/health": pathItem({
      get: {
        tags: ["Health"],
        summary: "Health check + MongoDB ping",
        responses: {
          200: ok("Health status", {
            type: "object",
            properties: {
              status: { type: "string", example: "ok" },
              database: { type: "string", example: "connected" },
            },
          }),
        },
      },
    }),

    // —— Auth ——
    "/api/auth/register": pathItem({
      post: {
        tags: ["Auth"],
        summary: "Register buyer (email verification pending)",
        requestBody: jsonBody({ $ref: "#/components/schemas/RegisterRequest" }),
        responses: { 201: ok("Registered — verify email") },
      },
    }),
    "/api/auth/verify-email": pathItem({
      get: {
        tags: ["Auth"],
        summary: "Verify email (query token)",
        parameters: [{ name: "token", in: "query", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Email verified") },
      },
      post: {
        tags: ["Auth"],
        summary: "Verify email (body token)",
        requestBody: jsonBody({
          type: "object",
          required: ["token"],
          properties: { token: { type: "string" } },
        }),
        responses: { 200: ok("Email verified") },
      },
    }),
    "/api/auth/resend-verification": pathItem({
      post: {
        tags: ["Auth"],
        summary: "Resend verification email",
        requestBody: jsonBody({
          type: "object",
          required: ["email"],
          properties: { email: { type: "string" } },
        }),
        responses: { 200: ok("Verification email sent") },
      },
    }),
    "/api/auth/login": pathItem({
      post: {
        tags: ["Auth"],
        summary: "Login with email & password",
        requestBody: jsonBody({ $ref: "#/components/schemas/LoginRequest" }),
        responses: {
          200: ok("JWT + user", {
            type: "object",
            properties: {
              token: { type: "string" },
              user: { type: "object" },
            },
          }),
        },
      },
    }),
    "/api/auth/google": pathItem({
      post: {
        tags: ["Auth"],
        summary: "Login with Google ID token",
        requestBody: jsonBody({
          type: "object",
          required: ["credential"],
          properties: { credential: { type: "string" } },
        }),
        responses: { 200: ok("JWT + user") },
      },
    }),
    "/api/auth/forgot-password": pathItem({
      post: {
        tags: ["Auth"],
        summary: "Request password reset email",
        requestBody: jsonBody({
          type: "object",
          required: ["email"],
          properties: { email: { type: "string" } },
        }),
        responses: { 200: ok("Reset email sent if account exists") },
      },
    }),
    "/api/auth/reset-password": pathItem({
      post: {
        tags: ["Auth"],
        summary: "Reset password with token",
        requestBody: jsonBody({
          type: "object",
          required: ["token", "password"],
          properties: {
            token: { type: "string" },
            password: { type: "string" },
          },
        }),
        responses: { 200: ok("Password updated") },
      },
    }),
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Current user profile",
        ...bearer(),
        responses: { 200: ok("User profile"), 401: errorResponses[401] },
      },
      patch: {
        tags: ["Auth"],
        summary: "Update profile",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          properties: {
            name: { type: "string" },
            phone: { type: "string" },
            city: { type: "string" },
            address: { type: "string" },
            returnContactName: { type: "string" },
            returnPhone: { type: "string" },
            returnCity: { type: "string" },
            returnAddress: { type: "string" },
            twoFactorEnabled: { type: "boolean" },
            notificationPrefs: { type: "object" },
          },
        }),
        responses: { 200: ok("Updated user"), 401: errorResponses[401] },
      },
    },
    "/api/auth/me/email": pathItem({
      patch: {
        tags: ["Auth"],
        summary: "Change email",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string" },
            password: { type: "string" },
          },
        }),
        responses: { 200: ok("Email changed") },
      },
    }),
    "/api/auth/me/password": pathItem({
      patch: {
        tags: ["Auth"],
        summary: "Change password",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string" },
          },
        }),
        responses: { 200: ok("Password changed") },
      },
    }),
    "/api/auth/me/deactivate": pathItem({
      post: {
        tags: ["Auth"],
        summary: "Deactivate account",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          properties: {
            password: { type: "string" },
            confirm: { type: "boolean" },
          },
        }),
        responses: { 200: ok("Account deactivated") },
      },
    }),

    // —— Seller verification ——
    "/api/seller/verification": pathItem({
      post: {
        tags: ["Seller Verification"],
        summary: "Submit become-a-seller application",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: [
            "phone",
            "city",
            "returnContactName",
            "returnPhone",
            "returnCity",
            "returnAddress",
            "cnicFront",
            "cnicBack",
          ],
          properties: {
            phone: { type: "string" },
            city: { type: "string" },
            returnContactName: { type: "string" },
            returnPhone: { type: "string" },
            returnCity: { type: "string" },
            returnAddress: { type: "string" },
            cnicFront: { type: "string" },
            cnicBack: { type: "string" },
          },
        }),
        responses: { 201: ok("Verification submitted") },
      },
    }),
    "/api/seller/verification/me": pathItem({
      get: {
        tags: ["Seller Verification"],
        summary: "My verification status",
        ...bearer(),
        responses: { 200: ok("Verification record") },
      },
    }),
    "/api/seller/verification/documents": pathItem({
      put: {
        tags: ["Seller Verification"],
        summary: "Update CNIC documents (seller)",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          properties: {
            cnicFront: { type: "string" },
            cnicBack: { type: "string" },
          },
        }),
        responses: { 200: ok("Documents updated") },
      },
    }),
    "/api/admin/seller-verifications": pathItem({
      get: {
        tags: ["Admin — Seller Verifications"],
        summary: "List seller applications",
        ...bearer(),
        responses: { 200: ok("Applications list") },
      },
    }),
    "/api/admin/seller-verifications/{id}/approve": pathItem({
      patch: {
        tags: ["Admin — Seller Verifications"],
        summary: "Approve seller",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Approved") },
      },
    }),
    "/api/admin/seller-verifications/{id}/reject": pathItem({
      patch: {
        tags: ["Admin — Seller Verifications"],
        summary: "Reject seller",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          properties: { adminNote: { type: "string" } },
        }, false),
        responses: { 200: ok("Rejected") },
      },
    }),
    "/api/admin/seller-verifications/{id}/request-info": pathItem({
      patch: {
        tags: ["Admin — Seller Verifications"],
        summary: "Request more info from seller",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          required: ["adminNote"],
          properties: { adminNote: { type: "string" } },
        }),
        responses: { 200: ok("Info requested") },
      },
    }),

    // —— Catalog / public listings ——
    "/api/catalog/listings": pathItem({
      get: {
        tags: ["Catalog"],
        summary: "Public catalog listings",
        parameters: [
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "type", in: "query", schema: { type: "string", enum: ["sale", "rent"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 24 } },
        ],
        responses: { 200: ok("Listings") },
      },
    }),
    "/api/catalog/listings/{id}": pathItem({
      get: {
        tags: ["Catalog"],
        summary: "Catalog listing detail",
        ...bearer(true),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Listing") },
      },
    }),
    "/api/listings": pathItem({
      get: {
        tags: ["Listings — Public"],
        summary: "List public approved listings",
        parameters: [{ name: "category", in: "query", schema: { type: "string" } }],
        responses: { 200: ok("Listings") },
      },
    }),
    "/api/listings/{id}": pathItem({
      get: {
        tags: ["Listings — Public"],
        summary: "Get public listing",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Listing") },
      },
    }),

    // —— Seller listings ——
    "/api/seller/listings": pathItem({
      post: {
        tags: ["Listings — Seller"],
        summary: "Create listing",
        ...bearer(),
        requestBody: jsonBody({ $ref: "#/components/schemas/ListingCreate" }),
        responses: { 201: ok("Listing created") },
      },
    }),
    "/api/seller/listings/me": pathItem({
      get: {
        tags: ["Listings — Seller"],
        summary: "My listings",
        ...bearer(),
        responses: { 200: ok("Seller listings") },
      },
    }),
    "/api/seller/listings/{id}": pathItem({
      get: {
        tags: ["Listings — Seller"],
        summary: "Get own listing",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Listing") },
      },
      put: {
        tags: ["Listings — Seller"],
        summary: "Update listing",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/ListingCreate" }, false),
        responses: { 200: ok("Updated") },
      },
      delete: {
        tags: ["Listings — Seller"],
        summary: "Delete listing",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Deleted") },
      },
    }),
    "/api/seller/listings/{id}/availability": pathItem({
      patch: {
        tags: ["Listings — Seller"],
        summary: "Toggle listing availability",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          properties: { isAvailable: { type: "boolean" } },
        }),
        responses: { 200: ok("Availability updated") },
      },
    }),
    "/api/admin/listings": pathItem({
      get: {
        tags: ["Listings — Admin"],
        summary: "Listings for moderation",
        ...bearer(),
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
        responses: { 200: ok("Listings") },
      },
    }),
    "/api/admin/listings/{id}/approve": pathItem({
      patch: {
        tags: ["Listings — Admin"],
        summary: "Approve listing",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Approved") },
      },
    }),
    "/api/admin/listings/{id}/reject": pathItem({
      patch: {
        tags: ["Listings — Admin"],
        summary: "Reject listing",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          properties: { adminNote: { type: "string" } },
        }, false),
        responses: { 200: ok("Rejected") },
      },
    }),

    // —— Bids ——
    "/api/bids/me": pathItem({
      get: {
        tags: ["Bids"],
        summary: "My bids",
        ...bearer(),
        responses: { 200: ok("Bids") },
      },
    }),
    "/api/bids": pathItem({
      post: {
        tags: ["Bids"],
        summary: "Place bid",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: ["productId", "amount"],
          properties: {
            productId: { type: "string" },
            amount: { type: "number" },
          },
        }),
        responses: { 201: ok("Bid placed") },
      },
    }),
    "/api/bids/product/{productId}": pathItem({
      get: {
        tags: ["Bids"],
        summary: "Bids for a product",
        ...bearer(true),
        parameters: [
          { name: "productId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: ok("Bid history") },
      },
    }),

    // —— Buyer orders ——
    "/api/buyer/orders/me": pathItem({
      get: {
        tags: ["Orders — Buyer"],
        summary: "My buyer orders",
        ...bearer(),
        responses: { 200: ok("Orders") },
      },
    }),
    "/api/buyer/orders/rental": pathItem({
      post: {
        tags: ["Orders — Buyer"],
        summary: "Create rental request",
        ...bearer(),
        requestBody: jsonBody({ $ref: "#/components/schemas/RentalRequest" }),
        responses: { 201: ok("Rental request created") },
      },
    }),
    "/api/buyer/orders/{id}": pathItem({
      get: {
        tags: ["Orders — Buyer"],
        summary: "Get buyer order",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Order") },
      },
      delete: {
        tags: ["Orders — Buyer"],
        summary: "Remove order from buyer view",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Removed") },
      },
    }),
    "/api/buyer/orders/{id}/cancel": pathItem({
      patch: {
        tags: ["Orders — Buyer"],
        summary: "Cancel order",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Cancelled") },
      },
    }),
    "/api/buyer/orders/{id}/confirm-received": pathItem({
      patch: {
        tags: ["Orders — Buyer"],
        summary: "Confirm delivery received",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Confirmed") },
      },
    }),
    "/api/buyer/orders/{id}/mark-returned": pathItem({
      patch: {
        tags: ["Orders — Buyer"],
        summary: "Mark rental item returned",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Marked returned") },
      },
    }),
    "/api/buyer/orders/{id}/settlement": pathItem({
      get: {
        tags: ["Orders — Buyer"],
        summary: "Rental settlement / escrow summary",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Settlement") },
      },
    }),
    "/api/buyer/orders/{id}/rental-delivery/dispute": pathItem({
      post: {
        tags: ["Orders — Buyer"],
        summary: "Dispute rental delivery",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/DisputeReasonRequest" }),
        responses: { 200: ok("Dispute opened") },
      },
    }),
    "/api/buyer/orders/{id}/sale-escrow": pathItem({
      get: {
        tags: ["Orders — Buyer"],
        summary: "Sale escrow summary",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Sale escrow") },
      },
    }),
    "/api/buyer/orders/{id}/sale-escrow/dispute": pathItem({
      post: {
        tags: ["Orders — Buyer"],
        summary: "Dispute sale delivery",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/DisputeReasonRequest" }),
        responses: { 200: ok("Dispute opened") },
      },
    }),

    // —— Seller orders ——
    "/api/seller/orders/me": pathItem({
      get: {
        tags: ["Orders — Seller"],
        summary: "My seller orders",
        ...bearer(),
        responses: { 200: ok("Orders") },
      },
    }),
    "/api/seller/orders/{id}/approve": pathItem({
      patch: {
        tags: ["Orders — Seller"],
        summary: "Approve rental/sale request",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Approved") },
      },
    }),
    "/api/seller/orders/{id}/reject": pathItem({
      patch: {
        tags: ["Orders — Seller"],
        summary: "Reject request",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Rejected") },
      },
    }),
    "/api/seller/orders/{id}/ship": pathItem({
      patch: {
        tags: ["Orders — Seller"],
        summary: "Mark order shipped",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Shipped") },
      },
    }),
    "/api/seller/orders/{id}/confirm-return": pathItem({
      patch: {
        tags: ["Orders — Seller"],
        summary: "Confirm return — releases rental escrow (rent×days + delivery to Stripe)",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Escrow released") },
      },
    }),
    "/api/seller/orders/{id}/return/dispute": pathItem({
      post: {
        tags: ["Orders — Seller"],
        summary: "Dispute rental return (damage / late / missing)",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/DisputeReasonRequest" }),
        responses: { 200: ok("Return dispute opened") },
      },
    }),
    "/api/seller/orders/{id}/complete": pathItem({
      patch: {
        tags: ["Orders — Seller"],
        summary: "Complete order",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Completed") },
      },
    }),

    // —— Admin orders ——
    "/api/admin/orders/rental": pathItem({
      get: {
        tags: ["Orders — Admin"],
        summary: "List rental orders",
        ...bearer(),
        responses: { 200: ok("Rental orders") },
      },
    }),
    "/api/admin/orders/resale": pathItem({
      get: {
        tags: ["Orders — Admin"],
        summary: "List resale / sale orders",
        ...bearer(),
        responses: { 200: ok("Resale orders") },
      },
    }),
    "/api/admin/orders/{id}/settlement": pathItem({
      get: {
        tags: ["Orders — Admin"],
        summary: "Get order settlement / escrow (incl. rental days & rent per day)",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Settlement summary") },
      },
    }),
    "/api/admin/orders/{id}/settlement/resolve": pathItem({
      post: {
        tags: ["Orders — Admin"],
        summary: "Resolve rental dispute — manual seller payout + buyer refund",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/EscrowResolveRequest" }),
        responses: { 200: ok("Escrow released") },
      },
    }),
    "/api/admin/orders/{id}/sale-escrow/resolve": pathItem({
      post: {
        tags: ["Orders — Admin"],
        summary: "Resolve sale dispute — manual seller payout + buyer refund",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ $ref: "#/components/schemas/EscrowResolveRequest" }),
        responses: { 200: ok("Escrow released") },
      },
    }),
    "/api/admin/orders/{id}/status": pathItem({
      patch: {
        tags: ["Orders — Admin"],
        summary: "Update order status",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          required: ["status"],
          properties: { status: { type: "string" } },
        }),
        responses: { 200: ok("Status updated") },
      },
    }),

    // —— Payments ——
    "/api/payments/webhook": pathItem({
      post: {
        tags: ["Payments"],
        summary: "Stripe webhook (raw body + Stripe-Signature)",
        description: "Must use raw JSON body. Do not send Bearer token.",
        parameters: [
          {
            name: "Stripe-Signature",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: { 200: ok("Webhook handled") },
      },
    }),
    "/api/payments/checkout/sale-listing/{productId}": pathItem({
      get: {
        tags: ["Payments"],
        summary: "Prefetch sale checkout listing",
        ...bearer(),
        parameters: [
          { name: "productId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: ok("Listing + totals") },
      },
    }),
    "/api/payments/checkout/sale": pathItem({
      post: {
        tags: ["Payments"],
        summary: "Create Stripe Checkout for sale (USD)",
        ...bearer(),
        requestBody: jsonBody({
          allOf: [
            { $ref: "#/components/schemas/ShippingDetails" },
            {
              type: "object",
              required: ["productId"],
              properties: { productId: { type: "string" } },
            },
          ],
        }),
        responses: {
          201: ok("Checkout session", {
            type: "object",
            properties: {
              url: { type: "string" },
              sessionId: { type: "string" },
            },
          }),
        },
      },
    }),
    "/api/payments/checkout/rental": pathItem({
      post: {
        tags: ["Payments"],
        summary: "Create Stripe Checkout for rental deposit + delivery (USD)",
        ...bearer(),
        requestBody: jsonBody({
          allOf: [
            { $ref: "#/components/schemas/ShippingDetails" },
            {
              type: "object",
              required: ["orderId"],
              properties: { orderId: { type: "string" } },
            },
          ],
        }),
        responses: {
          201: ok("Checkout session + amounts", {
            type: "object",
            properties: {
              url: { type: "string" },
              sessionId: { type: "string" },
              amounts: {
                type: "object",
                properties: {
                  itemAmountPkr: { type: "number" },
                  deliveryChargesPkr: { type: "number" },
                  totalPkr: { type: "number" },
                  currency: { type: "string", example: "usd" },
                },
              },
            },
          }),
        },
      },
    }),
    "/api/payments/session/{sessionId}": pathItem({
      get: {
        tags: ["Payments"],
        summary: "Checkout session status",
        ...bearer(),
        parameters: [
          { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: ok("Session status") },
      },
    }),
    "/api/admin/payments": pathItem({
      get: {
        tags: ["Payments — Admin"],
        summary: "List payment-related orders",
        ...bearer(),
        responses: { 200: ok("Payments") },
      },
    }),

    // —— Stripe Connect ——
    "/api/seller/stripe/connect": pathItem({
      post: {
        tags: ["Stripe Connect"],
        summary: "Create Connect onboarding link",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          properties: { returnTo: { type: "string", example: "profile" } },
        }, false),
        responses: { 200: ok("Onboarding URL") },
      },
    }),
    "/api/seller/stripe/dashboard-link": pathItem({
      post: {
        tags: ["Stripe Connect"],
        summary: "Express dashboard link",
        ...bearer(),
        responses: { 200: ok("Dashboard URL") },
      },
    }),
    "/api/seller/stripe/status": pathItem({
      get: {
        tags: ["Stripe Connect"],
        summary: "Connect account status",
        ...bearer(),
        responses: { 200: ok("Status") },
      },
    }),
    "/api/seller/stripe/payouts": pathItem({
      get: {
        tags: ["Stripe Connect"],
        summary: "Seller payout overview (Relux ledger + Stripe balance)",
        ...bearer(),
        responses: { 200: ok("Payouts") },
      },
    }),
    "/api/seller/stripe/payouts/retry": pathItem({
      post: {
        tags: ["Stripe Connect"],
        summary: "Retry failed / ledger_only Stripe transfers",
        ...bearer(),
        responses: { 200: ok("Retry results") },
      },
    }),

    // —— Reports ——
    "/api/reports/me": pathItem({
      get: {
        tags: ["Reports / Support"],
        summary: "My support reports",
        ...bearer(),
        responses: { 200: ok("Reports") },
      },
    }),
    "/api/reports": pathItem({
      post: {
        tags: ["Reports / Support"],
        summary: "Create support report",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: ["issueType", "subject", "message"],
          properties: {
            issueType: { type: "string" },
            subject: { type: "string" },
            message: { type: "string" },
            images: { type: "array", items: { type: "string" } },
            orderId: { type: "string" },
          },
        }),
        responses: { 201: ok("Report created") },
      },
    }),
    "/api/reports/{id}/seller-response": pathItem({
      post: {
        tags: ["Reports / Support"],
        summary: "Seller reply on report",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          required: ["response"],
          properties: { response: { type: "string" } },
        }),
        responses: { 200: ok("Response saved") },
      },
    }),
    "/api/reports/{id}/buyer-response": pathItem({
      post: {
        tags: ["Reports / Support"],
        summary: "Buyer reply on report",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          required: ["response"],
          properties: { response: { type: "string" } },
        }),
        responses: { 200: ok("Response saved") },
      },
    }),
    "/api/admin/reports": pathItem({
      get: {
        tags: ["Reports — Admin"],
        summary: "List all reports",
        ...bearer(),
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "role", in: "query", schema: { type: "string", enum: ["buyer", "seller"] } },
        ],
        responses: { 200: ok("Reports") },
      },
    }),
    "/api/admin/reports/{id}": pathItem({
      patch: {
        tags: ["Reports — Admin"],
        summary: "Update / resolve report (Support Center)",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          properties: {
            status: { type: "string" },
            adminReply: { type: "string" },
            adminNote: { type: "string" },
            askSeller: { type: "boolean" },
            askBuyer: { type: "boolean" },
            askBoth: { type: "boolean" },
            messageToSeller: { type: "string" },
            messageToBuyer: { type: "string" },
            decision: { type: "string" },
          },
        }, false),
        responses: { 200: ok("Report updated") },
      },
    }),

    // —— Messages ——
    "/api/messages/conversations": pathItem({
      get: {
        tags: ["Messages"],
        summary: "List conversations",
        ...bearer(),
        responses: { 200: ok("Conversations") },
      },
    }),
    "/api/messages/unread-count": pathItem({
      get: {
        tags: ["Messages"],
        summary: "Unread message count",
        ...bearer(),
        responses: { 200: ok("Count") },
      },
    }),
    "/api/messages/conversations/open": pathItem({
      post: {
        tags: ["Messages"],
        summary: "Open or create conversation",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          properties: {
            listingKey: { type: "string" },
            dressId: { type: "string" },
            productId: { type: "string" },
            sellerId: { type: "string" },
            buyerId: { type: "string" },
            listingTitle: { type: "string" },
            listingImage: { type: "string" },
          },
        }),
        responses: { 200: ok("Conversation") },
      },
    }),
    "/api/messages/conversations/read-all": pathItem({
      patch: {
        tags: ["Messages"],
        summary: "Mark all conversations read",
        ...bearer(),
        responses: { 200: ok("Done") },
      },
    }),
    "/api/messages/conversations/{id}": pathItem({
      get: {
        tags: ["Messages"],
        summary: "Get conversation thread",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Thread") },
      },
    }),
    "/api/messages/conversations/{id}/messages": pathItem({
      post: {
        tags: ["Messages"],
        summary: "Send message",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          properties: {
            text: { type: "string" },
            image: { type: "string" },
          },
        }),
        responses: { 201: ok("Message sent") },
      },
      delete: {
        tags: ["Messages"],
        summary: "Clear conversation messages",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Cleared") },
      },
    }),
    "/api/messages/conversations/{id}/read": pathItem({
      patch: {
        tags: ["Messages"],
        summary: "Mark conversation read",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Read") },
      },
    }),
    "/api/messages/conversations/{id}/mute": pathItem({
      patch: {
        tags: ["Messages"],
        summary: "Toggle mute",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Muted state") },
      },
    }),
    "/api/messages/conversations/{id}/block": pathItem({
      patch: {
        tags: ["Messages"],
        summary: "Block conversation",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Blocked") },
      },
    }),

    // —— Notifications ——
    "/api/notifications/me": pathItem({
      get: {
        tags: ["Notifications"],
        summary: "My notifications",
        ...bearer(),
        parameters: [{ name: "filter", in: "query", schema: { type: "string", default: "all" } }],
        responses: { 200: ok("Notifications") },
      },
    }),
    "/api/notifications/unread-count": pathItem({
      get: {
        tags: ["Notifications"],
        summary: "Unread notification count",
        ...bearer(),
        responses: { 200: ok("Count") },
      },
    }),
    "/api/notifications/read-all": pathItem({
      patch: {
        tags: ["Notifications"],
        summary: "Mark all notifications read",
        ...bearer(),
        responses: { 200: ok("Done") },
      },
    }),
    "/api/notifications/{id}": pathItem({
      get: {
        tags: ["Notifications"],
        summary: "Get notification",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Notification") },
      },
    }),
    "/api/notifications/{id}/read": pathItem({
      patch: {
        tags: ["Notifications"],
        summary: "Mark one notification read",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Read") },
      },
    }),
    "/api/admin/notifications/recipients": pathItem({
      get: {
        tags: ["Notifications — Admin"],
        summary: "Broadcast audience counts",
        ...bearer(),
        responses: { 200: ok("Recipients") },
      },
    }),
    "/api/admin/notifications": pathItem({
      get: {
        tags: ["Notifications — Admin"],
        summary: "List broadcasts",
        ...bearer(),
        responses: { 200: ok("Broadcasts") },
      },
      post: {
        tags: ["Notifications — Admin"],
        summary: "Send broadcast notification",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: ["title", "message"],
          properties: {
            title: { type: "string" },
            message: { type: "string" },
            recipients: { type: "string", example: "all" },
            priority: { type: "string", example: "normal" },
          },
        }),
        responses: { 201: ok("Broadcast sent") },
      },
    }),

    // —— Reviews ——
    "/api/reviews/seller/{sellerId}": pathItem({
      get: {
        tags: ["Reviews"],
        summary: "Public seller reviews",
        parameters: [
          { name: "sellerId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: ok("Reviews") },
      },
    }),
    "/api/reviews": pathItem({
      post: {
        tags: ["Reviews"],
        summary: "Create seller review",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: ["sellerId", "rating", "quote"],
          properties: {
            sellerId: { type: "string" },
            rating: { type: "number" },
            quote: { type: "string" },
            authorName: { type: "string" },
            author: { type: "string" },
            reportReason: { type: "string" },
            reportDetails: { type: "string" },
            productId: { type: "string" },
          },
        }),
        responses: { 201: ok("Review created") },
      },
    }),
    "/api/admin/reviews": pathItem({
      get: {
        tags: ["Reviews — Admin"],
        summary: "List reviews",
        ...bearer(),
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "rating", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: ok("Reviews") },
      },
    }),
    "/api/admin/reviews/{id}/status": pathItem({
      patch: {
        tags: ["Reviews — Admin"],
        summary: "Update review status",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          required: ["status"],
          properties: { status: { type: "string" } },
        }),
        responses: { 200: ok("Updated") },
      },
    }),
    "/api/admin/reviews/{id}": pathItem({
      delete: {
        tags: ["Reviews — Admin"],
        summary: "Delete review",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Deleted") },
      },
    }),

    // —— Wishlist ——
    "/api/wishlist/me": pathItem({
      get: {
        tags: ["Wishlist"],
        summary: "My wishlist",
        ...bearer(),
        responses: { 200: ok("Wishlist") },
      },
    }),
    "/api/wishlist": pathItem({
      post: {
        tags: ["Wishlist"],
        summary: "Add wishlist item",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          properties: {
            itemId: { type: "string" },
            id: { type: "string" },
            productId: { type: "string" },
            title: { type: "string" },
            brand: { type: "string" },
            image: { type: "string" },
            listingType: { type: "string" },
            price: { type: "string" },
          },
        }),
        responses: { 201: ok("Added") },
      },
    }),
    "/api/wishlist/toggle": pathItem({
      post: {
        tags: ["Wishlist"],
        summary: "Toggle wishlist item",
        ...bearer(),
        requestBody: jsonBody({ type: "object" }),
        responses: { 200: ok("Toggled") },
      },
    }),
    "/api/wishlist/{itemId}": pathItem({
      delete: {
        tags: ["Wishlist"],
        summary: "Remove wishlist item",
        ...bearer(),
        parameters: [{ name: "itemId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Removed") },
      },
    }),

    // —— Contact ——
    "/api/contact": pathItem({
      post: {
        tags: ["Contact"],
        summary: "Submit contact message",
        requestBody: jsonBody({
          type: "object",
          required: ["name", "email", "message"],
          properties: {
            name: { type: "string" },
            email: { type: "string" },
            message: { type: "string" },
          },
        }),
        responses: { 201: ok("Message received") },
      },
    }),
    "/api/admin/contact": pathItem({
      get: {
        tags: ["Contact — Admin"],
        summary: "List contact messages",
        ...bearer(),
        parameters: [{ name: "status", in: "query", schema: { type: "string" } }],
        responses: { 200: ok("Messages") },
      },
    }),
    "/api/admin/contact/{id}": pathItem({
      patch: {
        tags: ["Contact — Admin"],
        summary: "Update contact status / note",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          properties: {
            status: { type: "string" },
            adminNote: { type: "string" },
          },
        }, false),
        responses: { 200: ok("Updated") },
      },
    }),
    "/api/admin/contact/{id}/reply": pathItem({
      post: {
        tags: ["Contact — Admin"],
        summary: "Reply to contact message",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({
          type: "object",
          required: ["reply"],
          properties: { reply: { type: "string" } },
        }),
        responses: { 200: ok("Reply sent") },
      },
    }),

    // —— Categories ——
    "/api/categories": pathItem({
      get: {
        tags: ["Categories"],
        summary: "Public active categories",
        responses: { 200: ok("Categories") },
      },
    }),
    "/api/admin/categories": pathItem({
      get: {
        tags: ["Categories — Admin"],
        summary: "List all categories",
        ...bearer(),
        responses: { 200: ok("Categories") },
      },
      post: {
        tags: ["Categories — Admin"],
        summary: "Create category",
        ...bearer(),
        requestBody: jsonBody({
          type: "object",
          required: ["name", "type"],
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["main", "sub"] },
            parentSlug: { type: "string" },
            slug: { type: "string" },
            icon: { type: "string" },
            iconVariant: { type: "string" },
            imageUrl: { type: "string" },
            productStyleKey: { type: "string" },
            sortOrder: { type: "number" },
          },
        }),
        responses: { 201: ok("Created") },
      },
    }),
    "/api/admin/categories/{id}": pathItem({
      patch: {
        tags: ["Categories — Admin"],
        summary: "Update category",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: jsonBody({ type: "object" }, false),
        responses: { 200: ok("Updated") },
      },
      delete: {
        tags: ["Categories — Admin"],
        summary: "Delete / deactivate category",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Deleted") },
      },
    }),

    // —— Upload ——
    "/api/upload/listing": pathItem({
      post: {
        tags: ["Upload"],
        summary: "Upload listing image (multipart field: file, max 5MB)",
        ...bearer(),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: { 201: ok("Image URL") },
      },
    }),
    "/api/upload/verification": pathItem({
      post: {
        tags: ["Upload"],
        summary: "Upload verification / CNIC image",
        ...bearer(),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: { 201: ok("Image URL") },
      },
    }),
    "/api/upload/support": pathItem({
      post: {
        tags: ["Upload"],
        summary: "Upload support / report evidence image",
        ...bearer(),
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: { file: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: { 201: ok("Image URL") },
      },
    }),

    // —— Admin users ——
    "/api/admin/users": pathItem({
      get: {
        tags: ["Admin — Users"],
        summary: "List users",
        ...bearer(),
        parameters: [
          { name: "role", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "q", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: ok("Users") },
      },
    }),
    "/api/admin/users/{id}/suspend": pathItem({
      patch: {
        tags: ["Admin — Users"],
        summary: "Suspend user",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Suspended") },
      },
    }),
    "/api/admin/users/{id}/reactivate": pathItem({
      patch: {
        tags: ["Admin — Users"],
        summary: "Reactivate user",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Reactivated") },
      },
    }),
    "/api/admin/users/{id}/approve": pathItem({
      patch: {
        tags: ["Admin — Users"],
        summary: "Approve user",
        ...bearer(),
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: ok("Approved") },
      },
    }),
  },
};

module.exports = { openApiDocument };

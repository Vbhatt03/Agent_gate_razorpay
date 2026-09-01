import {
  bigserial,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
};

export const agentStatus = pgEnum("agent_status", ["active", "suspended", "revoked"]);
export const orderStatus = pgEnum("order_status", [
  "pending",
  "awaiting_approval",
  "policy_blocked",
  "paid",
  "failed",
  "cancelled",
]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);

export const merchants = pgTable("merchants", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  razorpayKeyId: text("razorpay_key_id").notNull(),
  razorpayKeySecretEncrypted: text("razorpay_key_secret_encrypted").notNull(),
  ...timestamps,
});

export const policies = pgTable("policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchants.id)
    .unique(),
  maxTxnPaise: bigint("max_txn_paise", { mode: "number" }).notNull(),
  dailySpendCapPaise: bigint("daily_spend_cap_paise", { mode: "number" }).notNull(),
  discountFloorPct: numeric("discount_floor_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  approvalThresholdPaise: bigint("approval_threshold_paise", { mode: "number" }).notNull(),
  allowedCategories: text("allowed_categories").array().notNull().default([]),
  maxOrdersPerHour: integer("max_orders_per_hour").notNull().default(3),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
    category: text("category").notNull(),
    stock: integer("stock").notNull().default(0),
    discountFloorPct: numeric("discount_floor_pct", { precision: 5, scale: 2 })
      .notNull()
      .default("0"),
    isEasilyReversible: boolean("is_easily_reversible").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("catalog_items_merchant_sku_unique").on(table.merchantId, table.sku),
    index("catalog_items_merchant_category_idx").on(table.merchantId, table.category),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id),
    name: text("name").notNull(),
    apiKeyPrefix: text("api_key_prefix").notNull(),
    apiKeyHash: text("api_key_hash").notNull(),
    trustScore: numeric("trust_score", { precision: 3, scale: 2 }).notNull().default("0.50"),
    status: agentStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (table) => [uniqueIndex("agents_api_key_prefix_unique").on(table.apiKeyPrefix)],
);

export const negotiations = pgTable(
  "negotiations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    sku: text("sku").notNull(),
    requestedPricePaise: bigint("requested_price_paise", { mode: "number" }).notNull(),
    offeredPricePaise: bigint("offered_price_paise", { mode: "number" }),
    reasonText: text("reason_text"),
    policyResult: jsonb("policy_result").notNull(),
    ...timestamps,
  },
  (table) => [index("negotiations_agent_created_idx").on(table.agentId, table.createdAt)],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id),
    razorpayOrderId: text("razorpay_order_id"),
    paymentLink: text("payment_link"),
    idempotencyKey: text("idempotency_key").notNull(),
    quantity: integer("quantity").notNull(),
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    status: orderStatus("status").notNull().default("pending"),
    policyChecks: jsonb("policy_checks").notNull(),
    policyVersion: integer("policy_version").notNull(),
    ...timestamps,
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("orders_razorpay_order_id_unique").on(table.razorpayOrderId),
    uniqueIndex("orders_agent_idempotency_key_unique").on(table.agentId, table.idempotencyKey),
    index("orders_agent_created_idx").on(table.agentId, table.createdAt),
  ],
);

export const orderApprovals = pgTable("order_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  status: approvalStatus("status").notNull().default("pending"),
  approverId: text("approver_id"),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...timestamps,
});

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  razorpayEventId: text("razorpay_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payloadHash: text("payload_hash").notNull(),
  processingResult: text("processing_result").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    correlationId: uuid("correlation_id").notNull(),
    merchantId: uuid("merchant_id").references(() => merchants.id),
    agentId: uuid("agent_id").references(() => agents.id),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    action: text("action").notNull(),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    policyResult: jsonb("policy_result"),
    ...timestamps,
  },
  (table) => [
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_correlation_id_idx").on(table.correlationId),
  ],
);

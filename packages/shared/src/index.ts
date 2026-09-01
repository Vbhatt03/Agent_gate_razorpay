import { z } from "zod";

// ── Amount helpers ───────────────────────────────────────────────────────────

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToDisplayString(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

export function isSafePaise(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// ── MCP tool input/output schemas ───────────────────────────────────────────

export const CatalogSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  max_price_paise: z.number().int().positive().optional(),
  category: z.string().trim().min(1).max(50).optional(),
});
export type CatalogSearchInput = z.infer<typeof CatalogSearchInputSchema>;

export const CatalogSearchOutputSchema = z.object({
  results: z.array(z.object({
    sku: z.string(),
    name: z.string(),
    price_paise: z.number(),
    category: z.string(),
    in_stock: z.boolean(),
  })),
});
export type CatalogSearchOutput = z.infer<typeof CatalogSearchOutputSchema>;

export const GetProductInputSchema = z.object({
  sku: z.string().min(1).max(100),
});
export type GetProductInput = z.infer<typeof GetProductInputSchema>;

export const NegotiateOfferInputSchema = z.object({
  sku: z.string().min(1).max(100),
  target_price_paise: z.number().int().positive(),
});
export type NegotiateOfferInput = z.infer<typeof NegotiateOfferInputSchema>;

export const NegotiateOfferOutputSchema = z.union([
  z.object({
    allowed: z.literal(true),
    offered_price_paise: z.number(),
    reason: z.string(),
    correlation_id: z.string().optional(),
  }),
  z.object({
    allowed: z.literal(false),
    reason: z.string(),
    policy_rule: z.string(),
    correlation_id: z.string().optional(),
  }),
]);
export type NegotiateOfferOutput = z.infer<typeof NegotiateOfferOutputSchema>;

export const CreateOrderInputSchema = z.object({
  sku: z.string().min(1).max(100),
  quantity: z.number().int().positive(),
  agreed_price_paise: z.number().int().positive(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInputSchema>;

export const CreateOrderOutputSchema = z.union([
  z.object({
    status: z.literal("created"),
    razorpay_order_id: z.string(),
    payment_link: z.string().url(),
  }),
  z.object({
    status: z.literal("awaiting_approval"),
    order_id: z.string(),
  }),
  z.object({
    status: z.literal("policy_blocked"),
    reason: z.string(),
    policy_rule: z.string(),
    correlation_id: z.string().optional(),
  }),
]);
export type CreateOrderOutput = z.infer<typeof CreateOrderOutputSchema>;

export const GetOrderStatusInputSchema = z.object({
  order_id: z.string().uuid(),
});
export type GetOrderStatusInput = z.infer<typeof GetOrderStatusInputSchema>;

export const OrderStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "awaiting_approval", "paid", "failed", "policy_blocked", "cancelled"]),
  amount_paise: z.number(),
  sku: z.string(),
  quantity: z.number(),
  razorpay_order_id: z.string().nullable(),
  payment_link: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime().optional(),
  correlation_id: z.string().optional(),
});
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const GetOrderStatusOutputSchema = z.object({
  order: OrderStatusSchema,
  audit_trail_url: z.string().url().optional(),
});
export type GetOrderStatusOutput = z.infer<typeof GetOrderStatusOutputSchema>;

// ── Policy rule types ────────────────────────────────────────────────────────

export const PolicyRuleSchema = z.enum([
  "item_active", "stock_available", "agent_active", "quantity_valid",
  "category_allowed", "discount_floor", "listed_price",
  "max_txn_value", "daily_spend_cap", "rate_limit",
]);
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export const PolicyCheckSchema = z.object({
  rule: PolicyRuleSchema,
  passed: z.boolean(),
  limit: z.number().optional(),
  attempted: z.number().optional(),
  detail: z.string(),
});
export type PolicyCheck = z.infer<typeof PolicyCheckSchema>;

export const PolicyDecisionSchema = z.object({
  allowed: z.boolean(),
  requiresHumanApproval: z.boolean(),
  approvalThresholdPaise: z.number(),
  checks: z.array(PolicyCheckSchema),
  policyVersion: z.number(),
  reason: PolicyRuleSchema.optional(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

// ── Webhook payload schema ───────────────────────────────────────────────────

export const RazorpayWebhookPayloadSchema = z.object({
  entity: z.string(),
  account_id: z.string().optional(),
  event: z.string(),
  contains: z.array(z.string()).optional(),
  payload: z.object({
    payment: z.object({
      entity: z.object({
        id: z.string(),
        order_id: z.string().optional(),
        amount: z.number(),
        currency: z.string(),
        status: z.string(),
        error_code: z.string().optional(),
        error_description: z.string().optional(),
        created_at: z.number(),
      }),
    }).optional(),
    order: z.object({
      entity: z.object({
        id: z.string(),
        status: z.string(),
        amount_paid: z.number().optional(),
        amount_due: z.number().optional(),
      }),
    }).optional(),
  }),
  created_at: z.number(),
});
export type RazorpayWebhookPayload = z.infer<typeof RazorpayWebhookPayloadSchema>;
export type AgentStatus = "active" | "suspended" | "revoked";

export type PolicyRule =
  | "item_active"
  | "stock_available"
  | "agent_active"
  | "quantity_valid"
  | "category_allowed"
  | "discount_floor"
  | "listed_price"
  | "max_txn_value"
  | "daily_spend_cap"
  | "rate_limit";

export type PolicyCheck = {
  rule: PolicyRule;
  passed: boolean;
  limit?: number;
  attempted?: number;
  detail: string;
};

export type MerchantPolicy = {
  version: number;
  maxTxnPaise: number;
  dailySpendCapPaise: number;
  approvalThresholdPaise: number;
  allowedCategories: readonly string[];
  maxOrdersPerHour: number;
};

export type CatalogItemForPolicy = {
  id: string
  sku: string;
  name: string;
  pricePaise: number;
  discountFloorBasisPoints: number;
  category: string;
  stock: number;
  isActive: boolean;
  isEasilyReversible: boolean;
};

export type PolicyContext = {
  agentStatus: AgentStatus;
  item: CatalogItemForPolicy;
  todaySpendPaise: number;
  ordersInLastHour: number;
};

export type OrderInput = {
  agreedUnitPricePaise: number;
  quantity: number;
};

export type PolicyDecision = {
  allowed: boolean;
  requiresHumanApproval: boolean;
  approvalThresholdPaise: number;
  checks: PolicyCheck[];
  policyVersion: number;
  reason?: PolicyRule;
};

export type NegotiationDecision = {
  allowed: boolean;
  minimumOfferPaise: number;
  maximumOfferPaise: number;
  checks: PolicyCheck[];
  policyVersion: number;
  reason?: PolicyRule;
};

function check(
  rule: PolicyRule,
  passed: boolean,
  detail: string,
  limit?: number,
  attempted?: number,
): PolicyCheck {
  return { rule, passed, detail, limit, attempted };
}

function firstFailure(checks: PolicyCheck[]): PolicyRule | undefined {
  return checks.find((entry) => !entry.passed)?.rule;
}

export function minimumAllowedPricePaise(item: CatalogItemForPolicy): number {
  if (!Number.isInteger(item.pricePaise) || item.pricePaise < 0) {
    throw new Error("Catalog price must be a non-negative integer number of paise.");
  }

  if (
    !Number.isInteger(item.discountFloorBasisPoints) ||
    item.discountFloorBasisPoints < 0 ||
    item.discountFloorBasisPoints > 10_000
  ) {
    throw new Error("Discount floor must be an integer between 0 and 10,000 basis points.");
  }

  return Math.ceil((item.pricePaise * (10_000 - item.discountFloorBasisPoints)) / 10_000);
}

function baseChecks(context: PolicyContext, quantity: number): PolicyCheck[] {
  const { agentStatus, item } = context;

  return [
    check("item_active", item.isActive, "The SKU is active."),
    check("agent_active", agentStatus === "active", "The agent is active."),
    check(
      "quantity_valid",
      Number.isInteger(quantity) && quantity > 0,
      "Quantity must be a positive whole number.",
      undefined,
      quantity,
    ),
    check(
      "stock_available",
      Number.isInteger(quantity) && quantity > 0 && item.stock >= quantity,
      "Requested quantity is available in stock.",
      item.stock,
      quantity,
    ),
  ];
}

export function evaluateNegotiation(
  policy: MerchantPolicy,
  context: PolicyContext,
  targetPricePaise: number,
): NegotiationDecision {
  const { item } = context;
  const minimumOfferPaise = minimumAllowedPricePaise(item);
  const checks = [
    ...baseChecks(context, 1),
    check(
      "category_allowed",
      policy.allowedCategories.includes(item.category),
      "Item category is permitted for this agent.",
    ),
    check(
      "discount_floor",
      Number.isInteger(targetPricePaise) && targetPricePaise >= minimumOfferPaise,
      "Target price meets the SKU discount floor.",
      minimumOfferPaise,
      targetPricePaise,
    ),
    check(
      "listed_price",
      Number.isInteger(targetPricePaise) && targetPricePaise <= item.pricePaise,
      "Target price does not exceed the listed price.",
      item.pricePaise,
      targetPricePaise,
    ),
  ];
  const reason = firstFailure(checks);

  return {
    allowed: !reason,
    minimumOfferPaise,
    maximumOfferPaise: item.pricePaise,
    checks,
    policyVersion: policy.version,
    ...(reason ? { reason } : {}),
  };
}

export function evaluateOrder(
  policy: MerchantPolicy,
  context: PolicyContext,
  input: OrderInput,
): PolicyDecision {
  const { item } = context;
  const totalPaise = input.agreedUnitPricePaise * input.quantity;
  const minimumPricePaise = minimumAllowedPricePaise(item);
  const checks = [
    ...baseChecks(context, input.quantity),
    check(
      "category_allowed",
      policy.allowedCategories.includes(item.category),
      "Item category is permitted for this agent.",
    ),
    check(
      "discount_floor",
      Number.isInteger(input.agreedUnitPricePaise) && input.agreedUnitPricePaise >= minimumPricePaise,
      "Agreed unit price meets the SKU discount floor.",
      minimumPricePaise,
      input.agreedUnitPricePaise,
    ),
    check(
      "listed_price",
      Number.isInteger(input.agreedUnitPricePaise) && input.agreedUnitPricePaise <= item.pricePaise,
      "Agreed unit price does not exceed the listed price.",
      item.pricePaise,
      input.agreedUnitPricePaise,
    ),
    check(
      "max_txn_value",
      Number.isSafeInteger(totalPaise) && totalPaise <= policy.maxTxnPaise,
      "Order total is within the maximum transaction value.",
      policy.maxTxnPaise,
      totalPaise,
    ),
    check(
      "daily_spend_cap",
      Number.isSafeInteger(totalPaise) && context.todaySpendPaise + totalPaise <= policy.dailySpendCapPaise,
      "Order total stays within the agent daily spend cap.",
      policy.dailySpendCapPaise,
      context.todaySpendPaise + totalPaise,
    ),
    check(
      "rate_limit",
      context.ordersInLastHour < policy.maxOrdersPerHour,
      "Agent is within the hourly order limit.",
      policy.maxOrdersPerHour,
      context.ordersInLastHour,
    ),
  ];
  const reason = firstFailure(checks);
  const approvalThresholdPaise = item.isEasilyReversible
    ? policy.approvalThresholdPaise
    : Math.min(policy.approvalThresholdPaise, Math.floor(policy.maxTxnPaise / 2));

  return {
    allowed: !reason,
    requiresHumanApproval: !reason && totalPaise >= approvalThresholdPaise,
    approvalThresholdPaise,
    checks,
    policyVersion: policy.version,
    ...(reason ? { reason } : {}),
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateNegotiation,
  evaluateOrder,
  type CatalogItemForPolicy,
  type MerchantPolicy,
  type PolicyContext,
} from "../src/policy/engine.js";

const policy: MerchantPolicy = {
  version: 1,
  maxTxnPaise: 500_000,
  dailySpendCapPaise: 1_500_000,
  approvalThresholdPaise: 500_000,
  allowedCategories: ["audio", "accessories"],
  maxOrdersPerHour: 3,
};

const item: CatalogItemForPolicy = {
  sku: "EARBUDS-BLK-01",
  pricePaise: 185_000,
  discountFloorBasisPoints: 800,
  category: "audio",
  stock: 12,
  isActive: true,
  isEasilyReversible: true,
};

function context(overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    agentStatus: "active",
    item,
    todaySpendPaise: 0,
    ordersInLastHour: 0,
    ...overrides,
  };
}

test("T1: allows an order within all policy limits", () => {
  const result = evaluateOrder(policy, context(), { agreedUnitPricePaise: 185_000, quantity: 1 });

  assert.equal(result.allowed, true);
  assert.equal(result.requiresHumanApproval, false);
});

test("T2: blocks an order above the maximum transaction value", () => {
  const result = evaluateOrder(policy, context(), { agreedUnitPricePaise: 185_000, quantity: 3 });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "max_txn_value");
});

test("T3: blocks an order that exceeds the daily spend cap", () => {
  const result = evaluateOrder(policy, context({ todaySpendPaise: 1_400_000 }), {
    agreedUnitPricePaise: 185_000,
    quantity: 1,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "daily_spend_cap");
});

test("T4: rejects a negotiation below the SKU discount floor", () => {
  const result = evaluateNegotiation(policy, context(), 170_000);

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "discount_floor");
  assert.equal(result.minimumOfferPaise, 170_200);
});

test("T5: blocks a category outside the merchant allow-list", () => {
  const result = evaluateOrder(
    policy,
    context({ item: { ...item, category: "gift_cards" } }),
    { agreedUnitPricePaise: 185_000, quantity: 1 },
  );

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "category_allowed");
});

test("T6: blocks the fourth order inside one hour", () => {
  const result = evaluateOrder(policy, context({ ordersInLastHour: 3 }), {
    agreedUnitPricePaise: 185_000,
    quantity: 1,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "rate_limit");
});

test("T7: requires approval at the approval threshold", () => {
  const result = evaluateOrder(policy, context({ item: { ...item, pricePaise: 500_000, discountFloorBasisPoints: 0 } }), {
    agreedUnitPricePaise: 500_000,
    quantity: 1,
  });

  assert.equal(result.allowed, true);
  assert.equal(result.requiresHumanApproval, true);
});

test("uses a stricter approval threshold for non-reversible products", () => {
  const result = evaluateOrder(
    policy,
    context({
      item: {
        ...item,
        pricePaise: 250_000,
        discountFloorBasisPoints: 0,
        isEasilyReversible: false,
      },
    }),
    { agreedUnitPricePaise: 250_000, quantity: 1 },
  );

  assert.equal(result.allowed, true);
  assert.equal(result.approvalThresholdPaise, 250_000);
  assert.equal(result.requiresHumanApproval, true);
});

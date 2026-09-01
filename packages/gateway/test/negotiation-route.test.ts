import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import {
  createAgentApiKey,
  getAgentApiKeyPrefix,
  hashAgentApiKey,
} from "../src/auth/api-keys.js";
import type { AgentRepository } from "../src/agents/repository.js";
import type { PolicyDataRepository } from "../src/policy/repository.js";

async function agentFixture() {
  const apiKey = createAgentApiKey();
  const agentRepository: AgentRepository = {
    findByApiKeyPrefix: async (prefix) =>
      prefix === getAgentApiKeyPrefix(apiKey)
        ? {
            id: "f11f809c-b8bb-4241-9c8d-aa3dd85ef357",
            merchantId: "c205261c-ff58-4c3e-bf10-35b4048cfe50",
            name: "Demo Buyer Agent",
            apiKeyHash: await hashAgentApiKey(apiKey),
            status: "active",
          }
        : null,
    close: async () => undefined,
  };

  return { apiKey, agentRepository };
}

function policyRepository(): PolicyDataRepository {
  return {
    getPolicy: async () => ({
      version: 1,
      maxTxnPaise: 500_000,
      dailySpendCapPaise: 1_500_000,
      approvalThresholdPaise: 500_000,
      allowedCategories: ["audio"],
      maxOrdersPerHour: 3,
    }),
    getCatalogItem: async () => ({
      sku: "EARBUDS-BLK-01",
      pricePaise: 185_000,
      discountFloorBasisPoints: 800,
      category: "audio",
      stock: 12,
      isActive: true,
      isEasilyReversible: false,
    }),
    getTodaySpendPaise: async () => 0,
    getOrdersInLastHour: async () => 0,
    createNegotiation: async () => undefined,
    close: async () => undefined,
  };
}

test("POST /v1/negotiate returns a policy-compliant structured offer", async (t) => {
  const { apiKey, agentRepository } = await agentFixture();
  const app = buildApp({ agentRepository, policyDataRepository: policyRepository() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/negotiate",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { sku: "EARBUDS-BLK-01", target_price_paise: 175_000 },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().allowed, true);
  assert.equal(response.json().offered_price_paise, 175_000);
});

test("POST /v1/negotiate blocks a price below the SKU floor", async (t) => {
  const { apiKey, agentRepository } = await agentFixture();
  const app = buildApp({ agentRepository, policyDataRepository: policyRepository() });
  t.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/v1/negotiate",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { sku: "EARBUDS-BLK-01", target_price_paise: 170_000 },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().allowed, false);
  assert.equal(response.json().policy_rule, "discount_floor");
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import {
  createAgentApiKey,
  getAgentApiKeyPrefix,
  hashAgentApiKey,
} from "../src/auth/api-keys.js";
import type { AgentRepository } from "../src/agents/repository.js";

test("GET /v1/agent/me accepts a valid active agent key", async (t) => {
  const apiKey = createAgentApiKey();
  const repository: AgentRepository = {
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
  const app = buildApp({ agentRepository: repository });
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/v1/agent/me",
    headers: { authorization: `Bearer ${apiKey}` },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().name, "Demo Buyer Agent");
  assert.equal("apiKeyHash" in response.json(), false);
});

test("GET /v1/agent/me rejects missing or invalid credentials", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/v1/agent/me" });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { error: "invalid_agent_credentials" });
});

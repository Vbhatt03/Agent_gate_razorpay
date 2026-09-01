import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentApiKey,
  getAgentApiKeyPrefix,
  hashAgentApiKey,
  verifyAgentApiKey,
} from "../src/auth/api-keys.js";

test("creates an API key with a stable lookup prefix", () => {
  const apiKey = createAgentApiKey();

  assert.match(apiKey, /^ag_[A-Za-z0-9_-]+$/);
  assert.equal(getAgentApiKeyPrefix(apiKey), apiKey.slice(0, 15));
});

test("stores API keys as Argon2id hashes and verifies the matching key", async () => {
  const apiKey = createAgentApiKey();
  const hash = await hashAgentApiKey(apiKey);

  assert.notEqual(hash, apiKey);
  assert.equal(await verifyAgentApiKey(apiKey, hash), true);
  assert.equal(await verifyAgentApiKey(createAgentApiKey(), hash), false);
});

test("rejects malformed API keys", async () => {
  assert.throws(() => getAgentApiKeyPrefix("not-an-agent-key"));
  assert.equal(await verifyAgentApiKey("not-an-agent-key", "not-a-hash"), false);
});

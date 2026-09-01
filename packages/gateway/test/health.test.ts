import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";

test("GET /healthz reports that the gateway is available", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/healthz" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().service, "agentgate-gateway");
  assert.deepEqual(response.json().status, "ok");
});

test("GET /v1/catalog reports an unavailable catalog without a repository", async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/v1/catalog" });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "catalog_unavailable" });
});

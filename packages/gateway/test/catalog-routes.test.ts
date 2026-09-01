import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/app.js";
import type { CatalogRepository } from "../src/catalog/repository.js";

const product = {
  sku: "EARBUDS-BLK-01",
  name: "Pulse Wireless Earbuds",
  description: "Compact wireless earbuds with a charging case.",
  pricePaise: 185_000,
  category: "audio",
  inStock: true,
};

function repository(): CatalogRepository {
  return {
    search: async () => [{ ...product }],
    findBySku: async (sku) => (sku === product.sku ? { ...product } : null),
    close: async () => undefined,
  };
}

test("GET /v1/catalog returns structured catalog results", async (t) => {
  const app = buildApp({ catalogRepository: repository() });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/v1/catalog?category=audio" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    results: [
      {
        sku: product.sku,
        name: product.name,
        pricePaise: product.pricePaise,
        category: product.category,
        inStock: true,
      },
    ],
  });
});

test("GET /v1/catalog/:sku returns a product without internal pricing policy", async (t) => {
  const app = buildApp({ catalogRepository: repository() });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: `/v1/catalog/${product.sku}` });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), product);
  assert.equal("discountFloorPct" in response.json(), false);
});

test("GET /v1/catalog/:sku returns 404 for an unknown SKU", async (t) => {
  const app = buildApp({ catalogRepository: repository() });
  t.after(() => app.close());

  const response = await app.inject({ method: "GET", url: "/v1/catalog/UNKNOWN" });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "product_not_found" });
});

import assert from "node:assert/strict";
import test from "node:test";

import { demoCatalog, demoPolicy } from "../src/demo-data.js";

test("demo data includes both allowed and blocked categories", () => {
  assert.ok(demoCatalog.some((item) => demoPolicy.allowedCategories.includes(item.category)));
  assert.ok(demoCatalog.some((item) => !demoPolicy.allowedCategories.includes(item.category)));
});

test("demo data uses integer paise within the configured transaction cap", () => {
  for (const item of demoCatalog) {
    assert.equal(Number.isInteger(item.pricePaise), true);
    assert.ok(item.pricePaise > 0);
    assert.ok(item.pricePaise <= demoPolicy.maxTxnPaise);
  }
});

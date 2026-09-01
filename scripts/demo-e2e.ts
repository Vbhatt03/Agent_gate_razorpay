#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
config({ path: ".env" });

console.log("[DEBUG] API key:", process.env.DEMO_AGENT_API_KEY ? "loaded (" + process.env.DEMO_AGENT_API_KEY.slice(0, 10) + "...)" : "MISSING");
console.log("[DEBUG] BASE:", process.env.AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001");

const BASE = process.env.AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
const AGENT_API_KEY = process.env.DEMO_AGENT_API_KEY ?? "";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function api(path: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(AGENT_API_KEY ? { Authorization: `Bearer ${AGENT_API_KEY}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log("\n🔵 Journey A — Catalog discovery");
  console.log("─".repeat(50));

  const catalogRes = await api("/v1/catalog");
  assert(catalogRes.status === 200, "Catalog endpoint responds");
  assert(Array.isArray(catalogRes.data.results), "Catalog returns results array");
  const items = catalogRes.data.results;
  assert(items.length > 0, `Catalog has ${items.length} item(s)`);
  const sku = items[0].sku;
  console.log(`  Using SKU: ${sku} (${items[0].name})`);
  const reqBody = { sku, target_price_paise: 47405}; // target price slightly below listed price
  console.log("[DEBUG] Negotiate request:", JSON.stringify(reqBody));
  
  const negotiateRes = await api("/v1/negotiate", {
    method: "POST",
    body: JSON.stringify(reqBody),
  });
  console.log("[DEBUG] Negotiate response:", JSON.stringify(negotiateRes));
  console.log("\n🔵 Journey B — Negotiate & create order (success)");
  console.log("─".repeat(50));


  assert(negotiateRes.status === 200, "Negotiate responds 200");
  assert(negotiateRes.data.allowed === true, "Negotiation allowed");
  const offeredPrice = negotiateRes.data.offered_price_paise;
  console.log(`  Offered price: ₹${(offeredPrice / 100).toFixed(2)}`);

  const orderRes = await api("/v1/orders", {
    method: "POST",
    body: JSON.stringify({
      sku,
      quantity: 1,
      agreed_price_paise: offeredPrice,
      idempotency_key: `demo-${randomUUID().slice(0, 8)}`,
    }),
  });
  assert(orderRes.status === 200, "Order created");
  assert(["created", "awaiting_approval"].includes(orderRes.data.status), `Order status: ${orderRes.data.status}`);

  if (orderRes.data.status === "created") {
    assert(orderRes.data.payment_link, "Payment link returned");
    console.log(`  Payment link: ${orderRes.data.payment_link}`);
  } else {
    console.log(`  Order awaiting approval (order_id: ${orderRes.data.order_id})`);
  }

  console.log("\n🔵 Journey C1 — Policy block (over cap)");
  console.log("─".repeat(50));

  const highPrice = 20_000_00; // ₹20,000 — way over daily cap
  const blockRes = await api("/v1/negotiate", {
    method: "POST",
    body: JSON.stringify({ sku, target_price_paise: highPrice }),
  });
  assert(blockRes.status === 200, "Blocked negotiation responds 200");
  assert(blockRes.data.allowed === false, "Negotiation blocked");
  console.log(`  Blocked: ${blockRes.data.reason}`);
  assert(blockRes.data.policy_rule, "Policy rule returned");

  console.log("\n🔵 Journey C2 — Order block (exceeds max txn)");
  console.log("─".repeat(50));

  const orderBlockRes = await api("/v1/orders", {
    method: "POST",
    body: JSON.stringify({
      sku,
      quantity: 1,
      agreed_price_paise: 10_000_00, // ₹10,000 — over max_txn (₹5,000)
      idempotency_key: `demo-block-${randomUUID().slice(0, 8)}`,
    }),
  });
  assert(orderBlockRes.status === 200, "Blocked order responds 200");
  assert(orderBlockRes.data.status === "policy_blocked", `Order blocked: ${orderBlockRes.data.status}`);
  console.log(`  Blocked: ${orderBlockRes.data.reason}`);
  assert(orderBlockRes.data.policy_rule, "Policy rule returned");

  console.log("\n✅ All journeys passed!\n");
}

run().catch((err) => {
  console.error("\n💥 Script error:", err);
  process.exit(1);
});
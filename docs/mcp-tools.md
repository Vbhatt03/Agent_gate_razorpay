# MCP Tools

AgentGate exposes 5 tools via the Model Context Protocol (MCP) over HTTP on port 3002.

## Transport

- **Protocol**: MCP Streamable HTTP (stateless)
- **Base URL**: `http://127.0.0.1:3002/mcp`
- **Content-Type**: `application/json`
- **Accept**: `application/json, text/event-stream`

## Initialize

Before calling tools, send an `initialize` request:

```json
{
  "jsonrpc": "2.0",
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "agent-client", "version": "0.1.0" }
  },
  "id": "0"
}
```

---

## Tools

### `search_catalog`

Search the merchant product catalog.

**Input:**
```json
{
  "query": "wireless headphones",
  "max_price_paise": 50000,
  "category": "electronics"
}
```

All fields optional. Returns matching products with SKU, name, price, category, and stock status.

---

### `get_product`

Get detailed information about a specific product.

**Input:**
```json
{ "sku": "SKU-001" }
```

Returns full product details including price, category, stock, and reversibility flag.

---

### `negotiate_offer`

Negotiate a price for a product. The policy engine evaluates the request against the merchant's configured rules (spend caps, category restrictions, discount floors). If within bounds, returns a counter-offer at or above the merchant's minimum acceptable price.

**Input:**
```json
{
  "sku": "SKU-001",
  "target_price_paise": 35000
}
```

**Response (allowed):**
```json
{
  "allowed": true,
  "offered_price_paise": 37500,
  "correlation_id": "..."
}
```

**Response (blocked):**
```json
{
  "allowed": false,
  "reason": "Blocked by policy rule: discount_exceeds_floor"
}
```

---

### `create_order`

Create an order for a product. Policy-gated — blocked if the agent's spend or rate limits are exceeded.

**Input:**
```json
{
  "sku": "SKU-001",
  "quantity": 2,
  "agreed_price_paise": 37500
}
```

**Response:**
```json
{
  "status": "created",
  "razorpay_order_id": "order_...",
  "payment_link": "https://razorpay.com/..."
}
```

Orders above the merchant's `approval_threshold_paise` return `status: "awaiting_approval"` and require human sign-off via the dashboard.

---

### `get_order_status`

Get the current status of an order.

**Input:**
```json
{ "order_id": "550e8400-e29b-41d4-a716-446655440000" }
```

**Response:**
```json
{
  "order": {
    "id": "...",
    "status": "paid",
    "amount_paise": 75000,
    "sku": "SKU-001",
    "razorpay_order_id": "order_...",
    "payment_link": "..."
  }
}
```

---

## Status Values

| Status | Description |
|--------|-------------|
| `pending` | Order created, awaiting payment |
| `awaiting_approval` | Above approval threshold, human review needed |
| `policy_blocked` | Rejected by policy engine |
| `paid` | Payment confirmed via Razorpay webhook |
| `failed` | Payment failed |
| `cancelled` | Order cancelled or rejected |

# Architecture

## Overview

AgentGate is a TypeScript monorepo with 3 primary components:

```
apps/dashboard/     Next.js dashboard (port 3000)
packages/gateway/    Fastify REST + MCP server (port 3001 + 3002)
packages/db/         PostgreSQL schema (drizzle)
packages/shared/    Zod schemas, helpers
packages/razorpay-adapter/  Razorpay API wrapper
```

## Request Flow

```
Agent → MCP (port 3002) → Gateway (port 3001) → Policy Engine → DB
                        ↘ Groq LLM (negotiation)
                        ↘ Razorpay (payment link)
                        ↘ Audit Log
```

### 1. MCP Tool Request
Agents connect to the MCP server on port 3002 via Streamable HTTP. The server validates the tool call and routes it to the appropriate handler in `src/mcp/server.ts`.

### 2. Policy Engine
Every negotiation and order request passes through `src/policy/engine.ts`. The engine evaluates:

- **Discount floor**: Target price must be within the merchant's configured `discount_floor_pct` of catalog price
- **Spend caps**: Agent's daily spend + order amount must not exceed `daily_spend_cap_paise`
- **Rate limits**: Agent cannot exceed `max_orders_per_hour`
- **Category restrictions**: Product category must be in `allowed_categories`
- **Trust score**: Agents below 0.3 trust score face additional restrictions
- **Human approval**: Orders above `approval_threshold_paise` require manual sign-off

### 3. Negotiation Agent
When a negotiation is within policy bounds and `GROQ_API_KEY` is set, `src/negotiation/agent.ts` calls the Groq LLM (`openai/gpt-oss-120b`) to generate a counter-offer. The model receives:
- Product name and catalog price
- Merchant's minimum acceptable price (from policy)
- Agent's target price

### 4. Order Creation
Orders are recorded in PostgreSQL with policy checks embedded. If above the approval threshold, the order is set to `awaiting_approval` and appears in the dashboard. If below, a Razorpay payment link is generated.

### 5. Payment Webhook
Razorpay sends webhook events to `POST /webhooks/razorpay`. The gateway verifies the HMAC signature, idempotently records the event, and updates the order status (`pending` → `paid` or `failed`).

## Database Schema

### Key Tables

| Table | Purpose |
|-------|---------|
| `agents` | Agent registry with API key hash, merchant link, trust score |
| `merchants` | Merchant accounts with Razorpay credentials |
| `catalog_items` | Product catalog with discount floors |
| `policies` | Per-merchant policy configuration |
| `orders` | Order records with policy checks snapshot |
| `order_approvals` | Human approval queue |
| `negotiations` | Negotiation history |
| `audit_log` | Full event log for all actions |
| `webhook_events` | Idempotency guard for Razorpay webhooks |

## MCP Integration

The MCP server uses the `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` in stateless mode (`sessionIdGenerator: undefined`). This means every request is independent — no session state is maintained between calls.

Tools are registered via `McpServer.registerTool()` with Zod-validated input schemas.

## Dashboard

The Next.js dashboard polls the gateway's unauthenticated endpoints every 3-5 seconds for real-time updates. It provides:
- Live audit log with filtering
- Order list with status badges
- Order detail with payment link
- Agent registry view
- Pending approvals queue with approve/reject actions
- Active policy display

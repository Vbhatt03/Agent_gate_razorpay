# AgentGate

AgentGate is a test-mode gateway that lets external buyer agents discover a Razorpay merchant catalog, negotiate within merchant policy, and create auditable purchases.
# LIVE ON
https://agent-gate-razorpay.onrender.com
## Current milestone

The first milestone is deliberately small: a typed Fastify gateway with a health endpoint and an automated test. The database, Razorpay, MCP tools, and dashboard are introduced in later milestones after this baseline is stable.

## Prerequisites

- Node.js 22 LTS (the repository is pinned through `.nvmrc`)
- pnpm 10+

### Install Node 22 when `nvm` is not available

This project uses the shell-based [Node Version Manager](https://github.com/nvm-sh/nvm). A Python package can also provide an unrelated executable called `nvm`; it is not compatible with these commands.

If `nvm install` prints a Python traceback, install the official shell version, then open a new terminal:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
exec zsh -l
type nvm
```

The final command must report that `nvm` is a shell function, not a path inside a Python virtual environment. Then run:

```bash
nvm install
nvm use
node --version
```

The Node version should start with `v22` before continuing. The official nvm installer adds its loader to `~/.zshrc`; if your shell does not reload it, follow the [nvm Linux troubleshooting instructions](https://github.com/nvm-sh/nvm#troubleshooting-on-linux).

## Run locally

```bash
nvm install
nvm use
pnpm install
cp .env.example .env
pnpm typecheck
pnpm test
pnpm dev
```

In another terminal, verify the service:

```bash
curl http://127.0.0.1:3001/healthz
```

Expected response:

```json
{
  "service": "agentgate-gateway",
  "status": "ok",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## Commands

```bash
pnpm dev        # Run the gateway with file watching
pnpm typecheck  # Check TypeScript without emitting files
pnpm test       # Run automated tests
pnpm build      # Build all workspaces
pnpm lint       # Check formatting
pnpm format     # Apply formatting
```

## Database checkpoint

Create a Supabase project, then copy a Postgres connection string from **Connect** into `DATABASE_URL` in `.env`. Prefer the Session Pooler connection string if your local network is IPv4-only; the direct connection is appropriate for migrations when IPv6 is available. See the [Supabase connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres) for the distinction.

The password in the URI must be the **database password** chosen when the Supabase project was created. It is not the project URL, anon key, service-role key, or a Supabase account password. If the password is unknown, reset it in **Project Settings → Database** and then update the URI.

Supabase displays placeholders such as `[YOUR-PASSWORD]`. Replace the **entire placeholder**, including its square brackets. Do not leave `[` or `]` around the actual password. If the database password contains URL-reserved characters such as `@`, `:`, `/`, `?`, `#`, `[`, `]`, `!`, `*`, or `$`, percent-encode it before inserting it into the URI; otherwise Postgres will parse the URI incorrectly.

Generate and apply the initial migration, then load the deterministic demo merchant and catalog:

```bash
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

Run the commands in order. Do not run `db:seed` until `db:migrate` prints `Database migrations applied.`

The seed is intentionally safe to rerun for catalog items. It creates a merchant called `Northstar Audio`, a policy capped at ₹5,000 per transaction / ₹15,000 daily, three allowed products, and one disallowed-category product for policy-block demonstrations.

## Policy checkpoint

The gateway now contains a deterministic policy engine. It evaluates every allowed/block decision with plain TypeScript before an order service, LLM, or payment adapter can run. The test suite covers the PRD's transaction cap, daily cap, discount floor, category, velocity, and approval-threshold scenarios.

```bash
pnpm typecheck
pnpm test
```

## Catalog API checkpoint

The seeded catalog is now available through the gateway. The active merchant is selected through `MERCHANT_NAME` in `.env` (default: `Northstar Audio`), so the demo merchant is configuration rather than a hard-coded route value.

Start the gateway and try:

```bash
pnpm dev
curl http://127.0.0.1:3001/v1/catalog
curl http://127.0.0.1:3001/v1/catalog/EARBUDS-BLK-01
curl 'http://127.0.0.1:3001/v1/catalog?category=audio&max_price_paise=200000'
```

The product endpoint intentionally returns only buyer-safe product data. Internal discount floors and merchant policy fields stay server-side.

The gateway reads the root `.env` at startup. After changing `DATABASE_URL` or `MERCHANT_NAME`, stop and restart `pnpm dev` before retrying a catalog request.

## Agent-key checkpoint

Buyer agents will authenticate with an `ag_` API key. Only an Argon2id hash and a short lookup prefix are stored in Postgres; the plaintext key belongs only in your local `.env` and is never logged by the application.

Generate a key, add the resulting value to `DEMO_AGENT_API_KEY` in `.env`, then rerun the seed:

```bash
node -e "console.log('ag_' + require('node:crypto').randomBytes(24).toString('base64url'))"
pnpm install
pnpm db:seed
pnpm typecheck
pnpm test
```

Do not paste the generated key into chat, commit it, or add it to a client-side application. The next checkpoint will use it in an `Authorization: Bearer ...` header.

## Authentication and audit checkpoint

The gateway now validates active agent keys from Postgres and records catalog reads plus successful agent authentication in `audit_log`. Restart the gateway after seeding, then verify the seeded agent without exposing its key:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
curl -H "Authorization: Bearer $DEMO_AGENT_API_KEY" http://127.0.0.1:3001/v1/agent/me
```

If your shell has not loaded `.env`, run `source .env` first or paste the value only into that terminal command. Do not place an agent key in a browser URL.

## Negotiation checkpoint

The protected negotiation endpoint loads the authenticated agent's merchant policy and SKU data from Postgres, checks it in deterministic code, then stores both the negotiation and an audit event. The returned offer is currently a deterministic policy-compliant value; the constrained Groq negotiation model will replace only the offer-selection step later, never the policy gate.

```bash
source .env
curl -X POST http://127.0.0.1:3001/v1/negotiate \
  -H "Authorization: Bearer $DEMO_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sku":"EARBUDS-BLK-01","target_price_paise":175000}'

# Demonstrates C1: blocked before any payment integration is called.
curl -X POST http://127.0.0.1:3001/v1/negotiate \
  -H "Authorization: Bearer $DEMO_AGENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"sku":"EARBUDS-BLK-01","target_price_paise":170000}'
```

## Current Build

### What's running

- **Gateway**: Fastify on `http://127.0.0.1:3001`
- **MCP Server**: Streamable HTTP on `http://127.0.0.1:3002/mcp`
- **Dashboard**: Next.js on `http://localhost:3000`

### Start everything

```bash
pnpm install
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev        # starts gateway + MCP in one terminal
cd apps/dashboard && pnpm dev   # in another terminal
```

### MCP tools

Connect any MCP client to `http://127.0.0.1:3002/mcp`. Available tools:

| Tool | Description |
|------|-------------|
| `search_catalog` | Search products by query, price, category |
| `get_product` | Get product details by SKU |
| `negotiate_offer` | Negotiate a price (policy-gated) |
| `create_order` | Create an order (policy-gated) |
| `get_order_status` | Check order status |

### Dashboard

| Page | Description |
|------|-------------|
| `/` | Live audit log with auto-refresh |
| `/orders` | All orders with status badges |
| `/orders/[id]` | Order detail + payment link |
| `/approvals` | Pending human approvals with approve/reject |
| `/agents` | Agent registry |
| `/policy` | Active policy rules |

### Human approval flow

Orders above `approval_threshold_paise` enter the approval queue. Approve or reject from the dashboard at `/approvals`. Approved orders proceed to payment; rejected orders are cancelled.

### Environment variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `MERCHANT_NAME` | Merchant to use (default: Northstar Audio) |
| `GROQ_API_KEY` | Enables LLM negotiation (optional) |
| `RAZORPAY_KEY_ID` | Razorpay key for payment links |
| `RAZORPAY_KEY_SECRET` | Razorpay secret |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification |

## Project references

- [Product requirements](./PRD.md)
- [Technical implementation plan](./plan.md)

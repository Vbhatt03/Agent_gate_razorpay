import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AgentRepository, StoredAgent } from "../agents/repository.js";
import type { PolicyDataRepository } from "../policy/repository.js";
import { evaluateNegotiation } from "../policy/engine.js";

export type McpDeps = {
  catalogRepository?: {
    search(opts: { query?: string; maxPricePaise?: number; category?: string }): Promise<Array<{ sku: string; name: string; pricePaise: number; category: string; inStock: boolean }>>;
    findBySku(sku: string): Promise<unknown>;
  };
  agentRepository?: AgentRepository;
  policyDataRepository?: PolicyDataRepository;
  orderService?: {
    createOrder(params: {
      correlationId: string;
      sku: string;
      quantity: number;
      agreedPricePaise: number;
      idempotencyKey: string;
      agent: StoredAgent;
    }): Promise<unknown>;
    getOrderById(orderId: string): Promise<unknown>;
  };
  auditRepository?: {
    record(params: {
      correlationId: string;
      merchantId?: string;
      agentId?: string;
      entityType: string;
      entityId?: string;
      action: string;
      inputJson?: unknown;
      outputJson?: unknown;
      policyResult?: unknown;
    }): Promise<void>;
  };
};

async function resolveMcpAgent(agentRepository?: AgentRepository): Promise<StoredAgent | null> {
  if (!agentRepository) return null;
  const agents = await agentRepository.listAll();
  return agents.find((a) => a.status === "active") ?? agents[0] ?? null;
}

export function createMcpServer(deps: McpDeps) {
  const server = new McpServer({ name: "AgentGate", version: "0.1.0" });

  server.registerTool(
    "search_catalog",
    {
      title: "Search Catalog",
      description: "Search the merchant catalog by query, max price, or category.",
      inputSchema: {
        query: z.string().optional().describe("Search query"),
        max_price_paise: z.number().optional().describe("Maximum price in paise"),
        category: z.string().optional().describe("Category filter"),
      },
    },
    async ({ query, max_price_paise, category }) => {
      if (!deps.catalogRepository) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "catalog unavailable" }) }], isError: true as const };
      }
      const results = await deps.catalogRepository!.search({
        query,
        maxPricePaise: max_price_paise,
        category,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get Product",
      description: "Get detailed information about a specific product by SKU.",
      inputSchema: {
        sku: z.string().describe("Product SKU"),
      },
    },
    async ({ sku }) => {
      if (!deps.catalogRepository) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "catalog unavailable" }) }], isError: true as const };
      }
      const product = await deps.catalogRepository!.findBySku(sku);
      return {
        content: [{ type: "text", text: JSON.stringify(product, null, 2) }],
      };
    },
  );

  server.registerTool(
    "negotiate_offer",
    {
      title: "Negotiate Offer",
      description: "Negotiate a price for a product. Returns an offer within the merchant's allowed price range.",
      inputSchema: {
        sku: z.string().describe("Product SKU"),
        target_price_paise: z.number().int().positive().describe("Target price in paise"),
      },
    },
    async ({ sku, target_price_paise }) => {
      const repo = deps.policyDataRepository;
      if (!repo) {
        return { content: [{ type: "text", text: JSON.stringify({ allowed: false, error: "policy unavailable" }) }], isError: true as const };
      }
      const agent = await resolveMcpAgent(deps.agentRepository);
      if (!agent) {
        return { content: [{ type: "text", text: JSON.stringify({ allowed: false, error: "no agent available" }) }], isError: true as const };
      }
      const [policy, item, todaySpendPaise, ordersInLastHour] = await Promise.all([
        repo.getPolicy(agent.merchantId),
        repo.getCatalogItem(agent.merchantId, sku),
        repo.getTodaySpendPaise(agent.id),
        repo.getOrdersInLastHour(agent.id),
      ]);
      if (!policy || !item) {
        return { content: [{ type: "text", text: JSON.stringify({ allowed: false, reason: "Product or policy not found" }) }], isError: true as const };
      }
      const decision = evaluateNegotiation(
        policy,
        { agentStatus: agent.status, item, todaySpendPaise, ordersInLastHour },
        target_price_paise,
      );
      if (!decision.allowed) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              allowed: false,
              reason: `Blocked by policy rule: ${decision.reason}.`,
              policy_rule: decision.reason,
              minimum_offer_paise: decision.minimumOfferPaise,
            }, null, 2),
          }],
          isError: true,
        };
      }
      const offeredPricePaise = Math.max(target_price_paise, decision.minimumOfferPaise);
      const correlationId = randomUUID();
      try {
        await repo.createNegotiation({
          agentId: agent.id,
          sku: item.sku,
          requestedPricePaise: target_price_paise,
          offeredPricePaise,
          reasonText: decision.reason ?? "Offer within the merchant's allowed price bounds.",
          policyResult: decision,
        });
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              allowed: true,
              offered_price_paise: offeredPricePaise,
              minimum_offer_paise: decision.minimumOfferPaise,
              correlation_id: correlationId,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ allowed: false, reason: String(err) }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "create_order",
    {
      title: "Create Order",
      description: "Create an order for a product. Policy-engine-gated — blocked if limits are exceeded.",
      inputSchema: {
        sku: z.string().describe("Product SKU"),
        quantity: z.number().int().positive().describe("Quantity"),
        agreed_price_paise: z.number().int().positive().describe("Agreed price per unit in paise"),
      },
    },
    async ({ sku, quantity, agreed_price_paise }) => {
      if (!deps.orderService) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "error", reason: "order service unavailable" }) }], isError: true as const };
      }
      const agent = await resolveMcpAgent(deps.agentRepository);
      if (!agent) {
        return { content: [{ type: "text", text: JSON.stringify({ status: "error", reason: "no agent available" }) }], isError: true as const };
      }
      const correlationId = randomUUID();
      try {
        const result = (await deps.orderService!.createOrder({
          correlationId,
          sku,
          quantity,
          agreedPricePaise: agreed_price_paise,
          idempotencyKey: `mcp-${correlationId}`,
          agent,
        })) as Record<string, unknown>;
        return {
          content: [{ type: "text", text: JSON.stringify({ ...result, order_id: correlationId }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "error", reason: String(err) }, null, 2) }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_order_status",
    {
      title: "Get Order Status",
      description: "Get the current status of an order.",
      inputSchema: {
        order_id: z.string().uuid().describe("Order UUID"),
      },
    },
    async ({ order_id }) => {
      if (!deps.orderService) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "order service unavailable" }) }], isError: true as const };
      }
      const order = await deps.orderService!.getOrderById(order_id);
      return {
        content: [{ type: "text", text: JSON.stringify(order, null, 2) }],
      };
    },
  );

  return server;
}

export function createMcpTransport() {
  return new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
  });
}
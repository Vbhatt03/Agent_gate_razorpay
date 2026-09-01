import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

type McpDeps = {
  catalogRepository?: {
    search(opts: { query?: string; maxPricePaise?: number; category?: string }): Promise<Array<{ sku: string; name: string; pricePaise: number; category: string; inStock: boolean }>>;
    findBySku(sku: string): Promise<unknown>;
  };
  agentRepository?: unknown;
  policyDataRepository?: {
    getPolicy(merchantId: string): Promise<unknown>;
    getCatalogItem(merchantId: string, sku: string): Promise<unknown>;
    getTodaySpendPaise(agentId: string): Promise<number>;
    getOrdersInLastHour(agentId: string): Promise<number>;
    createNegotiation(input: {
      agentId: string;
      sku: string;
      requestedPricePaise: number;
      offeredPricePaise: number | null;
      reasonText: string | null;
      policyResult: object;
    }): Promise<void>;
  };
  orderService?: {
    createOrder(params: {
      correlationId: string;
      sku: string;
      quantity: number;
      agreedPricePaise: number;
      idempotencyKey: string;
      agent: unknown;
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

export function createExpressMcpApp(deps: McpDeps) {
  const app = createMcpExpressApp();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = createMcpServer(deps);
  mcpServer.connect(transport);

  const handleMcpRequest = async (req: unknown, res: unknown, body?: unknown) => {
    try {
      await transport.handleRequest(req as any, res as any, body);
    } catch (err) {
      console.error("[MCP] handleRequest error:", err);
      const response = res as { headersSent?: boolean; end: (data?: unknown) => void; statusCode?: number; statusMessage?: string };
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end(JSON.stringify({ error: "internal_error", message: String(err) }));
      }
    }
  };

  app.post("/mcp", (req, res) => handleMcpRequest(req, res, req.body));
  app.get("/mcp", (req, res) => handleMcpRequest(req, res));
  app.delete("/mcp", (req, res) => handleMcpRequest(req, res));
  return app;
}

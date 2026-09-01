import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createMcpServer, type McpDeps } from "./server.js";

export function createExpressMcpApp(deps: McpDeps) {
  const app = createMcpExpressApp();

  const handle = async (req: IncomingMessage, res: ServerResponse, body?: unknown) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
    });
    const server = createMcpServer(deps);
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("[MCP] handleRequest error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: "internal_error", message: String(err) }));
      }
    }
  };

  app.post("/mcp", (req, res) => void handle(req, res, req.body));
  app.get("/mcp", (req, res) => void handle(req, res));
  app.delete("/mcp", (req, res) => void handle(req, res));
  return app;
}
/**
 * AgentGate demo buyer agent.
 *
 * This is a real MCP *client* — it connects to the gateway's MCP server over
 * Streamable HTTP (the same transport any third-party agent, ChatGPT plugin,
 * or ACP-style buyer would use), lets Groq's model decide which tools to call
 * and in what order, and prints a running transcript so you can narrate it
 * live during the demo.
 *
 * This is deliberately separate from scripts/demo-e2e.ts. That script proves
 * the REST + policy-engine path works. This script proves the MCP surface
 * itself is real and reachable by an arbitrary client — the actual claim in
 * the pitch (PRD §2/§18).
 *
 * Usage:
 *   pnpm demo:buyer-agent -- --budget 200000 --want "wireless earbuds"
 *
 * Requires (in the root .env, already loaded by dotenv below):
 *   GROQ_API_KEY
 *   AGENTGATE_MCP_URL   (defaults to http://127.0.0.1:3002/mcp)
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import Groq from "groq-sdk";

type Args = {
  budgetPaise: number;
  want: string;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const idx = argv.indexOf(flag);
    return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : fallback;
  };
  return {
    budgetPaise: Number(get("--budget", "200000")), // default: Rs.2,000
    want: get("--want", "wireless earbuds"),
  };
}

// --- tiny console helpers, purely for a readable live-demo transcript ---
const log = {
  step: (msg: string) => console.log(`\n\x1b[36m▶ ${msg}\x1b[0m`),
  tool: (name: string, input: unknown) =>
    console.log(`  \x1b[33m→ calling tool: ${name}\x1b[0m ${JSON.stringify(input)}`),
  result: (text: string) => console.log(`  \x1b[32m← result:\x1b[0m ${text}`),
  agent: (msg: string) => console.log(`\n\x1b[35m🤖 agent:\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\n\x1b[31m⚠ ${msg}\x1b[0m`),
};

async function main() {
  const { budgetPaise, want } = parseArgs();
  const mcpUrl = process.env.AGENTGATE_MCP_URL ?? "http://127.0.0.1:3002/mcp";
  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    log.warn("GROQ_API_KEY is not set — add it to the root .env before running this script.");
    process.exit(1);
  }

  log.step(`Connecting MCP client to ${mcpUrl}`);
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  const client = new Client({ name: "agentgate-demo-buyer", version: "0.1.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  log.step(`Connected. Gateway exposes ${tools.length} MCP tools: ${tools.map((t) => t.name).join(", ")}`);

  // Convert the MCP tool list into the shape Groq's tool-calling API expects.
  // This is the actual proof point: the agent doesn't know anything about
  // AgentGate's internals ahead of time, it only knows what the MCP server
  // told it during listTools().
  const groqTools = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));

  const groq = new Groq({ apiKey: groqApiKey });

  const systemPrompt = [
    `You are shopping on behalf of a human buyer.`,
    `Budget: ${budgetPaise} paise (do not exceed this across the whole order).`,
    `Goal: buy "${want}" from this merchant if a suitable product exists.`,
    `Use the available tools: search first, then negotiate a fair price if you can,`,
    `then create the order. If a tool call is blocked or returns an error, explain`,
    `why in one sentence and stop — do not retry the same call unmodified.`,
    `Always call get_order_status at the end to confirm the final state.`,
  ].join(" ");

  const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: unknown }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Find and buy: ${want}` },
  ];

  log.step(`Handing control to the agent (budget: Rs.${(budgetPaise / 100).toFixed(2)}, want: "${want}")`);

  // Simple bounded tool-calling loop: ask the model, execute any tool calls
  // it requests via the real MCP connection, feed results back, repeat.
  const MAX_TURNS = 8;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const completion = await groq.chat.completions.create({
      model: "openai/gpt-oss-120b",
      messages: messages as never,
      tools: groqTools,
      tool_choice: "auto",
    });

    const choice = completion.choices[0];
    const msg = choice.message;

    if (msg.content) {
      log.agent(msg.content);
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      // Model is done — no more tools to call.
      messages.push(msg as never);
      break;
    }

    messages.push(msg as never);

    for (const call of msg.tool_calls) {
      const toolName = call.function.name;
      const toolArgs = JSON.parse(call.function.arguments || "{}");

      log.tool(toolName, toolArgs);

      const mcpResult = await client.callTool({ name: toolName, arguments: toolArgs });
      const resultText = Array.isArray(mcpResult.content)
        ? mcpResult.content.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text : "")).join("\n")
        : JSON.stringify(mcpResult);

      log.result(resultText.slice(0, 500));

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: resultText,
      });
    }
  }

  log.step("Agent run complete.");
  await client.close();
}

main().catch((err) => {
  console.error("\nBuyer agent crashed:", err);
  process.exit(1);
});
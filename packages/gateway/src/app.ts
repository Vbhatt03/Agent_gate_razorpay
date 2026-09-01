import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  CatalogSearchInputSchema,
  GetProductInputSchema,
  NegotiateOfferInputSchema,
  CreateOrderInputSchema,
  GetOrderStatusInputSchema,
} from "@agentgate/shared";
import { paiseToDisplayString } from "@agentgate/shared";

import { runNegotiationAgent } from "./negotiation/agent.js";
import { evaluateNegotiation } from "./policy/engine.js";

import type { OrderService } from "./orders/service.js";
import type { AgentRepository, StoredAgent } from "./agents/repository.js";
import { getAgentApiKeyPrefix, verifyAgentApiKey } from "./auth/api-keys.js";
import type { AuditRepository } from "./audit/repository.js";
import type { CatalogRepository } from "./catalog/repository.js";
import type { PolicyDataRepository } from "./policy/repository.js";

const groqApiKey = process.env.GROQ_API_KEY ?? "";

const catalogSearchSchema = z.object({
  query: z.string().trim().min(1).max(100).optional(),
  max_price_paise: z.coerce.number().int().positive().optional(),
  category: z.string().trim().min(1).max(50).optional(),
});

const negotiationSchema = z.object({
  sku: z.string().trim().min(1).max(100),
  target_price_paise: z.number().int().positive(),
});

type AppDependencies = {
  catalogRepository?: CatalogRepository;
  agentRepository?: AgentRepository;
  auditRepository?: AuditRepository;
  policyDataRepository?: PolicyDataRepository;
  orderService?: OrderService;
};

async function authenticateAgent(
  authorization: string | undefined,
  agentRepository: AgentRepository | undefined,
): Promise<StoredAgent | null> {
  if (!agentRepository || !authorization?.startsWith("Bearer ")) {
    return null;
  }

  const apiKey = authorization.slice("Bearer ".length).trim();

  try {
    const agent = await agentRepository.findByApiKeyPrefix(getAgentApiKeyPrefix(apiKey));
    if (!agent || agent.status !== "active") {
      return null;
    }

    return (await verifyAgentApiKey(apiKey, agent.apiKeyHash)) ? agent : null;
  } catch {
    return null;
  }
}

export function buildApp(dependencies: AppDependencies = {}) {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "warn",
    },
    requestTimeout: 15_000,
    bodyLimit: 1_048_576,
    genReqId: () => randomUUID(),
  });

  app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Accept"],
    credentials: true,
  });

  app.get("/healthz", async () => {
    return {
      service: "agentgate-gateway",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/v1/audit", async (request) => {
    if (!dependencies.auditRepository) {
      return { entries: [] };
    }
    const q = request.query as { limit?: string };
    const limit = Number(q.limit ?? 50);
    const entries = await dependencies.auditRepository.getRecentEntries(limit);
    return { entries };
  });

  app.get("/v1/catalog", async (request, reply) => {
    if (!dependencies.catalogRepository) {
      return reply.code(503).send({ error: "catalog_unavailable" });
    }

    const parsed = catalogSearchSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_query", details: parsed.error.flatten() });
    }

    const results = await dependencies.catalogRepository.search({
      query: parsed.data.query,
      maxPricePaise: parsed.data.max_price_paise,
      category: parsed.data.category,
    });

    await dependencies.auditRepository?.record({
      correlationId: request.id,
      entityType: "catalog",
      action: "catalog.search",
      inputJson: parsed.data,
      outputJson: { result_count: results.length },
    });

    return {
      results: results.map(({ sku, name, pricePaise, category, inStock }) => ({
        sku,
        name,
        pricePaise,
        category,
        inStock,
      })),
    };
  });

  app.get("/v1/catalog/:sku", async (request, reply) => {
    if (!dependencies.catalogRepository) {
      return reply.code(503).send({ error: "catalog_unavailable" });
    }

    const parsed = z.object({ sku: z.string().trim().min(1).max(100) }).safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_sku" });
    }

    const product = await dependencies.catalogRepository.findBySku(parsed.data.sku);
    if (!product) {
      return reply.code(404).send({ error: "product_not_found" });
    }

    await dependencies.auditRepository?.record({
      correlationId: request.id,
      entityType: "catalog",
      entityId: product.sku,
      action: "catalog.get_product",
      inputJson: { sku: product.sku },
      outputJson: { found: true },
    });

    return product;
  });

  app.get("/v1/agent/me", async (request, reply) => {
    const agent = await authenticateAgent(request.headers.authorization, dependencies.agentRepository);
    if (!agent) {
      return reply.code(401).send({ error: "invalid_agent_credentials" });
    }

    await dependencies.auditRepository?.record({
      correlationId: request.id,
      merchantId: agent.merchantId,
      agentId: agent.id,
      entityType: "agent",
      entityId: agent.id,
      action: "agent.authenticate",
      outputJson: { authenticated: true },
    });

    return {
      id: agent.id,
      name: agent.name,
      merchantId: agent.merchantId,
      status: agent.status,
    };
  });

  app.post("/v1/negotiate", async (request, reply) => {
    const agent = await authenticateAgent(request.headers.authorization, dependencies.agentRepository);
    if (!agent) {
      return reply.code(401).send({ error: "invalid_agent_credentials" });
    }
    if (!dependencies.policyDataRepository) {
      return reply.code(503).send({ error: "negotiation_unavailable" });
    }

    const parsed = negotiationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_negotiation_request", details: parsed.error.flatten() });
    }

    const [policy, item, todaySpendPaise, ordersInLastHour] = await Promise.all([
      dependencies.policyDataRepository.getPolicy(agent.merchantId),
      dependencies.policyDataRepository.getCatalogItem(agent.merchantId, parsed.data.sku),
      dependencies.policyDataRepository.getTodaySpendPaise(agent.id),
      dependencies.policyDataRepository.getOrdersInLastHour(agent.id),
    ]);

    if (!policy || !item) {
      await dependencies.auditRepository?.record({
        correlationId: request.id,
        merchantId: agent.merchantId,
        agentId: agent.id,
        entityType: "negotiation",
        action: "negotiation.requested",
        inputJson: parsed.data,
        outputJson: { found: false },
      });
      return reply.code(404).send({ error: "product_not_found" });
    }

    const decision = evaluateNegotiation(
      policy,
      { agentStatus: agent.status, item, todaySpendPaise, ordersInLastHour },
      parsed.data.target_price_paise,
    );

    let offeredPricePaise: number | null = null;
    let reason: string;

    if (decision.allowed) {
      if (groqApiKey) {
        const negotiationResult = await runNegotiationAgent({
          itemName: item.name ?? item.sku,
          itemSku: item.sku,
          listedPricePaise: item.pricePaise,
          minimumPricePaise: decision.minimumOfferPaise,
          targetPricePaise: parsed.data.target_price_paise,
          groqApiKey,
        });

        if (negotiationResult.success) {
          offeredPricePaise = negotiationResult.offeredPricePaise;
          reason = negotiationResult.reason;
        } else {
          offeredPricePaise = decision.minimumOfferPaise;
          reason = `Negotiation agent error: ${negotiationResult.error}`;
        }
      } else {
        offeredPricePaise = Math.max(parsed.data.target_price_paise, decision.minimumOfferPaise);
        reason = "Offer is within the merchant's configured price bounds.";
      }
    } else {
      reason = `Blocked by policy rule: ${decision.reason}.`;
    }

    await dependencies.policyDataRepository.createNegotiation({
      agentId: agent.id,
      sku: item.sku,
      requestedPricePaise: parsed.data.target_price_paise,
      offeredPricePaise,
      reasonText: reason,
      policyResult: decision,
    });

    await dependencies.auditRepository?.record({
      correlationId: request.id,
      merchantId: agent.merchantId,
      agentId: agent.id,
      entityType: "negotiation",
      entityId: item.sku,
      action: decision.allowed ? "negotiation.approved" : "negotiation.blocked",
      inputJson: parsed.data,
      outputJson: decision.allowed
        ? { allowed: true, offered_price_paise: offeredPricePaise }
        : { allowed: false, policy_rule: decision.reason },
      policyResult: decision,
    });

    if (!decision.allowed) {
      return {
        allowed: false,
        reason,
        policy_rule: decision.reason,
        correlation_id: request.id,
      };
    }

    return {
      allowed: true,
      offered_price_paise: offeredPricePaise,
      reason,
      correlation_id: request.id,
    };
  });

  app.post("/v1/orders", async (request, reply) => {
    const agent = await authenticateAgent(request.headers.authorization, dependencies.agentRepository);
    if (!agent) {
      return reply.code(401).send({ error: "invalid_agent_credentials" });
    }
    if (!dependencies.orderService) {
      return reply.code(503).send({ error: "order_service_unavailable" });
    }

    const body = request.body as Record<string, unknown> | undefined;
    const parsed = CreateOrderInputSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_order_request", details: parsed.error.flatten() });
    }

    const idempotencyKey = (body?.idempotency_key as string | undefined) ?? randomUUID();

    const result = await dependencies.orderService.createOrder({
      correlationId: request.id,
      sku: parsed.data.sku,
      quantity: parsed.data.quantity,
      agreedPricePaise: parsed.data.agreed_price_paise,
      idempotencyKey,
      agent,
    });

    return result;
  });

  app.get("/v1/orders", async (request, reply) => {
    if (!dependencies.orderService) {
      return { orders: [] };
    }
    const q = request.query as { limit?: string };
    const limit = Number(q.limit ?? 50);
    const orders = await dependencies.orderService.listRecentOrders(limit);
    return { orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      amount_paise: o.amount_paise,
      quantity: o.quantity,
      sku: o.sku,
      catalog_name: o.catalog_name,
      created_at: o.created_at?.toISOString(),
    })) };
  });

  app.get("/v1/orders/:order_id", async (request, reply) => {
    const agent = await authenticateAgent(request.headers.authorization, dependencies.agentRepository);
    if (!agent) {
      return reply.code(401).send({ error: "invalid_agent_credentials" });
    }
    if (!dependencies.orderService) {
      return reply.code(503).send({ error: "order_service_unavailable" });
    }

    const parsed = GetOrderStatusInputSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_order_id" });
    }

    const order = await dependencies.orderService.getOrderById(parsed.data.order_id);
    if (!order) {
      return reply.code(404).send({ error: "order_not_found" });
    }

    const baseUrl = process.env.AGENTGATE_BASE_URL ?? "";
    return {
      order: {
        id: order.id,
        status: order.status,
        amount_paise: order.amount_paise,
        sku: order.sku,
        quantity: order.quantity,
        razorpay_order_id: order.razorpay_order_id,
        payment_link: order.payment_link,
        created_at: order.created_at?.toISOString(),
        updated_at: order.updated_at?.toISOString(),
      },
      audit_trail_url: `${baseUrl}/v1/audit?order_id=${order.id}`,
    };
  });

  app.get("/v1/dashboard/orders/:order_id", async (request, reply) => {
    if (!dependencies.orderService) {
      return reply.code(503).send({ error: "order_service_unavailable" });
    }

    const parsed = z.object({ order_id: z.string().uuid() }).safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_order_id" });
    }

    const order = await dependencies.orderService.getOrderById(parsed.data.order_id);
    if (!order) {
      return reply.code(404).send({ error: "order_not_found" });
    }

    return {
      order: {
        id: order.id,
        status: order.status,
        amount_paise: order.amount_paise,
        quantity: order.quantity,
        sku: order.sku,
        catalog_name: order.catalog_name,
        razorpay_order_id: order.razorpay_order_id,
        payment_link: order.payment_link,
        policy_checks: order.policy_checks,
        created_at: order.created_at?.toISOString(),
        updated_at: order.updated_at?.toISOString(),
      },
    };
  });

  app.get("/v1/agents", async (request, reply) => {
    if (!dependencies.agentRepository) {
      return { agents: [] };
    }
    const agents = await dependencies.agentRepository.listAll();
    return {
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        merchant_id: a.merchantId,
        status: a.status,
      })),
    };
  });

  app.get("/v1/policy", async (request, reply) => {
    if (!dependencies.policyDataRepository) {
      return { policy: null };
    }
    const q = request.query as { merchant_id?: string };
    const merchantId = q.merchant_id;

    if (merchantId) {
      const policy = await dependencies.policyDataRepository.getPolicy(merchantId);
      if (!policy) {
        return { policy: null };
      }
      return { policy };
    }

    if (!dependencies.agentRepository) {
      return { policy: null };
    }
    const agent = await authenticateAgent(request.headers.authorization, dependencies.agentRepository);
    if (!agent) {
      return reply.code(401).send({ error: "invalid_agent_credentials" });
    }
    const policy = await dependencies.policyDataRepository.getPolicy(agent.merchantId);
    if (!policy) {
      return reply.code(404).send({ error: "policy_not_found" });
    }
    return { policy };
  });

  app.get("/v1/approvals/pending", async (request, reply) => {
    if (!dependencies.orderService) {
      return { approvals: [] };
    }
    const q = request.query as { merchant_id?: string };
    const pending = await dependencies.orderService.listPendingApprovals(q.merchant_id);
    return { approvals: pending };
  });

  app.post("/v1/orders/:order_id/approve", async (request, reply) => {
    if (!dependencies.orderService) {
      return reply.code(503).send({ error: "order_service_unavailable" });
    }
    const params = request.params as { order_id: string };
    const body = request.body as { approver_id?: string; comment?: string } | undefined;
    if (!params.order_id) {
      return reply.code(400).send({ error: "order_id required" });
    }
    const result = await dependencies.orderService.approveOrder({
      orderId: params.order_id,
      approverId: body?.approver_id ?? "dashboard",
      comment: body?.comment,
    });
    return result;
  });

  app.post("/v1/orders/:order_id/reject", async (request, reply) => {
    if (!dependencies.orderService) {
      return reply.code(503).send({ error: "order_service_unavailable" });
    }
    const params = request.params as { order_id: string };
    const body = request.body as { approver_id?: string; comment?: string } | undefined;
    if (!params.order_id) {
      return reply.code(400).send({ error: "order_id required" });
    }
    const result = await dependencies.orderService.rejectOrder({
      orderId: params.order_id,
      approverId: body?.approver_id ?? "dashboard",
      comment: body?.comment,
    });
    return result;
  });

  return app;
}
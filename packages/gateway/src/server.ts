import { config as loadEnv } from "dotenv";
loadEnv({ path: "../../.env" });
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";

import { buildApp } from "./app.js";
import { createAgentRepository } from "./agents/repository.js";
import { createAuditRepository } from "./audit/repository.js";
import { createCatalogRepository } from "./catalog/repository.js";
import { loadConfig } from "./config.js";
import { createPolicyDataRepository } from "./policy/repository.js";
import { createOrderService } from "./orders/service.js";
import { createExpressMcpApp } from "./mcp/express-server.js";

const config = loadConfig();

const pool = config.DATABASE_URL
  ? new (await import("pg")).Pool({ connectionString: config.DATABASE_URL, max: 10 })
  : null;

const catalogRepository = config.DATABASE_URL
  ? createCatalogRepository(config.DATABASE_URL, config.MERCHANT_NAME)
  : undefined;
const agentRepository = config.DATABASE_URL
  ? createAgentRepository(config.DATABASE_URL)
  : undefined;
const auditRepository = config.DATABASE_URL
  ? createAuditRepository(config.DATABASE_URL)
  : undefined;
const policyDataRepository = config.DATABASE_URL
  ? createPolicyDataRepository(config.DATABASE_URL)
  : undefined;

const orderService = pool ? createOrderService({
  pool,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  getPolicy: policyDataRepository!.getPolicy.bind(policyDataRepository),
  getCatalogItem: policyDataRepository!.getCatalogItem.bind(policyDataRepository),
  getTodaySpendPaise: policyDataRepository!.getTodaySpendPaise.bind(policyDataRepository),
  getOrdersInLastHour: policyDataRepository!.getOrdersInLastHour.bind(policyDataRepository),
  recordAudit: auditRepository!.record.bind(auditRepository) as (params: {
    correlationId: string;
    merchantId: string;
    agentId: string;
    entityType: string;
    entityId?: string;
    action: string;
    inputJson?: unknown;
    outputJson?: unknown;
    policyResult?: unknown;
  }) => Promise<void>,
}) : undefined;

const app = buildApp({ catalogRepository, agentRepository, auditRepository, policyDataRepository, orderService });

const mcpApp = createExpressMcpApp({
  catalogRepository,
  agentRepository,
  policyDataRepository,
  orderService,
  auditRepository,
});

app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
  try {
    req.body = body;
    done(null, JSON.parse(body.toString()));
  } catch (err) {
    done(err as Error, undefined);
  }
});

app.post("/webhooks/razorpay", async (request, reply) => {
  const rawBody = (request.body as Buffer) ?? Buffer.from("");
  const signature = request.headers["x-razorpay-signature"] as string | undefined;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return reply.code(400).send({ error: "missing_signature" });
  }

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
    await auditRepository?.record({
      correlationId: randomUUID(),
      entityType: "webhook",
      action: "webhook.rejected",
      inputJson: { reason: "invalid_signature" },
      outputJson: { error: "signature_mismatch" },
    });
    return reply.code(400).send({ error: "invalid_signature" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf-8"));
  } catch {
    return reply.code(400).send({ error: "invalid_json" });
  }

  const eventType = payload.event as string;
  const pl = payload.payload as { payment?: { entity?: Record<string, unknown> }; order?: { entity?: Record<string, unknown> } };
  const entity = pl?.payment?.entity ?? pl?.order?.entity;

  if (!entity || typeof entity !== "object") {
    return reply.code(400).send({ error: "unhandled_event_type" });
  }

  const rpEventId = (entity as { id?: string }).id ?? randomUUID();
  const correlationId = randomUUID();

  if (pool) {
    const existing = await pool.query(
      `SELECT id FROM webhook_events WHERE razorpay_event_id = $1`,
      [rpEventId],
    );
    if (existing.rows.length > 0) {
      return { ok: true, idempotent: true };
    }

    await pool.query(
      `INSERT INTO webhook_events (razorpay_event_id, event_type, payload_hash, processing_result, received_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [
        rpEventId,
        eventType,
        crypto.createHash("sha256").update(rawBody).digest("hex"),
        "received",
      ],
    );
  }

  const orderId = (entity as { order_id?: string }).order_id;

  if (orderId && pool) {
    let newStatus: string | null = null;

    if (eventType === "payment.captured" || eventType === "order.paid") {
      newStatus = "paid";
    } else if (eventType === "payment.failed") {
      newStatus = "failed";
      await auditRepository?.record({
        correlationId,
        entityType: "order",
        entityId: orderId,
        action: "order.payment_failed",
        inputJson: { razorpay_event_id: rpEventId, event_type: eventType },
        outputJson: { status: "failed", razorpay_order_id: orderId },
      });
    }

    if (newStatus) {
      await pool.query(
        `UPDATE orders SET status = $1, updated_at = NOW() WHERE razorpay_order_id = $2`,
        [newStatus, orderId],
      );

      await pool.query(
        `UPDATE webhook_events SET processing_result = $1, processed_at = NOW() WHERE razorpay_event_id = $2`,
        [newStatus, rpEventId],
      );
    }
  }

  return { ok: true };
});

app.addHook("onClose", async () => {
  await Promise.all([
    catalogRepository?.close(),
    agentRepository?.close(),
    auditRepository?.close(),
    policyDataRepository?.close(),
    pool?.end(),
  ]);
});

async function start() {
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    mcpApp.listen(3002, () => {
      app.log.info("MCP server on port 3002");
    });
  } catch (error) {
    app.log.error(error, "Gateway failed to start");
    process.exit(1);
  }
}

void start();

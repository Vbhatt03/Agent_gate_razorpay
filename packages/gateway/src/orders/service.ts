import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { evaluateOrder } from "../policy/engine.js";
import { createRazorpayAdapter } from "@agentgate/razorpay-adapter";
import { paiseToDisplayString } from "@agentgate/shared";
import type { StoredAgent } from "../agents/repository.js";
import type { MerchantPolicy, PolicyContext } from "../policy/engine.js";
import type { CatalogItemForPolicy } from "../policy/engine.js";

export type { StoredAgent } from "../agents/repository.js";

export type OrderServiceDeps = {
  pool: Pool;
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  getPolicy: (merchantId: string) => Promise<MerchantPolicy | null>;
  getCatalogItem: (merchantId: string, sku: string) => Promise<CatalogItemForPolicy | null>;
  getTodaySpendPaise: (agentId: string) => Promise<number>;
  getOrdersInLastHour: (agentId: string) => Promise<number>;
  recordAudit: (params: {
    correlationId: string;
    merchantId: string;
    agentId: string;
    entityType: string;
    entityId?: string;
    action: string;
    inputJson?: unknown;
    outputJson?: unknown;
    policyResult?: unknown;
  }) => Promise<void>;
};

interface OrderContext {
  agent: StoredAgent;
  item: CatalogItemForPolicy;
  policy: MerchantPolicy;
}

export function createOrderService(deps: OrderServiceDeps) {
  const rpAdapter = deps.razorpayKeyId && deps.razorpayKeySecret
    ? createRazorpayAdapter(deps.razorpayKeyId, deps.razorpayKeySecret)
    : null;

  async function createOrder(params: {
    correlationId: string;
    sku: string;
    quantity: number;
    agreedPricePaise: number;
    idempotencyKey: string;
    agent: StoredAgent;
  }) {
    const { correlationId, sku, quantity, agreedPricePaise, idempotencyKey, agent } = params;

    const [policy, item, todaySpendPaise, ordersInLastHour] = await Promise.all([
      deps.getPolicy(agent.merchantId),
      deps.getPolicy(agent.merchantId).then(() => deps.getCatalogItem(agent.merchantId, sku)),
      deps.getTodaySpendPaise(agent.id),
      deps.getOrdersInLastHour(agent.id),
    ]);

    if (!policy || !item) {
      return {
        status: "policy_blocked",
        reason: "Product or policy not found",
        policy_rule: "item_active",
        correlation_id: correlationId,
      };
    }

    const context: PolicyContext = {
      agentStatus: agent.status as "active" | "suspended" | "revoked",
      item,
      todaySpendPaise,
      ordersInLastHour,
    };

    const decision = evaluateOrder(policy, context, { agreedUnitPricePaise: agreedPricePaise, quantity });
    // Idempotency: if this idempotency_key already produced an order, return the
    // recorded outcome instead of inserting a duplicate (unique-constraint 500).
    const existingByKey = await deps.pool.query<{ status: string; policy_checks: unknown }>(
      `SELECT status, policy_checks FROM orders WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey],
    );
    if (existingByKey.rows.length > 0) {
      const existing = existingByKey.rows[0];
      let existingRule: string | undefined = decision.reason;
      try {
        const checks = JSON.parse(String(existing.policy_checks));
        existingRule = (checks as Array<{ passed: boolean; rule: string }>).find((c) => !c.passed)?.rule;
      } catch {
        /* fall back to the freshly computed reason */
      }
      return {
        status: existing.status,
        ...(existingRule ? { policy_rule: existingRule } : {}),
        correlation_id: correlationId,
        idempotent: true,
      };
    }
    await recordOrder({
      correlationId,
      agentId: agent.id,
      catalogItemId: item.id ?? randomUUID(),
      idempotencyKey,
      quantity,
      amountPaise: agreedPricePaise * quantity,
      status: decision.allowed
        ? (decision.requiresHumanApproval ? "awaiting_approval" : "pending")
        : "policy_blocked",
      policyChecks: decision.checks,
      policyVersion: policy.version,
      razorpayOrderId: null,
      paymentLink: null,
    });

    if (!decision.allowed) {
      await deps.recordAudit({
        correlationId,
        merchantId: agent.merchantId,
        agentId: agent.id,
        entityType: "order",
        entityId: sku,
        action: "order.blocked",
        inputJson: { sku, quantity, agreedPricePaise },
        outputJson: { status: "policy_blocked", policy_rule: decision.reason },
        policyResult: decision,
      });

      return {
        status: "policy_blocked",
        reason: `Blocked by policy rule: ${decision.reason}`,
        policy_rule: decision.reason,
        correlation_id: correlationId,
      };
    }

    if (decision.requiresHumanApproval) {
      await deps.pool.query(
        `INSERT INTO order_approvals (order_id, status) VALUES ($1, 'pending')`,
        [correlationId],
      );
      await deps.recordAudit({
        correlationId,
        merchantId: agent.merchantId,
        agentId: agent.id,
        entityType: "order",
        action: "order.awaiting_approval",
        inputJson: { sku, quantity, agreedPricePaise },
        outputJson: { status: "awaiting_approval", requires_human_approval: true },
        policyResult: decision,
      });

      return { status: "awaiting_approval", order_id: correlationId };
    }

    // Policy approved — create Razorpay order
    if (!rpAdapter) {
      return {
        status: "policy_blocked",
        reason: "Razorpay not configured",
        policy_rule: "razorpay_unavailable",
        correlation_id: correlationId,
      };
    }

    const totalPaise = agreedPricePaise * quantity;
    const rpResult = await rpAdapter.createPaymentLink({
      amountPaise: totalPaise,
      receipt: `ag-${idempotencyKey.slice(0, 12)}`,
      notes: {
        agent_id: agent.id,
        sku,
        merchant_id: agent.merchantId,
        correlation_id: correlationId,
        description: `AgentGate order: ${sku} x${quantity} — ${paiseToDisplayString(totalPaise)}`,
      },
    });

    // Update order with Razorpay IDs
    await deps.pool.query(
      `UPDATE orders SET razorpay_order_id = $1, payment_link = $2, status = 'pending' WHERE idempotency_key = $3`,
      [rpResult.razorpayOrderId, rpResult.paymentLink, idempotencyKey],
    );

    await deps.recordAudit({
      correlationId,
      merchantId: agent.merchantId,
      agentId: agent.id,
      entityType: "order",
      action: "order.created",
      inputJson: { sku, quantity, agreedPricePaise },
      outputJson: {
        status: "created",
        razorpay_order_id: rpResult.razorpayOrderId,
        payment_link: rpResult.paymentLink,
      },
      policyResult: decision,
    });

    return {
      status: "created",
      razorpay_order_id: rpResult.razorpayOrderId,
      payment_link: rpResult.paymentLink,
    };
  }

  async function recordOrder(params: {
    correlationId: string;
    agentId: string;
    catalogItemId: string;
    idempotencyKey: string;
    quantity: number;
    amountPaise: number;
    status: string;
    policyChecks: unknown;
    policyVersion: number;
    razorpayOrderId: string | null;
    paymentLink: string | null;
  }) {
    await deps.pool.query(
      `INSERT INTO orders (id, agent_id, catalog_item_id, idempotency_key, quantity, amount_paise, status, policy_checks, policy_version, razorpay_order_id, payment_link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        params.correlationId,
        params.agentId,
        params.catalogItemId,
        params.idempotencyKey,
        params.quantity,
        params.amountPaise,
        params.status,
        JSON.stringify(params.policyChecks),
        params.policyVersion,
        params.razorpayOrderId,
        params.paymentLink,
      ],
    );
  }

  async function listRecentOrders(limit: number = 50) {
    const result = await deps.pool.query(
      `SELECT o.id, o.status, o.amount_paise, o.quantity, o.created_at,
              c.sku, c.name as catalog_name
       FROM orders o
       JOIN catalog_items c ON c.id = o.catalog_item_id
       ORDER BY o.created_at DESC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  async function getOrderById(orderId: string) {
    const result = await deps.pool.query(
      `SELECT o.*, c.sku, c.name as catalog_name
       FROM orders o
       JOIN catalog_items c ON c.id = o.catalog_item_id
       WHERE o.id = $1`,
      [orderId],
    );
    return result.rows[0] ?? null;
  }

  async function updateOrderStatus(orderId: string, status: string, razorpayOrderId?: string) {
    await deps.pool.query(
      `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, orderId],
    );
  }

  async function listPendingApprovals(merchantId?: string) {
    let query = `
      SELECT o.id, o.status, o.amount_paise, o.quantity, o.created_at,
             c.sku, c.name as catalog_name,
             a.name as agent_name, a.id as agent_id
      FROM order_approvals ap
      JOIN orders o ON o.id = ap.order_id
      JOIN catalog_items c ON c.id = o.catalog_item_id
      JOIN agents a ON a.id = o.agent_id
      WHERE ap.status = 'pending'
    `;
    const params: string[] = [];
    if (merchantId) {
      query += ` AND a.merchant_id = $1`;
      params.push(merchantId);
    }
    query += ` ORDER BY o.created_at ASC`;
    const result = await deps.pool.query(query, params);
    return result.rows;
  }

  async function approveOrder(params: {
    orderId: string;
    approverId: string;
    comment?: string;
  }) {
    const { orderId, approverId, comment } = params;

    await deps.pool.query(
      `UPDATE order_approvals
       SET status = 'approved', approver_id = $2, comment = $3, decided_at = NOW()
       WHERE order_id = $1 AND status = 'pending'`,
      [orderId, approverId, comment ?? null],
    );

    await deps.pool.query(
      `UPDATE orders SET status = 'pending', updated_at = NOW() WHERE id = $1`,
      [orderId],
    );

    const ownerRes = await deps.pool.query<{ agent_id: string; merchant_id: string }>(
      `SELECT o.agent_id, a.merchant_id
       FROM orders o
       JOIN agents a ON a.id = o.agent_id
       WHERE o.id = $1`,
      [orderId],
    );
    const owner = ownerRes.rows[0];
    if (owner) {
      await deps.recordAudit({
        correlationId: randomUUID(),
        merchantId: owner.merchant_id,
        agentId: owner.agent_id,
        entityType: "order",
        entityId: orderId,
        action: "order.approved",
        inputJson: { approver_id: approverId, comment: comment ?? null },
        outputJson: { status: "approved", order_id: orderId },
      });
    }

    return { status: "approved", order_id: orderId };
  }

  async function rejectOrder(params: {
    orderId: string;
    approverId: string;
    comment?: string;
  }) {
    const { orderId, approverId, comment } = params;

    await deps.pool.query(
      `UPDATE order_approvals
       SET status = 'rejected', approver_id = $2, comment = $3, decided_at = NOW()
       WHERE order_id = $1 AND status = 'pending'`,
      [orderId, approverId, comment ?? null],
    );

    await deps.pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [orderId],
    );

    const ownerRes = await deps.pool.query<{ agent_id: string; merchant_id: string }>(
      `SELECT o.agent_id, a.merchant_id
       FROM orders o
       JOIN agents a ON a.id = o.agent_id
       WHERE o.id = $1`,
      [orderId],
    );
    const owner = ownerRes.rows[0];
    if (owner) {
      await deps.recordAudit({
        correlationId: randomUUID(),
        merchantId: owner.merchant_id,
        agentId: owner.agent_id,
        entityType: "order",
        entityId: orderId,
        action: "order.rejected",
        inputJson: { approver_id: approverId, comment: comment ?? null },
        outputJson: { status: "rejected", order_id: orderId },
      });
    }

    return { status: "rejected", order_id: orderId };
  }

  return { createOrder, listRecentOrders, listPendingApprovals, approveOrder, rejectOrder, getOrderById, updateOrderStatus, recordOrder };
}

export type OrderService = ReturnType<typeof createOrderService>;
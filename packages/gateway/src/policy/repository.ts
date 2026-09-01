import { Pool } from "pg";

import type { CatalogItemForPolicy, MerchantPolicy } from "./engine.js";

export type PolicyDataRepository = {
  getPolicy(merchantId: string): Promise<MerchantPolicy | null>;
  getCatalogItem(merchantId: string, sku: string): Promise<CatalogItemForPolicy | null>;
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
  close(): Promise<void>;
};

type PolicyRow = {
  version: number;
  max_txn_paise: string;
  daily_spend_cap_paise: string;
  approval_threshold_paise: string;
  allowed_categories: string[];
  max_orders_per_hour: number;
};

type ItemRow = {
  id: string;
  name: string;
  sku: string;
  price_paise: string;
  discount_floor_pct: string;
  category: string;
  stock: number;
  is_active: boolean;
  is_easily_reversible: boolean;
};

function percentToBasisPoints(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export function createPolicyDataRepository(databaseUrl: string): PolicyDataRepository {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async getPolicy(merchantId) {
      const result = await pool.query<PolicyRow>(
        `
          select version, max_txn_paise, daily_spend_cap_paise, approval_threshold_paise,
                 allowed_categories, max_orders_per_hour
          from policies
          where merchant_id = $1
          limit 1
        `,
        [merchantId],
      );
      const row = result.rows[0];
      if (!row) return null;

      return {
        version: row.version,
        maxTxnPaise: Number(row.max_txn_paise),
        dailySpendCapPaise: Number(row.daily_spend_cap_paise),
        approvalThresholdPaise: Number(row.approval_threshold_paise),
        allowedCategories: row.allowed_categories,
        maxOrdersPerHour: row.max_orders_per_hour,
      };
    },

    async getCatalogItem(merchantId, sku) {
      const result = await pool.query<ItemRow>(
        `
          select id, name, sku, price_paise, discount_floor_pct, category, stock, is_active, is_easily_reversible
          from catalog_items
          where merchant_id = $1 and sku = $2
          limit 1
        `,
        [merchantId, sku],
      );
      const row = result.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        pricePaise: Number(row.price_paise),
        discountFloorBasisPoints: percentToBasisPoints(row.discount_floor_pct),
        category: row.category,
        stock: row.stock,
        isActive: row.is_active,
        isEasilyReversible: row.is_easily_reversible,
      };
    },

    async getTodaySpendPaise(agentId) {
      const result = await pool.query<{ total: string }>(
        `
          select coalesce(sum(amount_paise), 0) as total
          from orders
          where agent_id = $1
            and status in ('pending', 'awaiting_approval', 'paid')
            and created_at >= date_trunc('day', now())
        `,
        [agentId],
      );

      return Number(result.rows[0]?.total ?? 0);
    },

    async getOrdersInLastHour(agentId) {
      const result = await pool.query<{ count: string }>(
        `
          select count(*) as count
          from orders
          where agent_id = $1
            and status in ('pending', 'awaiting_approval', 'paid', 'failed')
            and created_at >= now() - interval '1 hour'
        `,
        [agentId],
      );

      return Number(result.rows[0]?.count ?? 0);
    },

    async createNegotiation(input) {
      await pool.query(
        `
          insert into negotiations (
            agent_id, sku, requested_price_paise, offered_price_paise, reason_text, policy_result
          )
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          input.agentId,
          input.sku,
          input.requestedPricePaise,
          input.offeredPricePaise,
          input.reasonText,
          input.policyResult,
        ],
      );
    },

    close: () => pool.end(),
  };
}

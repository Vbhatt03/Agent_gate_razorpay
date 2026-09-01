import { Pool } from "pg";

export type StoredAgent = {
  id: string;
  merchantId: string;
  name: string;
  apiKeyHash: string;
  status: "active" | "suspended" | "revoked";
};

export interface AgentRepository {
  findByApiKeyPrefix(prefix: string): Promise<StoredAgent | null>;
  listAll(): Promise<StoredAgent[]>;
  close(): Promise<void>;
}

type AgentRow = {
  id: string;
  merchant_id: string;
  name: string;
  api_key_hash: string;
  status: StoredAgent["status"];
};

export function createAgentRepository(databaseUrl: string): AgentRepository {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async findByApiKeyPrefix(prefix) {
      const result = await pool.query<AgentRow>(
        `
          select id, merchant_id, name, api_key_hash, status
          from agents
          where api_key_prefix = $1
          limit 1
        `,
        [prefix],
      );
      const row = result.rows[0];

      return row
        ? {
            id: row.id,
            merchantId: row.merchant_id,
            name: row.name,
            apiKeyHash: row.api_key_hash,
            status: row.status,
          }
        : null;
    },
    async listAll() {
      const result = await pool.query<AgentRow>(
        `select id, merchant_id, name, api_key_hash, status from agents order by created_at desc`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        merchantId: row.merchant_id,
        name: row.name,
        apiKeyHash: row.api_key_hash,
        status: row.status,
      }));
    },
    close: () => pool.end(),
  };
}

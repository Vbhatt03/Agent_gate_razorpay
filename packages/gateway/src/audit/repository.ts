import { Pool } from "pg";

export type AuditEntry = {
  id?: number;
  correlationId: string;
  merchantId?: string;
  agentId?: string;
  entityType: string;
  entityId?: string;
  action: string;
  inputJson?: object;
  outputJson?: object;
  policyResult?: object;
  createdAt?: Date;
};

export type AuditRepository = {
  record(entry: AuditEntry): Promise<void>;
  getRecentEntries(limit: number): Promise<AuditEntry[]>;
  close(): Promise<void>;
};

export function createAuditRepository(databaseUrl: string): AuditRepository {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    async record(entry) {
      await pool.query(
        `INSERT INTO audit_log
           (correlation_id, merchant_id, agent_id, entity_type, entity_id, action, input_json, output_json, policy_result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          entry.correlationId,
          entry.merchantId ?? null,
          entry.agentId ?? null,
          entry.entityType,
          entry.entityId ?? null,
          entry.action,
          entry.inputJson ? JSON.stringify(entry.inputJson) : null,
          entry.outputJson ? JSON.stringify(entry.outputJson) : null,
          entry.policyResult ? JSON.stringify(entry.policyResult) : null,
        ],
      );
    },

    async getRecentEntries(limit: number) {
      type AuditRow = {
        id: number;
        correlation_id: string;
        entity_type: string;
        entity_id: string | null;
        action: string;
        input_json: Record<string, unknown> | null;
        output_json: Record<string, unknown> | null;
        policy_result: Record<string, unknown> | null;
        created_at: Date;
        agent_id: string | null;
      };

      const result = await pool.query<AuditRow>(
        `SELECT id, correlation_id, entity_type, entity_id, action, input_json, output_json, policy_result, created_at, agent_id
         FROM audit_log
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit],
      );

      return result.rows.map((row) => ({
        id: row.id,
        correlationId: row.correlation_id,
        merchantId: undefined,
        agentId: row.agent_id ?? undefined,
        entityType: row.entity_type,
        entityId: row.entity_id ?? undefined,
        action: row.action,
        inputJson: row.input_json ?? undefined,
        outputJson: row.output_json ?? undefined,
        policyResult: row.policy_result ?? undefined,
        createdAt: row.created_at,
      }));
    },

    close: () => pool.end(),
  };
}
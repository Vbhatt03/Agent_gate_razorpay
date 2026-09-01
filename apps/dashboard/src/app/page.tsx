"use client";

import { useEffect, useState } from "react";

type AuditEntry = {
  id: number;
  correlation_id: string;
  entity_type: string;
  entity_id: string | null;
  action: string;
  input_json: Record<string, unknown> | null;
  output_json: Record<string, unknown> | null;
  policy_result: Record<string, unknown> | null;
  created_at: string;
  agent_id: string | null;
};

function getActionBadge(action: string): string {
  if (action.includes("blocked") || action.includes("failed") || action === "order.payment_failed") return "badge-danger";
  if (action.includes("approved") || action.includes("created") || action === "order.paid") return "badge-success";
  if (action.includes("awaiting") || action === "negotiation.requested") return "badge-warning";
  return "badge-neutral";
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function fetchAudit() {
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
      const res = await fetch(`${base}/v1/audit?limit=80`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAudit();
    const interval = setInterval(fetchAudit, 3000);
    return () => clearInterval(interval);
  }, []);

  const filtered = entries.filter((e) =>
    filter === "" ||
    e.action.toLowerCase().includes(filter.toLowerCase()) ||
    e.entity_type.toLowerCase().includes(filter.toLowerCase()),
  );

  const actionCounts = entries.reduce<Record<string, number>>((acc, e) => {
    const key = e.action.split(".")[0];
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Audit Log</h1>
            <p className="page-subtitle">Real-time event stream from all agents</p>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-sm text-muted">Auto-refreshes every 3s</span>
            <input
              placeholder="Filter by action or entity..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input"
              style={{ width: 280 }}
            />
          </div>
        </div>
      </div>

      <div className="stats-grid">
        {Object.entries(actionCounts).slice(0, 5).map(([action, count]) => (
          <div key={action} className="stat-card">
            <div className="stat-label">{action}</div>
            <div className="stat-value">{count}</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{entries.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Events</span>
          <button className="btn btn-secondary btn-sm" onClick={fetchAudit}>Refresh</button>
        </div>
        <div className="card-body" style={{ overflowX: "auto" }}>
          {loading ? (
            <div className="empty-state"><p>Loading...</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <p>No audit entries yet</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Output / Result</th>
                  <th>Correlation ID</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => {
                  const badgeClass = getActionBadge(entry.action);
                  const output = entry.output_json ?? entry.input_json ?? {};
                  return (
                    <tr key={entry.id}>
                      <td>
                        <span className="mono text-muted text-sm">
                          {new Date(entry.created_at).toLocaleTimeString("en-IN")}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${badgeClass}`}>{entry.action}</span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 500 }}>{entry.entity_type}</span>
                        {entry.entity_id && (
                          <span className="text-muted text-sm"> / {String(entry.entity_id).slice(0, 8)}...</span>
                        )}
                      </td>
                      <td>
                        <span className="mono text-sm truncate" style={{ display: "block", maxWidth: 360 }}>
                          {JSON.stringify(output)}
                        </span>
                      </td>
                      <td>
                        <span className="mono text-muted">{entry.correlation_id?.slice(0, 8)}...</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

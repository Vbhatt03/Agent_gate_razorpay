"use client";

import { useEffect, useState } from "react";

type Agent = {
  id: string;
  name: string;
  merchant_id: string;
  status: string;
};

const statusBadge: Record<string, string> = {
  active: "badge-success",
  suspended: "badge-warning",
  revoked: "badge-danger",
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function fetchAgents() {
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
      const res = await fetch(`${base}/v1/agents`);
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 10000);
    return () => clearInterval(interval);
  }, []);

  const filtered = agents.filter((a) =>
    filter === "" ||
    a.name.toLowerCase().includes(filter.toLowerCase()) ||
    a.status.includes(filter),
  );

  const counts = agents.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Agents</h1>
            <p className="page-subtitle">Registered agents in the system</p>
          </div>
          <button className="btn btn-secondary" onClick={fetchAgents}>Refresh</button>
        </div>
      </div>

      <div className="stats-grid">
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} className="stat-card">
            <div className="stat-label">{status}</div>
            <div className="stat-value">{count}</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{agents.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">All Agents</span>
          <input
            placeholder="Filter by name or status..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="input"
            style={{ width: 240 }}
          />
        </div>
        <div className="card-body">
          {loading ? (
            <div className="empty-state"><p>Loading...</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🤖</div>
              <p>No agents found</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Agent ID</th>
                  <th>Merchant ID</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent) => (
                  <tr key={agent.id}>
                    <td style={{ fontWeight: 500 }}>{agent.name}</td>
                    <td>
                      <span className="mono" style={{ color: "#6366f1" }}>{agent.id.slice(0, 8)}...</span>
                    </td>
                    <td>
                      <span className="mono text-muted">{agent.merchant_id.slice(0, 8)}...</span>
                    </td>
                    <td>
                      <span className={`badge ${statusBadge[agent.status] ?? "badge-neutral"}`}>
                        {agent.status}
                      </span>
                    </td>
                    <td className="text-muted text-sm">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

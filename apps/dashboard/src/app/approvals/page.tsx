"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ApprovalOrder = {
  id: string;
  status: string;
  amount_paise: string;
  quantity: number;
  sku: string;
  catalog_name: string;
  agent_name: string;
  agent_id: string;
  created_at: string;
};

function paiseToDisplay(paise: string | number): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(rupees);
}

export default function ApprovalsPage() {
  const [orders, setOrders] = useState<ApprovalOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");

  async function fetchPending() {
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
      const res = await fetch(`${base}/v1/approvals/pending`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.approvals ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPending();
    const interval = setInterval(fetchPending, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleApprove(orderId: string) {
    setActionLoading(orderId);
    setAction("approve");
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
      await fetch(`${base}/v1/orders/${orderId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approver_id: "dashboard", comment }),
      });
      await fetchPending();
    } finally {
      setActionLoading(null);
      setAction(null);
      setComment("");
    }
  }

  async function handleReject(orderId: string) {
    setActionLoading(orderId);
    setAction("reject");
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
      await fetch(`${base}/v1/orders/${orderId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approver_id: "dashboard", comment }),
      });
      await fetchPending();
    } finally {
      setActionLoading(null);
      setAction(null);
      setComment("");
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Pending Approvals</h1>
            <p className="page-subtitle">Orders awaiting human approval before payment</p>
          </div>
          <button className="btn btn-secondary" onClick={fetchPending}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>
          <div className="empty-state-icon">⏳</div>
          <p>Loading...</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">✅</div>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>All caught up!</p>
            <p className="text-sm text-muted">No orders pending approval right now.</p>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {orders.map((order) => (
            <div key={order.id} className="card">
              <div className="card-header">
                <div className="flex items-center gap-3">
                  <span className="badge badge-awaiting_approval">Awaiting Approval</span>
                  <span className="mono text-muted text-sm">{order.id.slice(0, 8)}...</span>
                </div>
                <span className="text-sm text-muted">
                  {order.created_at ? new Date(order.created_at).toLocaleString("en-IN") : "—"}
                </span>
              </div>
              <div className="card-body" style={{ padding: "18px 20px" }}>
                <div className="detail-grid" style={{ marginBottom: 16 }}>
                  <div className="detail-card">
                    <div className="detail-label">Product</div>
                    <div className="detail-value">{order.catalog_name}</div>
                    <div className="text-sm text-muted mono">{order.sku}</div>
                  </div>
                  <div className="detail-card">
                    <div className="detail-label">Agent</div>
                    <div className="detail-value">{order.agent_name}</div>
                    <div className="text-sm text-muted mono">{order.agent_id.slice(0, 8)}...</div>
                  </div>
                  <div className="detail-card">
                    <div className="detail-label">Quantity</div>
                    <div className="detail-value">{order.quantity} units</div>
                  </div>
                  <div className="detail-card">
                    <div className="detail-label">Total Amount</div>
                    <div className="detail-value" style={{ color: "#6366f1", fontSize: 20 }}>
                      {paiseToDisplay(order.amount_paise)}
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <input
                    placeholder="Comment (optional)"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="input"
                    style={{ width: "100%" }}
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    className="btn btn-primary"
                    style={{ background: "#10b981" }}
                    onClick={() => handleApprove(order.id)}
                    disabled={actionLoading === order.id}
                  >
                    {actionLoading === order.id && action === "approve" ? "Approving..." : "✅ Approve"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ borderColor: "#ef4444", color: "#ef4444" }}
                    onClick={() => handleReject(order.id)}
                    disabled={actionLoading === order.id}
                  >
                    {actionLoading === order.id && action === "reject" ? "Rejecting..." : "✕ Reject"}
                  </button>
                  <Link href={`/orders/${order.id}`} className="btn btn-secondary">
                    View Order →
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

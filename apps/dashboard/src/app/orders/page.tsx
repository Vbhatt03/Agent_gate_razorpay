"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Order = {
  id: string;
  status: string;
  amount_paise: string;
  quantity: number;
  sku: string;
  catalog_name: string;
  created_at: string;
};

const statusBadge: Record<string, string> = {
  pending: "badge-warning",
  awaiting_approval: "badge-awaiting_approval",
  policy_blocked: "badge-policy_blocked",
  paid: "badge-paid",
  failed: "badge-failed",
  cancelled: "badge-cancelled",
};

function paiseToDisplay(paise: string | number): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(rupees);
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  async function fetchOrders() {
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
      const res = await fetch(`${base}/v1/orders?limit=100`);
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, []);

  const filtered = orders.filter((o) =>
    filter === "" ||
    o.status.includes(filter) ||
    o.sku.toLowerCase().includes(filter.toLowerCase()) ||
    o.catalog_name.toLowerCase().includes(filter.toLowerCase()),
  );

  const counts = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Orders</h1>
            <p className="page-subtitle">Recent orders across all agents</p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={fetchOrders}>Refresh</button>
          </div>
        </div>
      </div>

      <div className="stats-grid">
        {Object.entries(counts).map(([status, count]) => (
          <div key={status} className="stat-card">
            <div className="stat-label">{status.replace(/_/g, " ")}</div>
            <div className="stat-value">{count}</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{orders.length}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">All Orders</span>
          <input
            placeholder="Filter by SKU, name, or status..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="input"
            style={{ width: 260 }}
          />
        </div>
        <div className="card-body">
          {loading ? (
            <div className="empty-state"><p>Loading...</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">📦</div>
              <p>No orders yet</p>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>SKU / Product</th>
                  <th>Qty</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <span className="mono" style={{ color: "#6366f1" }}>{order.id.slice(0, 8)}...</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{order.catalog_name}</div>
                      <div className="text-sm text-muted">{order.sku}</div>
                    </td>
                    <td>{order.quantity}</td>
                    <td style={{ fontWeight: 600 }}>{paiseToDisplay(order.amount_paise)}</td>
                    <td>
                      <span className={`badge ${statusBadge[order.status] ?? "badge-neutral"}`}>
                        {order.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="text-muted text-sm">
                      {order.created_at ? new Date(order.created_at).toLocaleString("en-IN") : "—"}
                    </td>
                    <td>
                      <Link href={`/orders/${order.id}`} className="btn btn-secondary btn-sm">
                        View →
                      </Link>
                    </td>
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

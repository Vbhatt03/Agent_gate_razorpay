"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type OrderDetail = {
  id: string;
  status: string;
  amount_paise: string;
  quantity: number;
  sku: string;
  razorpay_order_id: string | null;
  payment_link: string | null;
  policy_checks: unknown;
  created_at: string;
  updated_at: string;
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

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchOrder() {
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";
      const res = await fetch(`${base}/v1/dashboard/orders/${orderId}`);
      if (res.ok) {
        const data = await res.json();
        setOrder(data.order);
      } else {
        setError(`HTTP ${res.status}`);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrder();
  }, [orderId]);

  if (loading) {
    return (
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <div className="empty-state-icon">⏳</div>
        <p>Loading order...</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div>
        <Link href="/orders" className="back-link">← Back to Orders</Link>
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon">❌</div>
            <p>Order not found or fetch failed: {error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link href="/orders" className="back-link">← Back to Orders</Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="page-title">Order {order.id.slice(0, 8)}...</h1>
          <p className="page-subtitle mono">{order.id}</p>
        </div>
        <span className={`badge ${statusBadge[order.status] ?? "badge-neutral"}`} style={{ fontSize: 13, padding: "4px 14px" }}>
          {order.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <div className="detail-label">Amount</div>
          <div className="detail-value" style={{ color: "#6366f1", fontSize: 22 }}>
            {paiseToDisplay(order.amount_paise)}
          </div>
        </div>
        <div className="detail-card">
          <div className="detail-label">Quantity</div>
          <div className="detail-value">{order.quantity} units</div>
        </div>
        <div className="detail-card">
          <div className="detail-label">SKU</div>
          <div className="detail-value mono">{order.sku}</div>
        </div>
        <div className="detail-card">
          <div className="detail-label">Razorpay Order ID</div>
          <div className="detail-value mono" style={{ fontSize: 13 }}>
            {order.razorpay_order_id ?? <span className="text-muted">Not created yet</span>}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header"><span className="card-title">Payment Link</span></div>
        <div className="card-body" style={{ padding: "14px 18px" }}>
          {order.payment_link ? (
            <a href={order.payment_link} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
              Open Payment Link →
            </a>
          ) : (
            <span className="text-muted text-sm">No payment link — order may be blocked or awaiting approval</span>
          )}
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-header"><span className="card-title">Timeline</span></div>
        <div className="card-body" style={{ padding: "14px 18px" }}>
          <div className="info-row">
            <span className="info-label">Created</span>
            <span className="info-value">{order.created_at ? new Date(order.created_at).toLocaleString("en-IN") : "—"}</span>
          </div>
          <div className="info-row">
            <span className="info-label">Updated</span>
            <span className="info-value">{order.updated_at ? new Date(order.updated_at).toLocaleString("en-IN") : "—"}</span>
          </div>
        </div>
      </div>

      {order.policy_checks && (
        <div className="card">
          <div className="card-header"><span className="card-title">Policy Checks</span></div>
          <div className="card-body" style={{ padding: "14px 18px" }}>
            <pre className="json-block">{JSON.stringify(order.policy_checks, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

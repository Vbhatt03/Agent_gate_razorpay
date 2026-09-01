"use client";

import { useEffect, useState } from "react";

type Policy = {
  version: number;
  maxTxnPaise: number;
  dailySpendCapPaise: number;
  approvalThresholdPaise: number;
  allowedCategories: string[];
  maxOrdersPerHour: number;
};

function paiseToDisplay(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(rupees);
}

export default function PolicyPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchPolicy() {
    try {
      const base = process.env.NEXT_PUBLIC_AGENTGATE_BASE_URL ?? "http://127.0.0.1:3001";

      const agentsRes = await fetch(`${base}/v1/agents`);
      if (!agentsRes.ok) throw new Error("Failed to fetch agents");
      const { agents } = await agentsRes.json();
      if (!agents?.length) throw new Error("No agents found — database may not be connected");

      const merchantId = agents[0].merchant_id;
      const res = await fetch(`${base}/v1/policy?merchant_id=${merchantId}`);
      const data = await res.json();
      if (data.policy) {
        setPolicy(data.policy);
      } else {
        setError("No policy configured for this merchant");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPolicy();
  }, []);

  if (loading) {
    return (
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <div className="empty-state-icon">⏳</div>
        <p>Loading policy...</p>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="empty-state-icon">🛡️</div>
          <p style={{ fontWeight: 500, marginBottom: 6 }}>Policy Not Available</p>
          <p className="text-sm text-muted" style={{ maxWidth: 400, margin: "0 auto" }}>
            {error ?? "No policy found. Ensure the database is connected and seeded."}
          </p>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-secondary" onClick={fetchPolicy}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  const rules = [
    {
      icon: "💰",
      label: "Max Transaction",
      value: paiseToDisplay(policy.maxTxnPaise),
      desc: "Maximum amount for a single order",
    },
    {
      icon: "📅",
      label: "Daily Spend Cap",
      value: paiseToDisplay(policy.dailySpendCapPaise),
      desc: "Total orders allowed per day",
    },
    {
      icon: "✅",
      label: "Approval Threshold",
      value: paiseToDisplay(policy.approvalThresholdPaise),
      desc: "Orders above this require human approval",
    },
    {
      icon: "⏱️",
      label: "Max Orders / Hour",
      value: String(policy.maxOrdersPerHour),
      desc: "Orders allowed per agent per hour",
    },
    {
      icon: "📂",
      label: "Allowed Categories",
      value: policy.allowedCategories.length > 0 ? policy.allowedCategories.join(", ") : "All",
      desc: "Product categories the agent can negotiate",
    },
    {
      icon: "🔢",
      label: "Policy Version",
      value: `v${policy.version}`,
      desc: "Current active policy version",
    },
  ];

  return (
    <div>
      <div className="page-header mb-6">
        <div>
          <h1 className="page-title">Policy</h1>
          <p className="page-subtitle">Active merchant policy configuration</p>
        </div>
        <button className="btn btn-secondary" onClick={fetchPolicy}>Refresh</button>
      </div>

      <div className="card mb-4">
        <div className="card-header">
          <span className="card-title">Policy Rules</span>
          <span className="badge badge-success">Active</span>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {rules.map((rule) => (
              <div
                key={rule.label}
                style={{
                  padding: "18px 20px",
                  borderBottom: "1px solid var(--border)",
                  borderRight: "1px solid var(--border)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>{rule.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {rule.label}
                  </span>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", marginBottom: 2 }}>
                  {rule.value}
                </div>
                <div className="text-sm text-muted">{rule.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-title">Policy Evaluation Flow</span>
        </div>
        <div className="card-body" style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { step: "1", title: "Agent Request", desc: "Agent requests negotiation or order creation via MCP tool" },
              { step: "2", title: "Policy Engine", desc: "Engine evaluates against active policy rules (spend caps, limits, categories)" },
              { step: "3", title: "Negotiation", desc: "If within bounds, Groq LLM generates a counter-offer within the allowed price range" },
              { step: "4", title: "Order Creation", desc: "Order created with policy-gated checks — may require human approval if above threshold" },
              { step: "5", title: "Payment", desc: "Razorpay payment link generated; order confirmed on webhook callback" },
            ].map((item) => (
              <div key={item.step} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: "#6366f1",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {item.step}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                  <div className="text-sm text-muted">{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

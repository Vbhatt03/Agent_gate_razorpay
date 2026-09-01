"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import "./globals.css";

const navItems = [
  { href: "/", label: "Audit Log", icon: "📋" },
  { href: "/orders", label: "Orders", icon: "📦" },
  { href: "/approvals", label: "Approvals", icon: "✅" },
  { href: "/agents", label: "Agents", icon: "🤖" },
  { href: "/policy", label: "Policy", icon: "🛡️" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="sidebar-header">
              <div className="brand">
                <span className="brand-icon">⚡</span>
                <span className="brand-name">AgentGate</span>
              </div>
              <span className="test-badge">TEST MODE</span>
            </div>
            <nav className="nav">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item${pathname === item.href ? " active" : ""}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                </Link>
              ))}
            </nav>
            <div className="sidebar-footer">
              <div className="footer-note">v0.1.0 — Hackathon Build</div>
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}

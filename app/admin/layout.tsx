"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UIProvider as UiProvider, LoadingSpinner as UiSpinner, Alert as UiAlert, Typography as UiTypography } from "../components/ui";
import { AuthApiError, authApiGet } from "../lib/auth-api";
import "./admin-shell.css";

type Status = "checking" | "ready" | "forbidden" | "error";

function AdminNav() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobileNav = () => setMobileOpen(false);
  const groups = [
    { label: "Overview", links: [{ href: "/admin", label: "Dashboard" }] },
    { label: "Access", links: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/roles", label: "Roles" },
      { href: "/admin/permissions", label: "Permissions" },
    ] },
    { label: "Business", links: [
      { href: "/admin/master-data", label: "Master Data" },
      { href: "/admin/settings", label: "Business Configuration" },
      { href: "/admin/approval-matrix", label: "Approval Matrix" },
      { href: "/admin/delegation", label: "Delegation" },
    ] },
    { label: "Platform", links: [
      { href: "/admin/notifications", label: "Notifications" },
      { href: "/admin/audit", label: "Audit" },
      { href: "/admin/settings/ai", label: "AI Configuration" },
      { href: "/admin/settings/system", label: "System Parameters" },
      { href: "/admin/settings/version-history", label: "Configuration History" },
    ] },
  ];
  return (
    <nav aria-label="Finance Master console" className="adminNav">
      <div className="adminNavHeader">
        <UiTypography as="h2" variant="section">
          Finance Master
        </UiTypography>
        <button
          type="button"
          className="adminNavToggle"
          aria-controls="admin-primary-navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span aria-hidden="true">{mobileOpen ? "×" : "☰"}</span>
          <span>{mobileOpen ? "Close menu" : "Finance Master"}</span>
        </button>
      </div>
      <div id="admin-primary-navigation" className={`adminNavGroups${mobileOpen ? " mobileOpen" : ""}`}>
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <UiTypography as="h3" variant="metadata">{group.label}</UiTypography>
            <ul>
              {group.links.map((link) => <li key={link.href}><Link href={link.href} onClick={closeMobileNav}>{link.label}</Link></li>)}
            </ul>
          </section>
        ))}
      </div>
      <div className={`adminNavFooter${mobileOpen ? " mobileOpen" : ""}`}>
        <Link href="/profile" onClick={closeMobileNav}>My profile</Link>
        <Link href="/" onClick={closeMobileNav}>&larr; Back to AIMS</Link>
      </div>
    </nav>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;
    authApiGet("/admin/users?pageSize=1")
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        if (cause instanceof AuthApiError && cause.status === 401) {
          router.replace("/login");
          return;
        }
        setStatus(cause instanceof AuthApiError && cause.status === 403 ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (status === "checking") {
    return (
      <UiProvider style={{ padding: 48 }}>
        <UiSpinner label="Checking access…" />
      </UiProvider>
    );
  }

  if (status === "forbidden") {
    return (
      <UiProvider style={{ maxWidth: 480, margin: "48px auto", padding: 16 }}>
        <UiAlert tone="danger" title="Not authorized">
          Finance Master access is required for this area. <Link href="/">Return to your dashboard</Link>.
        </UiAlert>
      </UiProvider>
    );
  }

  if (status === "error") {
    return (
      <UiProvider style={{ maxWidth: 480, margin: "48px auto", padding: 16 }}>
        <UiAlert tone="danger" title="Something went wrong">
          Could not verify access. Refresh to try again.
        </UiAlert>
      </UiProvider>
    );
  }

  return (
    <UiProvider className="aims-admin-shell">
      <AdminNav />
      <main className="adminMain">{children}</main>
    </UiProvider>
  );
}

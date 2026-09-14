"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UIProvider as UiProvider, LoadingSpinner as UiSpinner, Alert as UiAlert, Typography as UiTypography } from "../components/ui";
import { AuthApiError, authApiGet } from "../lib/auth-api";

type Status = "checking" | "ready" | "forbidden" | "error";

function AdminNav() {
  return (
    <nav
      aria-label="Finance Master console"
      style={{ width: 220, flexShrink: 0, borderRight: "1px solid #ddd", padding: "24px 16px", boxSizing: "border-box" }}
    >
      <UiTypography as="h2" variant="section" style={{ marginBottom: 16 }}>
        Finance Master
      </UiTypography>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <li><Link href="/admin">Console</Link></li>
        <li><Link href="/admin/users">User Management</Link></li>
        <li><Link href="/admin/roles">Roles</Link></li>
        <li><Link href="/admin/permissions">Permission matrix</Link></li>
        <li><Link href="/admin/master-data">Master Data</Link></li>
        <li><Link href="/admin/settings">Business Configuration</Link></li>
        <li><Link href="/admin/approval-matrix">Approval Matrix</Link></li>
        <li><Link href="/admin/delegation">Approval Delegation</Link></li>
        <li><Link href="/admin/notifications">Notifications</Link></li>
      </ul>
      <div style={{ marginTop: 32 }}>
        <Link href="/">&larr; Back to AIMS</Link>
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
    <UiProvider className="aims-admin-shell" style={{ display: "flex", minHeight: "100vh" }}>
      <AdminNav />
      <main style={{ flex: 1, padding: 32, boxSizing: "border-box" }}>{children}</main>
    </UiProvider>
  );
}

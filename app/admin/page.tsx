"use client";

import Link from "next/link";
import { Card as UiCard, CardBody as UiCardBody, PageHeader as UiPageHeader, Typography as UiTypography } from "../components/ui";

export default function AdminConsolePage() {
  return (
    <div>
      <UiPageHeader title="Finance Master console" description="Business administration for AIMS." />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
        <UiCard>
          <UiCardBody>
            <UiTypography as="h3" variant="card">
              <Link href="/admin/users">User Management</Link>
            </UiTypography>
            <UiTypography>Create accounts, assign roles, and manage account status.</UiTypography>
          </UiCardBody>
        </UiCard>
        <UiCard>
          <UiCardBody>
            <UiTypography as="h3" variant="card">
              <Link href="/admin/roles">Roles</Link>
            </UiTypography>
            <UiTypography>Create, edit, disable, and clone roles.</UiTypography>
          </UiCardBody>
        </UiCard>
        <UiCard>
          <UiCardBody>
            <UiTypography as="h3" variant="card">
              <Link href="/admin/permissions">Permission matrix</Link>
            </UiTypography>
            <UiTypography>Assign permissions to roles. Effective permission is the union of a user&apos;s roles.</UiTypography>
          </UiCardBody>
        </UiCard>
        <UiCard>
          <UiCardBody>
            <UiTypography as="h3" variant="card">
              <Link href="/admin/master-data">Master Data</Link>
            </UiTypography>
            <UiTypography>Manage categories, departments, projects, currencies, and payment methods.</UiTypography>
          </UiCardBody>
        </UiCard>
        <UiCard>
          <UiCardBody>
            <UiTypography as="h3" variant="card">
              <Link href="/admin/settings">Business Configuration</Link>
            </UiTypography>
            <UiTypography>Company, Finance, Numbering, AI, Notification, and System settings — draft, preview, and publish without a deployment.</UiTypography>
          </UiCardBody>
        </UiCard>
      </div>
    </div>
  );
}

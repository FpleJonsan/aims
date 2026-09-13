"use client";

import Link from "next/link";
import { Card as UiCard, CardBody as UiCardBody, PageHeader as UiPageHeader, Typography as UiTypography } from "../components/ui";

export default function AdminConsolePage() {
  return (
    <div>
      <UiPageHeader title="Finance Master console" description="Business administration for AIMS." />
      <UiCard style={{ maxWidth: 480 }}>
        <UiCardBody>
          <UiTypography as="h3" variant="card">
            <Link href="/admin/users">User Management</Link>
          </UiTypography>
          <UiTypography>Create accounts, assign roles, and manage account status.</UiTypography>
        </UiCardBody>
      </UiCard>
    </div>
  );
}

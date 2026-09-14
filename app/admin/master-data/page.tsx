"use client";

import Link from "next/link";
import { Card as UiCard, CardBody as UiCardBody, PageHeader as UiPageHeader, Typography as UiTypography } from "../../components/ui";

const MODULES = [
  { href: "/admin/master-data/categories", label: "Categories", description: "Payment request categories." },
  { href: "/admin/master-data/departments", label: "Departments", description: "Definitional department list for future settings." },
  { href: "/admin/master-data/projects", label: "Projects", description: "Project reference list for future settings." },
  { href: "/admin/master-data/currencies", label: "Currencies", description: "Currencies accepted on payment requests." },
  { href: "/admin/master-data/payment-methods", label: "Payment Methods", description: "Payment methods accepted on payment requests." },
] as const;

export default function MasterDataConsolePage() {
  return (
    <div>
      <UiPageHeader title="Master Data" description="The reusable reference-data platform future Company, Finance, Workflow, and AI settings will consume." />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
        {MODULES.map((module) => (
          <UiCard key={module.href}>
            <UiCardBody>
              <UiTypography as="h3" variant="card">
                <Link href={module.href}>{module.label}</Link>
              </UiTypography>
              <UiTypography>{module.description}</UiTypography>
            </UiCardBody>
          </UiCard>
        ))}
      </div>
    </div>
  );
}

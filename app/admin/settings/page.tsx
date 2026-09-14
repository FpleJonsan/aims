"use client";

import Link from "next/link";
import { Card as UiCard, CardBody as UiCardBody, PageHeader as UiPageHeader, Typography as UiTypography } from "../../components/ui";

const SECTIONS = [
  { href: "/admin/settings/company", label: "Company Settings", description: "Identity, locale, calendar, and default currency." },
  { href: "/admin/settings/finance", label: "Finance Settings", description: "Defaults, limits, and remark templates." },
  { href: "/admin/settings/numbering", label: "Business Numbering", description: "Document numbering rules per document type." },
  { href: "/admin/settings/ai", label: "AI Configuration", description: "Business-facing AI provider, model, and feature toggles." },
  { href: "/admin/settings/notifications", label: "Notification Settings", description: "Telegram reminders and escalation timing." },
  { href: "/admin/settings/system", label: "System Parameters", description: "Operational limits and feature kill switches." },
  { href: "/admin/settings/version-history", label: "Version history", description: "Every published configuration change, with rollback." },
];

export default function BusinessConfigurationConsolePage() {
  return (
    <div>
      <UiPageHeader title="Business Configuration" description="Enterprise settings platform. Draft, validate, preview, and publish — nothing here requires a code deployment." />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 480 }}>
        {SECTIONS.map((section) => (
          <UiCard key={section.href}>
            <UiCardBody>
              <UiTypography as="h3" variant="card">
                <Link href={section.href}>{section.label}</Link>
              </UiTypography>
              <UiTypography>{section.description}</UiTypography>
            </UiCardBody>
          </UiCard>
        ))}
      </div>
    </div>
  );
}

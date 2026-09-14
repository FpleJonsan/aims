/** Narrow shape both `Postgres.pool` and a transaction's `PoolClient` satisfy. */
export interface Queryable {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * P20.5D Business Configuration Platform. Every settings category (Company,
 * Finance, Business Numbering, AI, Notifications, System Parameters) is
 * stored as one JSON payload per category in a single shared table, versioned
 * through the same Draft -> Validate -> Preview -> Publish -> Version
 * pipeline. This mirrors the P20.5C Master Data pattern of "one generic
 * engine, many thin configs" instead of one bespoke table/service per
 * category.
 */
export const CONFIGURATION_CATEGORIES = ["company", "finance", "numbering", "ai", "notifications", "system"] as const;
export type ConfigurationCategory = (typeof CONFIGURATION_CATEGORIES)[number];

export function isConfigurationCategory(value: string): value is ConfigurationCategory {
  return (CONFIGURATION_CATEGORIES as readonly string[]).includes(value);
}

export type ConfigurationVersionRow = {
  id: string;
  category: string;
  version: number | null;
  status: "draft" | "published";
  payload: Record<string, unknown>;
  reason: string | null;
  changed_by: string | null;
  changed_by_display_name_snapshot: string | null;
  changed_by_role_snapshot: string[] | null;
  source_ip: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type NumberingRule = {
  prefix: string;
  includeCompanyPrefix: boolean;
  companyPrefix: string | null;
  includeDepartmentPrefix: boolean;
  includeYear: boolean;
  includeMonth: boolean;
  sequenceLength: number;
  leadingZero: boolean;
  restartYearly: boolean;
  restartMonthly: boolean;
};

export const NUMBERING_DOCUMENT_TYPES = ["PAYMENT_REQUEST", "CLAIM", "APPROVAL", "PAYMENT", "SUPPORT"] as const;
export type NumberingDocumentType = (typeof NUMBERING_DOCUMENT_TYPES)[number];

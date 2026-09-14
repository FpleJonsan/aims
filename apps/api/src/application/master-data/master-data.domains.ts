import type { MasterDataDomainConfig, MasterDataRow, Queryable } from "./master-data.types.js";

export const CATEGORIES_MASTER_DATA = "CATEGORIES_MASTER_DATA";
export const DEPARTMENTS_MASTER_DATA = "DEPARTMENTS_MASTER_DATA";
export const PROJECTS_MASTER_DATA = "PROJECTS_MASTER_DATA";
export const CURRENCIES_MASTER_DATA = "CURRENCIES_MASTER_DATA";
export const PAYMENT_METHODS_MASTER_DATA = "PAYMENT_METHODS_MASTER_DATA";

async function countMatching(client: Queryable, sql: string, value: string): Promise<number> {
  const result = await client.query<{ count: string }>(sql, [value]);
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Every referenceCount probe below is a read-only, name/code text match
 * against existing operational data — never a foreign key, so it can never
 * block a write and never requires a migration. Categories and Payment
 * Methods are free text on payment_requests; Currencies match the fixed
 * CURRENCIES allowlist in payment-request.dto.ts by code; Departments
 * cross-references the separate, untouched legacy `departments` table by
 * name purely for information. Projects has no existing source yet.
 */
export const CATEGORIES_CONFIG: MasterDataDomainConfig = {
  table: "master_data_categories",
  entityPrefix: "CATEGORY",
  referenceCount: (client, row: MasterDataRow) =>
    countMatching(client, `SELECT count(*) count FROM payment_requests WHERE category ILIKE $1`, row.name),
};

export const DEPARTMENTS_CONFIG: MasterDataDomainConfig = {
  table: "master_data_departments",
  entityPrefix: "DEPARTMENT",
  referenceCount: (client, row: MasterDataRow) =>
    countMatching(
      client,
      `SELECT count(DISTINCT u.id) count FROM users u JOIN departments d ON d.id = u.department_id WHERE d.name ILIKE $1`,
      row.name,
    ),
};

export const PROJECTS_CONFIG: MasterDataDomainConfig = {
  table: "master_data_projects",
  entityPrefix: "PROJECT",
};

export const CURRENCIES_CONFIG: MasterDataDomainConfig = {
  table: "master_data_currencies",
  entityPrefix: "CURRENCY",
  referenceCount: (client, row: MasterDataRow) =>
    countMatching(client, `SELECT count(*) count FROM payment_requests WHERE currency = $1`, row.code),
};

export const PAYMENT_METHODS_CONFIG: MasterDataDomainConfig = {
  table: "master_data_payment_methods",
  entityPrefix: "PAYMENT_METHOD",
  referenceCount: (client, row: MasterDataRow) =>
    countMatching(client, `SELECT count(*) count FROM payment_requests WHERE payment_method = $1`, row.code),
};

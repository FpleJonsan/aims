/** Narrow shape both `Postgres.pool` and a transaction's `PoolClient` satisfy, so reference-count probes work identically inside or outside a transaction. */
export interface Queryable {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * One row shape shared by every P20.5C master-data domain. Each domain gets
 * its own physical table (never a shared polymorphic table) so a future
 * phase can add domain-specific columns without disturbing the others, but
 * every table starts with this identical column set and every domain is
 * served by the same MasterDataService — only the table name and the
 * optional reference-count probe differ.
 */
export type MasterDataRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_default: boolean;
  active: boolean;
  deleted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export interface MasterDataDomainConfig {
  /** Physical table name. Always a literal from the fixed set below — never derived from request input. */
  table: string;
  /** Audit action / entity_type prefix, e.g. "CATEGORY" -> CATEGORY_CREATED, entity_type MASTER_DATA_CATEGORY. */
  entityPrefix: string;
  /**
   * Optional read-only cross-check against existing operational data this
   * phase must not modify (payment_requests, the legacy departments table,
   * ...). Purely informational: no foreign key is created, so this can
   * never fail a write and never blocks anything but a soft-delete.
   */
  referenceCount?: (client: Queryable, row: MasterDataRow) => Promise<number>;
}

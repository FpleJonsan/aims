/** Narrow shape both `Postgres.pool` and a transaction's `PoolClient` satisfy. */
export interface Queryable {
  query<T = unknown>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

export type ApprovalMatrixVersionRow = {
  id: string;
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

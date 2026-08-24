BEGIN;
ALTER TABLE finance_context_snapshots DROP CONSTRAINT finance_context_snapshots_check;
ALTER TABLE finance_context_snapshots ADD CONSTRAINT finance_context_snapshots_check
  CHECK ((status='EXCEPTION' AND exception_code IS NOT NULL)
    OR (status='COMPLETED' AND exception_code IS NULL)
    OR status='SUPERSEDED');
CREATE OR REPLACE FUNCTION reject_financial_ledger_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'financial ledger entries are append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS financial_ledger_entries_append_only ON financial_ledger_entries;
CREATE TRIGGER financial_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON financial_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_financial_ledger_mutation();
REVOKE UPDATE ON finance_context_snapshots FROM aims_app;
GRANT UPDATE(status,is_current) ON finance_context_snapshots TO aims_app;
COMMIT;

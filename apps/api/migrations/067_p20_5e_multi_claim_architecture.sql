BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=66 AND migration_id='066_p20_5d_business_configuration_platform') THEN
  RAISE EXCEPTION 'migration 067 requires schema version 66 (066_p20_5d_business_configuration_platform)';
 END IF;
END;
$$;

-- P20.5E: Multi Claim Architecture. Payment Request remains the aggregate
-- root; the 12-stage workflow and Validation/Finance Context/Financial
-- Analysis/Policy/Approval/Finance Control/Payment/History/Export/Dashboard
-- all stay Payment-Request-scoped and untouched in shape. Claim Items are
-- new child rows holding per-invoice accounting detail. The existing
-- payment_requests.amount/currency/category columns become derived
-- aggregates, kept in sync by a trigger on claim_items -- this lets every
-- existing downstream trigger (invalidate_day7_for_material_request_change,
-- guard_paid_request, record_payment()) keep working unmodified against the
-- parent row instead of being rewritten to read from the child table.
--
-- Currency must be uniform across a request's active claim items: there is
-- still exactly one Payment per Payment Request (no partial payment, no
-- exchange rate -- both explicitly out of scope), so a single payment
-- amount cannot span currencies. Category and department MAY differ per
-- claim item (each is recorded for accounting detail only); the parent's
-- derived category becomes 'MIXED' when claims disagree, which Finance
-- Context's existing single-bucket budget lookup will not match by
-- design -- until per-category budget checking is explicitly requested in
-- a future phase, a mixed-category request fails closed at Finance Context
-- rather than silently misallocating budget.

CREATE TABLE claim_items (
  id uuid PRIMARY KEY,
  payment_request_id uuid NOT NULL REFERENCES payment_requests(id),
  invoice_number varchar(100),
  invoice_date date,
  category varchar(100) NOT NULL,
  project_id uuid REFERENCES master_data_projects(id),
  department_id uuid NOT NULL REFERENCES departments(id),
  currency char(3) NOT NULL,
  amount numeric(19,4) NOT NULL CHECK (amount > 0),
  tax_amount numeric(19,4) CHECK (tax_amount IS NULL OR tax_amount >= 0),
  description varchar(1000),
  remark varchar(2000),
  payment_method varchar(64),
  display_order integer NOT NULL DEFAULT 0,
  internal_status varchar(24) NOT NULL DEFAULT 'ACTIVE' CHECK (internal_status IN ('ACTIVE','REMOVED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1
);

CREATE INDEX claim_items_request_order_idx ON claim_items (payment_request_id, display_order);
CREATE INDEX claim_items_request_active_idx ON claim_items (payment_request_id) WHERE internal_status = 'ACTIVE';

-- Attachments stay on payment_documents (re-parented, not duplicated): each
-- document keeps its existing payment_request_id and additionally gains an
-- optional claim_item_id, so every request-level query already in place
-- keeps working while new code can scope to one claim.
ALTER TABLE payment_documents ADD COLUMN claim_item_id uuid REFERENCES claim_items(id);
CREATE INDEX payment_documents_claim_item_idx ON payment_documents (claim_item_id) WHERE removed_at IS NULL;

ALTER TABLE payment_requests
  ADD COLUMN total_tax_amount numeric(19,4),
  ADD COLUMN claim_count integer NOT NULL DEFAULT 0,
  ADD COLUMN attachment_count integer NOT NULL DEFAULT 0;

-- Backfill: exactly one Claim Item per historical Payment Request that had
-- already captured scalar data (amount/currency/category all present -- a
-- request still in blank DRAFT has none of these and correctly starts with
-- zero Claim Items under the new model too, same as a freshly created
-- draft). Historical Payment Request IDs are untouched; no data is lost.
INSERT INTO claim_items (id, payment_request_id, category, department_id, currency, amount, description, remark, payment_method, display_order, internal_status, created_by, created_at, updated_at)
SELECT gen_random_uuid(), id, category, department_id, currency, amount, purpose, remark, payment_method, 0, 'ACTIVE', created_by, created_at, updated_at
FROM payment_requests
WHERE amount IS NOT NULL AND currency IS NOT NULL AND category IS NOT NULL;

UPDATE payment_documents d SET claim_item_id = c.id
FROM claim_items c WHERE c.payment_request_id = d.payment_request_id;

UPDATE payment_requests r SET
  claim_count = (SELECT count(*) FROM claim_items c WHERE c.payment_request_id = r.id AND c.internal_status = 'ACTIVE'),
  attachment_count = (SELECT count(*) FROM payment_documents d WHERE d.payment_request_id = r.id AND d.removed_at IS NULL);

-- Currency must be uniform across a request's active Claim Items.
CREATE OR REPLACE FUNCTION enforce_claim_item_currency_uniform() RETURNS trigger AS $$
BEGIN
  IF NEW.internal_status = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM claim_items c
    WHERE c.payment_request_id = NEW.payment_request_id AND c.internal_status = 'ACTIVE'
      AND c.id <> NEW.id AND c.currency <> NEW.currency
  ) THEN
    RAISE EXCEPTION 'all claim items on a payment request must share one currency';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_items_currency_uniform
BEFORE INSERT OR UPDATE OF currency, internal_status ON claim_items
FOR EACH ROW EXECUTE FUNCTION enforce_claim_item_currency_uniform();

-- Claim items become immutable once the parent request is PAID, matching
-- guard_paid_documents()'s existing rule for attachments.
CREATE OR REPLACE FUNCTION guard_paid_claim_items() RETURNS trigger AS $$
DECLARE request_id uuid;
BEGIN
  request_id := COALESCE(NEW.payment_request_id, OLD.payment_request_id);
  IF EXISTS (SELECT 1 FROM payment_requests WHERE id = request_id AND status = 'PAID') THEN
    RAISE EXCEPTION 'claim items for PAID requests are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_items_paid_guard
BEFORE INSERT OR UPDATE OR DELETE ON claim_items
FOR EACH ROW EXECUTE FUNCTION guard_paid_claim_items();

-- Derive-and-sync: the parent's amount/currency/category and the new
-- totals are recomputed from active Claim Items after every change. This
-- keeps every existing trigger and function that reads these columns
-- (invalidate_day7_for_material_request_change, guard_paid_request,
-- record_payment) working unmodified.
CREATE OR REPLACE FUNCTION sync_payment_request_claim_aggregates() RETURNS trigger AS $$
DECLARE request_id uuid; DECLARE totals record;
BEGIN
  request_id := COALESCE(NEW.payment_request_id, OLD.payment_request_id);
  SELECT
    count(*) AS claim_count,
    sum(amount) AS total_amount,
    sum(tax_amount) AS total_tax,
    (CASE WHEN count(DISTINCT category) = 1 THEN min(category) ELSE 'MIXED' END) AS category,
    min(currency) AS currency
  INTO totals
  FROM claim_items WHERE payment_request_id = request_id AND internal_status = 'ACTIVE';

  UPDATE payment_requests SET
    amount = totals.total_amount,
    currency = totals.currency,
    category = totals.category,
    total_tax_amount = totals.total_tax,
    claim_count = COALESCE(totals.claim_count, 0),
    updated_at = now(),
    row_version = row_version + 1
  WHERE id = request_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_items_sync_request_aggregates
AFTER INSERT OR UPDATE OR DELETE ON claim_items
FOR EACH ROW EXECUTE FUNCTION sync_payment_request_claim_aggregates();

-- Attachment count is derived from payment_documents directly (a document
-- always carries payment_request_id, whether or not it is also claim-scoped).
CREATE OR REPLACE FUNCTION sync_payment_request_attachment_count() RETURNS trigger AS $$
DECLARE request_id uuid;
BEGIN
  request_id := COALESCE(NEW.payment_request_id, OLD.payment_request_id);
  UPDATE payment_requests SET attachment_count = (
    SELECT count(*) FROM payment_documents WHERE payment_request_id = request_id AND removed_at IS NULL
  ) WHERE id = request_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_documents_sync_attachment_count
AFTER INSERT OR UPDATE OF removed_at OR DELETE ON payment_documents
FOR EACH ROW EXECUTE FUNCTION sync_payment_request_attachment_count();

GRANT SELECT, INSERT, UPDATE ON claim_items TO aims_app;
GRANT UPDATE(claim_item_id) ON payment_documents TO aims_app;

UPDATE aims_schema_version SET version=67,migration_id='067_p20_5e_multi_claim_architecture',applied_at=now() WHERE singleton=true AND version=66;
COMMIT;

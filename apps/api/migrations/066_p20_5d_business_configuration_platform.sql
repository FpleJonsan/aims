BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=65 AND migration_id='065_p20_5c_master_data_foundation') THEN
  RAISE EXCEPTION 'migration 066 requires schema version 65 (065_p20_5c_master_data_foundation)';
 END IF;
END;
$$;

-- P20.5D: Business Configuration Platform. One shared, versioned table for
-- every enterprise settings category (Company, Finance, Business Numbering,
-- AI, Notifications, System Parameters), following the Draft -> Validate ->
-- Preview -> Publish -> Version lifecycle. Each category's field shape is a
-- JSON payload validated in application code (configuration.schemas.ts), not
-- a fixed column set, since the categories differ widely in shape and future
-- fields must not require a migration. No existing table (payment_requests,
-- approval, workflow, claim_items, master_data_*, roles/permissions) is
-- touched or referenced by foreign key; Master Data existence is checked at
-- validate/publish time only, exactly like Master Data's own referenceCount
-- probes, so this can never block or cascade into those tables.
CREATE TABLE configuration_versions (
  id uuid PRIMARY KEY,
  category varchar(40) NOT NULL,
  version integer,
  status varchar(16) NOT NULL DEFAULT 'draft',
  payload jsonb NOT NULL,
  reason varchar(500),
  changed_by uuid REFERENCES users(id),
  changed_by_display_name_snapshot varchar(160),
  changed_by_role_snapshot varchar(32)[],
  source_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT configuration_versions_category_chk CHECK (category IN ('company','finance','numbering','ai','notifications','system')),
  CONSTRAINT configuration_versions_status_chk CHECK (status IN ('draft','published')),
  CONSTRAINT configuration_versions_published_version_chk CHECK (status='draft' OR version IS NOT NULL)
);

-- At most one working draft per category at a time.
CREATE UNIQUE INDEX configuration_versions_one_draft_per_category_idx ON configuration_versions (category) WHERE status='draft';
-- Published version numbers are unique and sequential per category.
CREATE UNIQUE INDEX configuration_versions_category_version_idx ON configuration_versions (category, version) WHERE status='published';
CREATE INDEX configuration_versions_category_idx ON configuration_versions (category, status);

GRANT SELECT ON configuration_versions TO aims_app;
GRANT INSERT ON configuration_versions TO aims_app;
GRANT UPDATE(payload,status,version,reason,changed_by,changed_by_display_name_snapshot,changed_by_role_snapshot,source_ip,updated_at,published_at) ON configuration_versions TO aims_app;
GRANT DELETE ON configuration_versions TO aims_app;

UPDATE aims_schema_version SET version=66,migration_id='066_p20_5d_business_configuration_platform',applied_at=now() WHERE singleton=true AND version=65;
COMMIT;

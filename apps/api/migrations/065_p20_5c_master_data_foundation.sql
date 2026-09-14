BEGIN;

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM aims_schema_version WHERE singleton=true AND version=64 AND migration_id='064_p21_role_permission_matrix') THEN
  RAISE EXCEPTION 'migration 065 requires schema version 64 (064_p21_role_permission_matrix)';
 END IF;
END;
$$;

-- P20.5C: Enterprise Master Data Foundation. Five independent, identically
-- shaped tables (Categories, Departments, Projects, Currencies, Payment
-- Methods) for future phases (Company/Finance/Workflow/AI Settings, Approval
-- Matrix, Business Numbering, ...) to consume. This phase only builds the
-- reusable platform: no foreign key is added from any existing business
-- table to these, no data is migrated, and no existing table is touched.
-- The legacy `departments` table (users.department_id,
-- payment_requests.department_id) is untouched and remains authoritative for
-- those relationships; master_data_departments is a separate, forward-looking
-- definitional list until a later phase performs an explicit, reviewed cutover.

CREATE TABLE master_data_categories (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  description varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX master_data_categories_code_idx ON master_data_categories (code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX master_data_categories_name_idx ON master_data_categories (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE master_data_departments (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  description varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX master_data_departments_code_idx ON master_data_departments (code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX master_data_departments_name_idx ON master_data_departments (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE master_data_projects (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  description varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX master_data_projects_code_idx ON master_data_projects (code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX master_data_projects_name_idx ON master_data_projects (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE master_data_currencies (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  description varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX master_data_currencies_code_idx ON master_data_currencies (code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX master_data_currencies_name_idx ON master_data_currencies (lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE master_data_payment_methods (
  id uuid PRIMARY KEY,
  code varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  description varchar(500),
  sort_order integer NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  deleted_at timestamptz,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX master_data_payment_methods_code_idx ON master_data_payment_methods (code) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX master_data_payment_methods_name_idx ON master_data_payment_methods (lower(name)) WHERE deleted_at IS NULL;

-- Seed only where an existing, already-live value set gives the seed real
-- meaning (so Reference Count is non-trivial from day one); Categories,
-- Departments, and Projects have no such fixed source today (category and
-- payment method are free text; departments already has its own live table)
-- so they start empty for Finance Master to populate. created_by/updated_by
-- are nullable specifically so this system seed does not depend on a user
-- already existing at migration time (migrations run before any seed step).
INSERT INTO master_data_currencies(id,code,name,sort_order,is_default)
VALUES (gen_random_uuid(),'MYR','Malaysian Ringgit',0,true),(gen_random_uuid(),'USD','US Dollar',1,false),
  (gen_random_uuid(),'SGD','Singapore Dollar',2,false),(gen_random_uuid(),'EUR','Euro',3,false),(gen_random_uuid(),'GBP','British Pound',4,false);

INSERT INTO master_data_payment_methods(id,code,name,sort_order,is_default)
VALUES (gen_random_uuid(),'BANK_TRANSFER','Bank transfer',0,true),(gen_random_uuid(),'CARD','Corporate card',1,false),(gen_random_uuid(),'CASH','Cash',2,false);

GRANT SELECT ON master_data_categories, master_data_departments, master_data_projects, master_data_currencies, master_data_payment_methods TO aims_app;
GRANT INSERT ON master_data_categories, master_data_departments, master_data_projects, master_data_currencies, master_data_payment_methods TO aims_app;
GRANT UPDATE(name,description,sort_order,is_default,active,deleted_at,updated_by,updated_at)
  ON master_data_categories, master_data_departments, master_data_projects, master_data_currencies, master_data_payment_methods TO aims_app;

UPDATE aims_schema_version SET version=65,migration_id='065_p20_5c_master_data_foundation',applied_at=now() WHERE singleton=true AND version=64;
COMMIT;

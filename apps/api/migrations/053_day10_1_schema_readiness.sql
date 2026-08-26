BEGIN;

CREATE TABLE aims_schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version integer NOT NULL CHECK (version > 0),
  migration_id varchar(160) NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO aims_schema_version(singleton,version,migration_id)
VALUES(true,53,'053_day10_1_schema_readiness');

REVOKE ALL ON aims_schema_version FROM PUBLIC;
GRANT SELECT ON aims_schema_version TO aims_app;

COMMIT;

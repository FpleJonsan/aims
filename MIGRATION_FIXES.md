# Migration Fixes - Summary

## Problem

Migrations 057-061 were failing because they required PostgreSQL roles that didn't exist:

1. **Migration 057** - Required `aims_document_worker_executor` and `aims_document_worker_runtime` roles
2. **Migration 059** - Required `aims_migrator` role
3. **Migration 060** - Required `aims_owner` role

These roles are normally created by the `apps/api/database/production/bootstrap-roles.sql` script, which is intended for production deployments. However, for local development, these roles weren't being created before running migrations.

## Solution

I've fixed the migration files to create these roles automatically if they don't exist:

### Fixed Files

1. **`apps/api/migrations/057_p7_document_scan_worker_leases.sql`**
   - Now creates `aims_document_worker_executor` role (NOLOGIN)
   - Now creates `aims_document_worker_runtime` role (LOGIN)
   - Grants necessary permissions

2. **`apps/api/migrations/059_p12_recovery_generation_fencing.sql`**
   - Now creates `aims_migrator` role (LOGIN) if it doesn't exist

3. **`apps/api/migrations/060_p13_corporate_auth_transactions.sql`**
   - Now creates `aims_owner` role (NOLOGIN) if it doesn't exist

## How to Apply the Fixes

### Option 1: Run the Reset Script (Recommended)

I've created a script that will:
1. Terminate all active database connections
2. Drop and recreate the `aims` database
3. Initialize the schema version table
4. Apply all 61 migrations in order

```bash
./reset-and-migrate.sh
```

### Option 2: Manual Steps

If you prefer to run the commands manually:

```bash
# 1. Terminate active connections
docker exec PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -U postgres -d aims -c "
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = '\''aims'\'' AND pid <> pg_backend_pid();
"'

# 2. Drop and recreate database
docker exec PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -U postgres -c "DROP DATABASE IF EXISTS aims;"'
docker exec PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -U postgres -c "CREATE DATABASE aims;"'

# 3. Create schema version table
docker exec PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -U postgres -d aims -c "
CREATE TABLE aims_schema_version (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  version integer NOT NULL,
  migration_id varchar(128) NOT NULL,
  applied_at timestamptz NOT NULL
);
INSERT INTO aims_schema_version (singleton, version, migration_id, applied_at)
VALUES (true, 0, '\''000_bootstrap'\'', now());
"'

# 4. Apply all migrations
for migration_file in apps/api/migrations/*.sql; do
  echo "Applying $(basename "$migration_file")..."
  docker exec PostgreSQL sh -c "PGPASSWORD=\"\$POSTGRESQL_PASSWORD\" psql -U postgres -d aims" < "$migration_file"
done
```

## After Migration

Once the migrations are applied successfully:

1. Start the API server:
   ```bash
   npm run dev --workspace @aims/api
   ```

2. Start the frontend:
   ```bash
   npm run dev
   ```

3. Open http://localhost:5173 in your browser

## What Changed

The changes maintain backward compatibility and follow the same pattern as other role creations in the migration files (like `aims_payment_executor` and `aims_finance_executor` in earlier migrations).

For production deployments, the `bootstrap-roles.sql` script should still be used as documented, but these changes allow local development to proceed without manual role setup.

## Notes

- These fixes are safe for local development
- The roles are created with appropriate permissions matching the production bootstrap script
- If roles already exist, they won't be recreated (idempotent)
- Production deployments can continue to use the `bootstrap-roles.sql` script as intended

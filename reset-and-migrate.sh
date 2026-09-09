#!/bin/bash
set -e

echo "=== Resetting AIMS Database ==="

# Step 1: Terminate all connections to the aims database
echo "Step 1: Terminating all active connections..."
docker exec PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -U postgres -d aims -c "
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = '\''aims'\'' AND pid <> pg_backend_pid();
"'

# Step 2: Drop and recreate the aims database
echo "Step 2: Dropping and recreating aims database..."
docker exec PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -U postgres -c "DROP DATABASE IF EXISTS aims;"'
docker exec PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -U postgres -c "CREATE DATABASE aims;"'

# Step 3: Create schema version table
echo "Step 3: Creating schema version table..."
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

# Step 4: Apply all migrations in order
echo "Step 4: Applying migrations..."
for migration_file in apps/api/migrations/*.sql; do
  echo "Applying $(basename "$migration_file")..."
  docker exec PostgreSQL sh -c "PGPASSWORD=\"\$POSTGRESQL_PASSWORD\" psql -U postgres -d aims" < "$migration_file"
  if [ $? -ne 0 ]; then
    echo "❌ Migration failed: $(basename "$migration_file")"
    exit 1
  fi
done

echo "✅ All migrations applied successfully!"
echo ""
echo "You can now start the API server with:"
echo "  npm run dev --workspace @aims/api"

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

# Step 3: Bootstrap roles/connect privileges for the new database.
echo "Step 3: Bootstrapping database roles..."
docker exec -i PostgreSQL sh -c 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -v ON_ERROR_STOP=1 -U postgres -d aims -v DBNAME=aims' < apps/api/database/production/bootstrap-roles.sql

# Step 4: Apply all migrations as aims_owner (required for SECURITY DEFINER ownership).
# docker exec requires -i so the redirected SQL file reaches psql stdin.
echo "Step 4: Applying migrations as aims_owner..."
for migration_file in apps/api/migrations/*.sql; do
  echo "Applying $(basename "$migration_file")..."
  if ! docker exec -i PostgreSQL sh -c "PGPASSWORD=\"\$POSTGRESQL_PASSWORD\" psql -v ON_ERROR_STOP=1 -U postgres -d aims" <<EOF
SET ROLE aims_owner;
$(cat "$migration_file")
RESET ROLE;
EOF
  then
    echo "❌ Migration failed: $(basename "$migration_file")"
    exit 1
  fi
done

echo "✅ All migrations applied successfully!"
echo ""
echo "You can now start:"
echo "  npm run dev --workspace @aims/api"
echo "  npm run dev:worker --workspace @aims/api"
echo "  npm run dev"

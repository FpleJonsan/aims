# AIMS Local Development

## PostgreSQL application role

The application must not connect as the PostgreSQL administrative user. The current local container already provides the restricted `aims_app` role used by `.env.example`.

1. Open an administrative PostgreSQL session inside the existing Docker container. This uses the container's injected password without printing it or placing it in shell history:

   ```bash
   docker exec -it PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_PASSWORD" psql -h 127.0.0.1 -U root -d aims'
   ```

2. Inspect the application role:

   ```sql
   SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
   FROM pg_roles
   WHERE rolname = 'aims_app';
   ```

3. Confirm that the result reports `false` for superuser, database creation, role creation, and replication. If the role is absent or excessive authority is reported, stop and use the container's bootstrap administrator or initialization mechanism to provision it. Do not grant role-management authority to the runtime application account.

4. Verify the effective database and schema privileges:

   ```sql
   SELECT has_database_privilege('aims_app', 'aims', 'CONNECT');
   SELECT has_schema_privilege('aims_app', 'public', 'USAGE');
   SELECT has_schema_privilege('aims_app', 'public', 'CREATE');
   ```

   The expected results are `true`, `true`, and `false` respectively.

5. Migrations must grant privileges per table or per narrowly scoped schema. Never grant blanket update or delete authority over all current or future tables. In particular:

   - audit events, financial ledger entries, approval snapshots, policy versions, and payment history must not grant general `UPDATE` or `DELETE`
   - append-only tables may grant only the inserts and reads required by their owning service
   - mutable workflow tables receive only the specific operations required by their domain repository
   - migrations and administrative corrections use a separate privileged connection that is never available to the running API

Use the administrative account only for reviewed migrations and maintenance. Put the `aims_app` password in the ignored `.env`; never commit it.

## Local document storage

Development documents are written below `storage/documents/quarantine`. A file remains quarantined until a later document workflow records successful malware scanning and validation. The hosted web application must not import the Node filesystem adapter; it belongs exclusively to the NestJS API runtime.

Production will provide an Amazon S3 implementation of the same `DocumentStorage` interface.

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

### Day 1 database setup

Apply the reviewed migrations in order with the container administrator. The runtime API still connects only as `aims_app` through `DATABASE_URL`:

```bash
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/001_day1_foundation.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/002_local_demo_seed.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/003_runtime_grants.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/004_day2_validation.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/005_day3_finance_context.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/006_day3_demo_finance_seed.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/007_day3_snapshot_constraint_hardening.sql
```

The seed contains synthetic local identities only: `demo.requester` and `demo.finance`. The API accepts `x-aims-user` only as the explicit local identity adapter. When `NODE_ENV=production`, requests are rejected unless `AUTH_TRUSTED_PROXY=true` and the deployment supplies this header through a trusted, stripping identity proxy.

Run the local API and web application in separate terminals:

```bash
npm run dev --workspace @aims/api
npm run dev
```

The Day 1 API listens on `127.0.0.1:3001`, exposes OpenAPI at `/openapi`, and stops at `SUBMITTED`. It does not dispatch requests into Validation.

Day 2 adds Validation without starting Finance Context. AI defaults OFF in `ai_feature_configuration`; `AI_MASTER` and `DOCUMENT_VALIDATION` must both be enabled before the Document Agent can call the configured server-side provider. `DOCUMENT_EXTRACTION` is independently recorded for operational control. With either required flag OFF, no provider call occurs and manual validation remains available. Run `npm run test:ai:live --workspace @aims/api` only when `OPENAI_API_KEY` is intentionally configured; the normal test suite never calls paid AI.

Day 3 adds deterministic Finance Context without starting Financial Risk Analysis. Currency values are stored and calculated as integer minor units. Available budget is revised budget minus actual spending minus active commitments; projected available further subtracts the current request. Cross-currency contexts fail with `CURRENCY_CONTEXT_UNSUPPORTED`; no FX value is inferred. Migration 006 contains synthetic local/demo budget data only and must not be treated as production configuration.

Run the Day 3 PostgreSQL suite with `npm run test:finance-context:integration --workspace @aims/api`.

## Local document storage

### Development/demo risk acceptance

Risk owner decision recorded 2026-08-22: malware scanning may be omitted for the local development and competition-demo filesystem only. This acceptance is valid only while all of the following remain true:

- files are trusted synthetic demo fixtures, not arbitrary public uploads
- no real invoices, receipts, payment evidence, personal data, or confidential finance records are stored
- the API is reachable only from the local development machine
- local files are non-authoritative and may be discarded after the demo
- `LOCAL_STORAGE_DEMO_MODE=true` is explicitly configured
- the local adapter refuses to initialize when `NODE_ENV=production`

Development documents are streamed into `storage/documents/quarantine`, checked for allowed file signatures and closing structure, and hashed with SHA-256. A scanner-aware promotion service remains available for testing, but a real malware engine is not required under this narrow local-demo acceptance. The hosted web application must not import the Node filesystem adapter; it belongs exclusively to the local NestJS API runtime.

This acceptance does not apply to staging or production. Amazon S3 storage, real uploaded documents, and any externally reachable deployment require a newly reviewed production storage contract with malware scanning, independent immutable objects, durable scan evidence, and no direct promotion bypass.

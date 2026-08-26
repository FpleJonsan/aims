# AIMS Local Development

## PostgreSQL application role

The application must not connect as the PostgreSQL administrative user. The normal pool uses restricted `aims_app`. Final Finance Control uses a separate server-only login that is a member of the `aims_finance_executor` NOLOGIN capability role through `FINANCE_DATABASE_URL`.

The trust chain is: HTTP authentication → server-supplied AIMS user → transaction-local database execution identity → database Finance authority check → constrained transition. `aims_app` is not a member of `aims_finance_executor`, cannot `SET ROLE` to it, has no Finance Control table writes, and cannot execute finalization functions.

Day 8 uses an independent `aims_payment_executor` NOLOGIN capability through the server-only `PAYMENT_DATABASE_URL`. Payment Operator authority is separate from Approval and Finance Control authority. The normal `aims_app` role cannot create payments, post actual ledger entries, consume commitments, attach payment slips, or synthesize `PAID`.

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

Apply every reviewed migration in lexical order with the container administrator. The runtime API still connects only as `aims_app` through `DATABASE_URL`:

```bash
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/001_day1_foundation.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/002_local_demo_seed.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/003_runtime_grants.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/004_day2_validation.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/005_day3_finance_context.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/006_day3_demo_finance_seed.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/007_day3_snapshot_constraint_hardening.sql
docker exec -i PostgreSQL sh -lc 'PGPASSWORD="$POSTGRESQL_POSTGRES_PASSWORD" psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U postgres -d aims' < apps/api/migrations/008_day4_financial_analysis.sql
```

Continue through the latest numbered file; [the migration inventory](MIGRATION-INVENTORY.md) is authoritative. A shell loop may be used only after reviewing its resolved file list and confirming the target database. Never run local/demo seed migrations against production.

The seed contains synthetic local identities only: `demo.requester` and `demo.finance`. The API accepts `x-aims-user` only as the explicit local identity adapter. When `NODE_ENV=production`, requests are rejected unless `AUTH_TRUSTED_PROXY=true` and the deployment supplies this header through a trusted, stripping identity proxy.

Run the local API and web application in separate terminals:

```bash
npm run dev --workspace @aims/api
npm run dev
```

The local API listens on `API_HOST`/`API_PORT` (defaults `127.0.0.1:3001`) and exposes OpenAPI at `/openapi` outside production. Use `/health/live` for process liveness and `/health/ready` for dependency/configuration readiness. Optional AI or Telegram being disabled is healthy; enabling either without its required configuration is not.

Day 2 adds Validation without starting Finance Context. AI defaults OFF in `ai_feature_configuration`; `AI_MASTER` and `DOCUMENT_VALIDATION` must both be enabled before the Document Agent can call the configured server-side provider. `DOCUMENT_EXTRACTION` is independently recorded for operational control. With either required flag OFF, no provider call occurs and manual validation remains available. Run `npm run test:ai:live --workspace @aims/api` only when `OPENAI_API_KEY` is intentionally configured; the normal test suite never calls paid AI.

Day 3 adds deterministic Finance Context without starting Financial Risk Analysis. Currency values are stored and calculated as integer minor units. Available budget is revised budget minus actual spending minus active commitments; projected available further subtracts the current request. Cross-currency contexts fail with `CURRENCY_CONTEXT_UNSUPPORTED`; no FX value is inferred. Migration 006 contains synthetic local/demo budget data only and must not be treated as production configuration.

Run the Day 3 PostgreSQL suite with `npm run test:finance-context:integration --workspace @aims/api`.

Day 4 adds manual-first, evidence-backed Financial Risk Analysis. Its three specialist AI flags default OFF, and `AI_MASTER` OFF guarantees zero financial-agent calls. AI-assisted results remain recommendations until Finance finalizes them. Run the PostgreSQL suite with `npm run test:financial-analysis:integration --workspace @aims/api`; the paid four-call provider smoke test is explicit opt-in through `npm run test:ai:financial-live`.

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

### Day 5 Policy & Decision

Apply `apps/api/migrations/009_day5_policy_decision.sql` to create the versioned deterministic policy model. For local development only, apply `010_day5_local_demo_policy.sql`; it is explicitly synthetic and must not be treated as production policy. Normal thresholds and approval-role requirements are managed through the Admin policy APIs, not application code or future migrations.

Policy selection uses the policy evaluation timestamp. A version is applicable when it is ACTIVE and its effective interval contains that timestamp. Equal-priority overlapping rules with conflicting effects are rejected during activation. Exception rules take precedence; otherwise approval requirements are additive and ordered by sequence, while exact duplicate role steps are collapsed deterministically.

Day 5 currently supports one organization-wide (`GLOBAL`) active policy version. Activation is serialized, retires the previous global version without rewriting historical decisions, and policy rules become database-immutable after activation. Explicitly retiring the only active version is allowed; subsequent evaluations produce the controlled `NO_APPLICABLE_POLICY` result until an Admin activates a replacement. A newer activation alone does not rewrite or stale an already completed decision because selection is fixed at evaluation time; a defined business event must request re-evaluation.

Policy decisions store a SHA-256 fingerprint of the exact sorted active evidence identity: document ID, logical document ID, version, document type, and content SHA-256. Active evidence additions, replacements, removals, and identity changes supersede the current decision; changes to already removed historical documents do not.

The database lock order for request workflow operations is: payment-request row first, then document/evidence and downstream decision rows. The evidence trigger acquires the same payment-request row lock, so direct evidence writes serialize with Policy evaluation. Policy administration uses a separate global-policy advisory lock and never acquires payment-request locks. Physical document deletion is forbidden; documents use logical removal/versioning. Equivalent concurrent `NO_APPLICABLE_POLICY` evaluations reuse one current decision.

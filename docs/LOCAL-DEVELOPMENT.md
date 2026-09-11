# AIMS Local Development

## Local setup

Prerequisites: Git, Docker with Docker Compose v2, and Node.js 22.13+ with npm. Docker provisions the database; no host PostgreSQL installation or manual SQL provisioning is needed.

```bash
git clone <your-AIMS-repository-url> aims
cd aims
npm install
npm run bootstrap
npm run local
```

`npm run bootstrap` runs the existing Compose startup, bootstrap, migration and seed commands in order, stopping on failure. It adds no separate bootstrap logic.

The bootstrap writes an ignored `.env.local` without overwriting an existing file. It uses distinct, **local-only** development passwords for the existing application, Finance, Payment, worker, and migrator roles. PostgreSQL is available on loopback port 55432 and Redis on 56379. Optional `AIMS_LOCAL_POSTGRES_PORT` and `AIMS_LOCAL_REDIS_PORT` overrides must be exported consistently before Compose and bootstrap. These containers use persistent project-scoped volumes.

After bootstrap, the canonical startup command is:

```bash
npm run local
```

It reads `.env.local`, checks PostgreSQL schema 61 and Redis, checks service ports, builds the API, then starts API, worker polling, and frontend independently. It reports ready only after API and worker readiness endpoints and the frontend respond. Missing prerequisites fail with instructions; this command never provisions containers or databases. Keep Docker services running with `docker compose up -d`.

The launcher derives `NEXT_PUBLIC_AIMS_API_URL=http://localhost:<API_PORT>` automatically. An explicit value in `.env.local` (or the shell when absent from that file) is preserved. It must address the API being launched; an inconsistent override fails with instructions rather than being overwritten. Readiness includes the browser-facing API health URL and credentialed CORS for `WEB_ORIGIN`.

Ctrl+C stops only the processes launched by this command. Containers, database records, Redis data and documents are preserved. Run `npm run local` again to restart. An occupied port is an error; existing services are never terminated or adopted. Individual API and worker entry points remain available for debugging:

```bash
node --env-file=.env.local apps/api/dist/src/main.js
node --env-file=.env.local apps/api/dist/src/worker-main.js
npm run dev
```

Visit `http://localhost:3000/login`, select a synthetic local identity, then open the dashboard with the seeded Finance user. Check `http://localhost:3001/health/live` and `/health/ready`. The local deterministic scanner is selected in `.env.local`; start the worker so uploaded evidence can complete scanning. No separate scheduler process is required for the worker polling loop.

Re-running bootstrap preserves credentials and `.env.local`. Re-running migrate on schema 61 checks the existing privilege manifest without replaying migrations. Seed verifies the synthetic data already included in migrations 001–061; it does not insert duplicates. A partially migrated database is rejected rather than replayed or erased. Stop services with `docker compose stop`; restarting retains data. `docker compose down -v` **deletes this Compose project's local database and Redis data** and is only for an intentional disposable reset.

## Database bootstrap and ownership

The bootstrap uses the existing provider-independent `apps/api/database/production/bootstrap-roles.sql` and post-migration hardening/privilege manifest unchanged. The directory name is historical; these SQL contracts also define local P6 role separation. The database and public schema belong to `aims_owner`; the API uses `aims_app`, while Finance, Payment and document scanning retain separate runtime logins. Migrations execute as `aims_owner` through the local container administrator, never through application credentials.

Migrations 001–061 include synthetic identities, budgets and policy seeds. Their contents are unchanged. The seed command verifies availability after migration; it is not a second seed load. Existing manually managed environments may continue using `.env` and their original npm startup commands; the new Compose path explicitly selects `.env.local`.

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

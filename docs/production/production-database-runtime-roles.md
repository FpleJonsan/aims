# AIMS Production PostgreSQL and Runtime Role Model

## Status and scope

P6 defines the provider-independent PostgreSQL deployment boundary and P7 extends it with the dedicated document-worker boundary. Neither phase selects a database provider or implements HA/read replicas, backups, or centralized monitoring. Infrastructure SQL is under `apps/api/database/production`; application migrations remain the immutable `001`–`057` chain.

The disposable proof is the authoritative executable model. The existing local `aims` database remains schema 56 and has not been administratively changed by P6. Its runtime roles are restricted, but its database objects and `SECURITY DEFINER` functions are currently owned by the local `postgres` administrator. Applying the target ownership/default-privilege posture locally requires separate explicit administrator authorization.

## Role and ownership model

| Identity | LOGIN | INHERIT | Purpose | Membership | Runtime credential |
| --- | --- | --- | --- | --- | --- |
| `aims_owner` | No | No | Own database, `public` schema, tables, sequences, functions and triggers | None required at runtime | None |
| `aims_migrator` | Yes | No | Controlled deployment identity; explicitly `SET ROLE aims_owner` | May set `aims_owner` only | Deployment injection only |
| `aims_app` | Yes | Yes | Normal API pool | No executor/owner/migrator membership | Server runtime injection |
| `aims_finance_executor` | No | Yes | Finance Control capability | Inherits `aims_app` baseline | None |
| `aims_finance_runtime` | Yes | Yes | Dedicated Finance pool | Member of Finance executor only | Server runtime injection |
| `aims_payment_executor` | No | Yes | Payment capability and accepted narrow payment-slip scan transition | Inherits `aims_app` baseline | None |
| `aims_payment_runtime` | Yes | Yes | Dedicated Payment pool | Member of Payment executor only | Server runtime injection |
| `aims_document_worker_executor` | No | Yes | Narrow document claim/finalization/health capability | No application, Finance, Payment, owner or migrator membership | None |
| `aims_document_worker_runtime` | Yes | Yes | Dedicated document scan worker pool | Member of document-worker executor only | Server runtime injection |
| Bootstrap administrator | Operational | N/A | Creates database/roles and assigns injected credentials | Outside application | Never available to API |

All runtime roles are `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. Runtime roles own no application objects and cannot `SET ROLE` to another executor, migrator, or owner. Technical ADMIN and all business roles remain application identities; they never map to PostgreSQL administration.

The owner is NOLOGIN. The migration login is deliberately `NOINHERIT`: deployment must explicitly enter the owner role, making privileged execution visible and bounded. Password assignment is an operator/provider action after role bootstrap; repository SQL contains no passwords.

## PUBLIC, schema and defaults

The target database revokes `PUBLIC CONNECT`; the migrator and three named runtime logins receive it explicitly. CONNECT alone gives the `NOINHERIT` migrator no schema or object authority: deployment must still explicitly `SET ROLE aims_owner`. `PUBLIC CREATE` on `public` is revoked. Runtime receives schema `USAGE`, never `CREATE`.

After migrations, all `PUBLIC` table/sequence privileges and all application-function `PUBLIC EXECUTE` are revoked. Future tables and sequences receive no PUBLIC privileges. Function `PUBLIC EXECUTE` is revoked as a global owner default because PostgreSQL's implicit function grant is global; a schema-scoped revoke cannot remove it. Migrations must explicitly grant every application or executor capability.

`privilege-manifest.sql` fails on unsafe role attributes, runtime schema creation, ownership drift, executor membership/call drift, unsafe `SECURITY DEFINER` owner/search path, or PUBLIC trusted-function execution. The disposable test additionally creates a future table, sequence and function and proves their defaults.

## Table and sequence privileges

`aims_app` retains the explicitly accumulated per-table/per-column grants in migrations 003–056. These grants are broad only where current repositories require them; they are not replaced with `ALL TABLES` defaults. Protected Payment/ledger writes and final Finance Control are removed from normal runtime and mediated by trusted functions/guards. Audit and historical records retain append-only/immutability triggers.

Finance executor receives direct Finance Control working-table privileges required by the existing service plus its two trusted functions. It receives no Payment trusted function. Payment executor receives no Finance Control trusted function. Its accepted P3/P4 capability is limited to attaching/scanning the payment slip and recording the externally completed payment. Raw payment-slip security transitions remain rejected by the trusted-write guard.

The application uses UUIDs for nearly all identities. The one owned sequence is migration-created and remains owner-controlled; legitimate runtime operations depend on explicit migration grants rather than ownership or future blanket sequence defaults.

## P7 worker SECURITY DEFINER inventory at schema 57

Document-worker callable only:

- `claim_next_payment_document_scan(text,integer,integer,uuid)`
- `complete_payment_document_scan(uuid,integer,text,integer,uuid,text,text,integer,text,text,text,text)`
- `payment_document_scan_worker_health()`

These functions share the owner/fixed-search-path/PUBLIC-denial rules below.
The worker receives no raw table write or cross-executor function access.

## Earlier SECURITY DEFINER inventory preserved from schema 56

All target functions are owned by `aims_owner`, use fixed `search_path=pg_catalog, public`, contain no dynamic SQL, and deny PUBLIC execution.

Finance callable:

- `aims_authenticated_finance_actor()`
- `complete_finance_control_pass(uuid,uuid)`

Payment callable:

- `aims_authenticated_payment_actor()`
- `attach_payment_slip(uuid,uuid,uuid,text,text,text,bigint,text)`
- `record_payment(uuid,uuid,uuid,date,bigint,text,text,uuid,boolean)`
- `begin_payment_slip_security_scan(uuid,uuid,integer,text)`
- `complete_payment_slip_security_scan(uuid,uuid,integer,text,integer,text,text,text,text)`

Trigger/internal only:

- `aims_dependent_request_serialization()`
- `aims_require_request_serialization(uuid)`
- `audit_finance_control_database_transition()`
- `clear_readiness_for_control_supersession()`
- `enforce_finance_control_lifecycle()`
- `enforce_ready_for_payment()`
- `guard_consumed_commitment()`
- `guard_finance_control_child_write()`
- `guard_finance_control_run_write()`
- `guard_paid_documents()`
- `guard_paid_request()`
- `invalidate_approval_for_evidence_change()`
- `invalidate_day7_for_material_request_change()`
- `invalidate_finance_control_for_authority_change()`
- `invalidate_ready_for_new_duplicate()`
- `lock_duplicate_control()`
- `payment_verification_fault()`
- `reject_payment_mutation()`

Trigger functions require no direct runtime `EXECUTE`: PostgreSQL invokes them through owned triggers. Fixed search paths and schema-qualified protected relations prevent caller-controlled object shadowing. The inventory must be regenerated and reviewed whenever migrations add or change a definer function.

## Connection and timeout model

The API maintains three distinct `pg` pools and never returns an executor connection to the normal pool:

| Pool | Maximum | Purpose |
| --- | ---: | --- |
| Normal | 10 | General repositories and readiness |
| Finance | 5 | Finance transactions only |
| Payment | 5 | Payment/document-trust transactions only |

Current runtime defaults are a 5-second connection timeout, 10-second statement timeout, 5-second lock timeout and 15-second idle-in-transaction timeout. Pool sizing and acquisition/SLO tuning remain TBD pending P15 load and hosting limits. Migration sessions are separate, single-purpose, and may use a reviewed longer statement/lock timeout; they must not inherit short runtime limits blindly.

## TLS and database identity

Local loopback PostgreSQL may remain non-TLS. Production requires every runtime URL to use `sslmode=verify-full`, distinct non-admin usernames, a non-local host, and the exact explicit `AIMS_EXPECTED_DATABASE`. Local/common databases (`aims`, `aims_competition`, `postgres`, templates), localhost, owner/migrator/admin usernames, shared runtime/executor identities, malformed URLs and placeholders are rejected before startup. Certificate and hostname verification cannot be disabled. CA material must be supplied by the approved hosting/runtime mechanism, never fabricated or committed.

The hosting provider, PostgreSQL version, HA, private network and certificate distribution remain decisions D-002/D-007. Runtime validation does not infer provider identity from host naming.

## Deployment and migration process

New installation:

1. Create an isolated database with the operational bootstrap identity.
2. Run `bootstrap-roles.sql` with an explicit target database; assign generated credentials through the approved secret channel.
3. Connect as `aims_migrator`, explicitly `SET ROLE aims_owner`, and apply reviewed migrations 001–057 in lexical order with `ON_ERROR_STOP`.
4. Run `post-migration-hardening.sql` and `privilege-manifest.sql`.
5. Verify singleton schema version 57 and exact migration ID `057_p7_document_scan_worker_leases`.
6. Start the API with its three existing runtime credentials and the independent worker with its dedicated document-worker credential; verify readiness and representative workflow.

Existing installation at schema 56 performs a no-op version check, then privilege verification. It must not replay historical migrations or synthetic data. Production bootstrap/master-data strategy remains D-015/PG-026; the current historical chain contains explicitly local synthetic fixtures and is therefore a proven schema/bootstrap artifact, not yet an approved Production data-loading policy.

Application startup checks schema and configuration but never migrates or self-elevates. Migration credentials are absent from the runtime secret catalogue.

## Failure and rollback procedure

On bootstrap or migration failure: stop deployment; retain safe logs/correlation; verify current schema version, migration ID and partial objects; rely on transaction rollback where the migration supports it; never manually mark a migration applied; never patch historical migrations; investigate and propose a reviewed forward-only correction. Roll back the application release only when it remains schema-compatible. If partial non-transactional infrastructure operations exist, reconcile them through a separately approved operational plan.

Password/credential rotation follows the P5 runbook. Database release rollback does not imply destructive down migrations. Backup/PITR and restore rehearsal remain P12 blockers.

## Disposable proof and future roles

Run `npm run test:p6:database-proof --workspace @aims/api`. It creates and destroys an isolated container, applies untouched migrations 001–057, checks the schema-56 upgrade preservation boundary, defaults/manifest/attacks and UAT with generated disposable credentials. It never uses local `aims`.

Mutating integration scripts also run through the repository's isolated database
runner. The runner creates a uniquely named `aims_test_*` database/container,
applies migrations and P6 hardening, verifies the privilege manifest, executes
tests sequentially, and removes the disposable environment in a `finally`
cleanup. Its guard rejects the shared local, competition, staging, Production,
administrative, missing, or mismatched database targets.

No RLS is currently enabled and P6 does not introduce it. Only `plpgsql` is required. Backup, monitoring, reporting/read-replica and worker roles remain future provider/phase decisions and receive no privileges now.

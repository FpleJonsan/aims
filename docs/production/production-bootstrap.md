# AIMS Production Bootstrap

## Release contract

The Enterprise release requires schema 69, all migration files `001`–`069`
present in exact lexical order, and latest migration
`069_p20_5g_notification_platform`. Historical migrations remain immutable.

Production deployment uses three separate layers:

1. Infrastructure role bootstrap: an authorized DBA applies
   `apps/api/database/production/bootstrap-roles.sql`, provisions distinct
   credentials externally, and makes only `aims_migrator` able to enter
   `aims_owner`.
2. Production migration and system bootstrap: with
   `AIMS_ENVIRONMENT=production` and `AIMS_MIGRATION_DATABASE_URL` identifying
   the dedicated migrator and a fresh isolated database, run
   `npm run migrate:production`. The runner validates the complete chain,
   defers 14 fixture-only files, checksum-validates and removes fixture inserts
   from the two mixed historical migrations, applies every schema transition,
   runs post-migration hardening and the privilege manifest, and verifies the
   schema, system roles, permissions, safe defaults and absence of fixtures.
3. Runtime start: provide the normal, Finance, Payment and document-worker
   credentials and require `/health/ready` to report schema 69 before traffic.

The production runner rejects a non-empty database, the common local and
competition database names, a non-migrator login, loopback targets, and any
environment other than Production. It does not create credentials, import a
Finance Master, or insert organization/business data.

## Production-safe system data

Only migration-defined system metadata remains after production bootstrap:

- the five role definitions and permission matrix;
- AI feature switches, all disabled;
- default MYR currency and bank-transfer payment-method definitions;
- schema and recovery-generation metadata.

There are no demo/local/competition users, departments, policies, fiscal
periods, budgets, requests, approvals, payments, claims or notifications.
Production organization data and the first Finance Master require a separately
authorized operational onboarding process; no default password or account is
fabricated by bootstrap.

## Development layer

`npm run bootstrap` performs the same production-safe schema/system bootstrap
against the local Compose database and then invokes the separate development
fixture layer. `npm run bootstrap:system` stops before fixtures, while
`npm run fixtures:development` applies them explicitly. The fixture command is
loopback-only and cannot target Production.

## Release proof

Run `npm run verify:production-release`. The disposable proof creates an
isolated PostgreSQL container, applies the role and production migration layers,
checks schema 69, the privilege manifest, system defaults and zero fixture
records, then applies the development layer twice and proves it is populated and
idempotent. The container and generated credentials are removed in `finally`.

No destructive down migration is supported. Application rollback requires
schema compatibility. Restore continues to use the P12 frozen-service,
generation-advance, read-only checker, reconciliation and human-resume process.

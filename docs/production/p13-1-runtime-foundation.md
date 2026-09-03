# AIMS P13.1 Protected Environment and Runtime Foundation

P13.1 defines one provider-neutral security boundary. `AIMS_ENVIRONMENT` is the
authoritative AIMS classification; `NODE_ENV` controls framework/runtime
behavior. Staging and Production are protected and must also use
`NODE_ENV=production`. A production Node runtime without an explicit protected
`AIMS_ENVIRONMENT`, an unknown value, or a contradictory pairing fails closed.

Development, test, local, and competition may use the existing local document
storage and deterministic scanner. Staging and Production reject these adapters
at their constructors and at the shared API, worker, and recovery construction
boundary. No object-storage or scanner vendor is selected by this phase, so an
approved provider selection reports not-ready and construction remains
intentionally unimplemented. There is no fallback to local adapters.

Local identity and `x-aims-user` compatibility remain unavailable in protected
environments. AI and Telegram remain optional: OFF requires no provider or
credential; an explicitly enabled fake/test/local transport is rejected in a
protected environment. Corporate identity, Production storage/scanning,
secrets, observability, backup/PITR, and hosting remain undecided.

Hosted runtime configuration requires Secure cookies with explicit SameSite and
Path behavior, bounded release version/revision values, exact trusted proxy IP
addresses, and bounded database pool maxima. API SIGTERM/SIGINT handling invokes
the Nest application close lifecycle, which stops HTTP service and closes the
PostgreSQL pools, with a configurable bounded deadline. Readiness now reports
provider state rather than accepting driver strings as proof; liveness and
readiness expose only bounded release version, revision, and schema identity.

The browser API-routing gap remains open because P13.1 did not modify frontend
code. No migration, database object, role, grant, provider, infrastructure, or
financial/workflow authority changed.

## Frozen verification

P13.1 is PASS / FROZEN. Root tests passed with 15 frontend authentication UX
tests and 193 API tests. Every isolated integration suite, P6 disposable
database proof, P12 restore/recovery suites, UAT, lint, typecheck, API build,
full build, and `git diff --check` passed. Six independent final read-only
reviews passed with no Critical, High, Medium, or Low correction-required
finding: Application Security, Backend/Deployment, SRE/Platform,
Production/Cloud, DBA/PostgreSQL, and Finance Systems/Controls.

The repository schema contract remains 59 at migration 059; migration 060+ is
absent. The shared local `aims` database remains at its intentionally unchanged
schema-56 checkpoint and was not migrated by P13.1. Overall P13 remains in
progress, P14 is not started, and Production readiness remains NO.

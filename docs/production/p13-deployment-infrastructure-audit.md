# AIMS P13 Deployment and Infrastructure Audit

Status: DECISION / GAP AUDIT PASS / FROZEN — IMPLEMENTATION NOT AUTHORIZED  
Baseline: `main` at `3e73aad69c2f681687444ee4e8ecf06a3153eec0`  
Repository schema contract: 59 (`059_p12_recovery_generation_fencing`)

## Decision

**B — APPLICATION HARDENING + INFRASTRUCTURE CONFIGURATION REQUIRED.**

The NestJS modular monolith, PostgreSQL authority model, separate API and worker
processes, and provider-neutral contracts remain appropriate. No Redis,
microservices, scheduler, or Kubernetes redesign is justified. A deployable
staging release nevertheless requires narrow application integration work plus
platform configuration. Provider and Company decisions block a real staging or
Production deployment, but do not prevent the provider-neutral hardening work
from being specified.

Production is not ready. AI and Telegram remain OFF. P13 implementation, P14,
provider configuration, deployment, migration 060, and database changes are not
authorized by this audit.

## Evidence and current architecture

| Area | Current evidence | Audit conclusion |
| --- | --- | --- |
| Frontend | Vinext/React, `vinext build/start`; browser API URL is `NEXT_PUBLIC_AIMS_API_URL`, server branch is fixed to localhost | Separate web process/deployment unit is expected; hosted server-side API routing/configuration must be made explicit |
| API | NestJS `dist/src/main.js`; binds configured host/port; DTO whitelist; CORS; basic headers; live/ready/metrics | Separate supervised process. Production adapter construction, proxy trust, shutdown and deploy metadata need hardening |
| Worker | `dist/src/worker-main.js`; PostgreSQL leases; independent health server; bounded shutdown | Separate supervised process. Multi-instance/restart safe; some Production checks exist, but staging protection and Production storage/scanner factories are incomplete |
| Database | PostgreSQL schema 59; P6 owner/migrator/application/Finance/Payment/worker roles | Authoritative private managed-or-operated PostgreSQL compatible with all P6 features is required |
| Storage | Provider-neutral interface plus local development adapter | Target is development/test only, but staging/Production exclusion is not consistently enforced across API, worker and recovery CLI; approved private versioned adapter is missing |
| Scanner | Deterministic local scanner and provider contract | Some Production paths reject it, but staging and all entry points are not uniformly protected; approved provider adapter is missing |
| Identity | Local session foundation; Production/staging startup deliberately rejected | Corporate IdP/test IdP adapter is the primary application and Company blocker |
| Secrets | P5 validation/redaction foundation; `.env` operator pattern locally | Production secret backend/runtime injection is unresolved |
| Observability | P10 structured logs, bounded metrics, health; P11 static alert specification | Platform collection, evaluator, routing and ownership are unresolved |
| Recovery | P12 manifest/checker/runbook and schema-59 proof | Actual database PITR, object version recovery, retention and rehearsal remain infrastructure/company gates |

## Process inventory

| Process | Command/artifact today | Required role | Health / shutdown | Production conclusion |
| --- | --- | --- | --- | --- |
| Web | `npm run build`, `npm start`; Vinext SSR artifact | No database role | Platform HTTP probe and graceful process supervision required | Deploy separately from API unless Company platform proves a safe combined unit |
| API | `npm run build --workspace @aims/api`; `node dist/src/main.js` (current script loads `.env`) | `aims_app`, plus distinct Finance and Payment connection identities | `/health/live`, `/health/ready`, `/metrics`; Nest shutdown hooks are not enabled | Separate private application unit behind ingress/web; inject secrets without on-disk `.env` |
| Worker | `node dist/src/worker-main.js` (current script loads `.env`) | `aims_document_worker_runtime`; `aims_app` only if Telegram enabled | local-only `/health/live`, `/health/ready`, `/metrics`; bounded SIGTERM/SIGINT | Separate supervised unit, private management surface, one or more instances supported by leases |
| Migration | No Production job wrapper | `aims_migrator` using controlled `SET ROLE aims_owner` | Exit status, migration/P6 evidence | One-shot deployment job from management network; never an API startup side effect |
| Optional integrations | AI and Telegram adapters | No added financial role | Feature-specific health only when enabled | Both OFF for initial Production; no core-readiness penalty while disabled |

The API has three pools with hard-coded maxima 10/5/5; the document worker uses
2 connections and an enabled Telegram workload also creates an application
pool. These are configurable-sizing gaps, not approved Production numbers. P15
owns measured sizing.

## Production requirements by boundary

### Frontend and ingress

Use one public HTTPS product hostname where practical. Route UI traffic to the
web process and `/api` (or an explicitly approved API hostname) to the private
API. A same-origin arrangement best matches cookies and Origin/CSRF controls and
avoids unnecessary CORS exposure. The ingress must enforce TLS, HTTP-to-HTTPS,
validated hosts, upload/body limits, bounded timeouts and platform-owned rate
controls. HSTS, CSP, `nosniff`, frame restrictions, referrer policy and trusted
proxy behavior need explicit ownership. No WebSocket requirement was found.

### Sessions and identity

Production local/competition identities remain prohibited. The corporate
adapter must map issuer-bound stable subjects to existing AIMS users; external
groups or cloud administrator status must not grant Finance authority. Session
cookies require Secure, HttpOnly for the session token, an explicit SameSite and
Path policy, bounded lifetime, correct proxy/TLS awareness, exact allowed Origin
checks and CSRF protection. The current local cookie implementation is evidence
for the session pattern, not a Production identity implementation.

### PostgreSQL and migration

The service must support PostgreSQL features used by P6 and the application:
NOLOGIN roles, role memberships and `SET ROLE`, object ownership, default ACLs,
function-specific grants, SECURITY DEFINER, triggers, advisory locks, row locks,
transaction-local settings and TLS `verify-full`. Keep the database private.
Require HA/failover, monitoring, durable storage, automated protected backups
and continuous WAL/PITR. Read replicas are not currently required.

Migrations run once, before application replacement, with a separately injected
migrator credential. Take the approved checkpoint first, validate the target,
apply the immutable forward chain, then run P6 manifest verification. A schema
migration is not automatically reversible; failure response is stop, preserve
evidence, and forward-fix. Application rollback is allowed only when compatible
with the resulting schema. Financial history must never be manually reversed.

### Documents

Production storage must be private, encrypted, durable, versioned (or provide
equivalent exact recovery), metadata-capable, bounded/cancellable and auditable.
The scanner must provide bounded I/O, cancellation, health, deterministic
verdict mapping and no trust on timeout/failure. Upload completion never implies
CLEAN. Temporary disk, if used for streaming, is non-authoritative, encrypted or
ephemeral as policy requires, size bounded, cleaned, and never used as document
recovery storage.

### Current protected-environment enforcement

Protection is fragmented rather than complete. The main API configuration
validator rejects missing Production providers and deliberately blocks staging
and Production identity until approved adapters exist. Worker configuration has
useful Production checks for object storage, provider scanning, database target,
role identity and TLS, but `AIMS_ENVIRONMENT=staging` is not treated equivalently
and runtime construction remains hard-bound to local storage and deterministic
scanning. The recovery CLI constructs local storage directly when selected and
does not pass through the main API validator. `LocalDocumentStorage` primarily
guards `NODE_ENV=production`, which does not cover every
`AIMS_ENVIRONMENT=production` or staging combination; the deterministic scanner
does not establish equivalent staging exclusion.

Therefore Production/staging unsafe-adapter rejection is a **required P13
application-hardening gap**, not a current PASS. Every executable entry point—API,
worker, recovery CLI and any deployment tool that constructs providers—must use
equivalent protected-environment rules. Staging and Production must reject local,
fake or test storage/scanner/identity/AI providers unless an adapter is explicitly
approved for that environment. A shared environment-aware factory is a candidate,
not a mandated design. This enforcement work is separate from selecting the
actual storage and scanner providers.

### Operations and recovery

Collect structured stdout/stderr and `/metrics` through a private management
path. Preserve redaction and correlation identifiers. Deploy an evaluator and
routing layer for the frozen P11 catalogue without granting business authority.
Optional-provider OFF states are not incidents. Numeric thresholds remain SRE
or P15 decisions.

P12 requires this exact order: restore PostgreSQL and required object state into
an isolated environment; keep services and outbound integrations frozen; advance
and verify the recovery generation using the privileged mechanism; run the P12
read-only checker bound to that current generation; manually reconcile external
payment reality and current identity/authority reality; obtain Finance, Security
and SRE human approval; then resume services in controlled order. The checker
does not advance generation or repair any state. RPO/RTO and retention are open
Company decisions; the checker timeout is not an RTO.

## Failure behavior

| Failure | Required response |
| --- | --- |
| Secret/config retrieval fails | Process does not start or readiness remains false; never fall back to local adapters |
| Migration fails | Stop rollout, preserve logs/checkpoint, no partial improvisation; DBA-led forward fix |
| Migration succeeds, app fails | Keep traffic on compatible prior artifact if possible; otherwise stop and forward-fix—do not reverse financial/schema history |
| API readiness fails | Do not enable traffic; liveness remains process-only |
| Worker fails | Supervisor restarts with bounded backoff; leases permit safe recovery; unscanned evidence stays untrusted |
| Storage/scanner unavailable | API/worker readiness reflects required capability; scan fails closed; no trust promotion |
| Database failover | Pools reconnect under platform policy; readiness gates traffic/work; verify roles/TLS/schema after failover |
| Optional AI/Telegram unavailable while OFF | No core health impact |

## Security and finance invariants

- Public: HTTPS ingress only. API, worker management, PostgreSQL, scanner and
  deployment endpoints are private.
- Cloud/host/DB administration does not confer Requester, Approval, Finance
  Control or Payment authority.
- API runtime cannot migrate. Migrator is not a normal runtime credential.
- Worker retains no financial executor authority.
- AI does not approve, control Finance Control, pay, calculate authoritative
  balances, or transition workflow state.
- AIMS records an externally executed payment; it does not transfer money.
- Recovery never bypasses Approval, Finance Control, document trust, Payment
  idempotency, or immutable financial history.

## Capacity and future evidence

Keep API replicas, worker count, pool sizes, document limits, storage/scanner
throughput and request concurrency configurable. Do not approve values before
P15 load evidence. Staging must use the same immutable artifact intended for
Production, isolated data/secrets/storage/identity, Production-like TLS/network,
real role provisioning, real provider adapters and supervised API/worker units.

Detailed decisions, gaps, topology, draft execution steps and evidence fields
are maintained in the companion P13 documents.

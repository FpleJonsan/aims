# AIMS Production Architecture Baseline

Status: P0 architecture freeze with P1 identity decision addendum. The detailed identity contract is in [production-identity-architecture.md](production-identity-architecture.md). This document does not authorize production deployment.

## Frozen business architecture

AIMS remains a modular monolith with twelve distinct stages: Request Initiation, Request Capture, Validation, Finance Context, Financial Risk Analysis, Policy & Decision, Approval, Final Finance Control, Payment Processing / Recording, Payment Record / History, Finance Dashboard, and AI Finance Intelligence.

The following invariants are frozen:

- `Available = Active Budget - Actual Ledger - Active Commitments`.
- Payment exists if and only if the matching actual-ledger entry exists, the commitment is consumed, and the request is `PAID`.
- AIMS records an externally completed payment; it does not transfer money.
- AI is advisory only and cannot approve, calculate authoritative balances, change state, pass Finance Control, record payment, or post ledger entries.
- AI OFF preserves Request, manual Validation and Financial Analysis, Finance Context, Policy, Approval, Finance Control, Payment Recording, Payment History, and Dashboard.
- Requester, Finance Analyst, Approver, Finance Controller, Payment Operator, Reporting, and Technical Administrator authorities remain separate. Technical ADMIN grants no operational Finance authority.

## Current repository architecture

| Area | Verified current state |
| --- | --- |
| Frontend | React 19 and Next-compatible routing built with Vinext/Vite. One browser application calls the API and derives workspace navigation from `/session`. |
| API | NestJS 11 modular monolith on Express. DTO validation uses whitelist and unknown-field rejection. Swagger is disabled in production. |
| Database | PostgreSQL via `pg`. Normal pool max 10; Finance and Payment pools max 5 each; 10-second statement timeout; bounded serialization retry. PostgreSQL is authoritative for workflow, audit, policy, commitments, payment, ledger, and reporting. |
| Database roles | Separate normal application, Finance runtime/executor, Payment runtime/executor, and migration/admin concepts. Restricted executor functions and triggers enforce terminal mutations. |
| Migrations | Fifty-three immutable lexical SQL migrations. Schema readiness expects version 53. No automated production migration runner or checksum manifest exists. Several historical migrations contain local/competition fixtures and must not be applied blindly as production bootstrap data. |
| Authentication | LOCAL uses the P1-L namespaced identity adapter and hashed opaque server-side session. COMPETITION retains its guarded compatibility header. STAGING/PRODUCTION fail closed until an approved corporate adapter is implemented; no OIDC client or trusted proxy assertion is implemented. |
| Authorization | Backend resolves active user, department, technical roles, and independent business-authority tables on each request. `/session` returns safe user/workspace/capability projections. |
| Documents | Node filesystem adapter only. It streams to quarantine, validates size/type/signature/container ending, stores SHA-256, blocks traversal/symlinks, and supports scanner-gated promotion in code. Local storage refuses production. No production object-storage adapter or malware engine is wired. |
| AI | Optional OpenAI-compatible provider with strict structured schemas, evidence validation, safe provider errors, feature flags, usage records, and AI OFF behavior. Calls are currently in request paths; no production circuit breaker, central rate/cost budget, privacy approval, or provider SLA is configured. |
| Telegram | Optional channel with webhook/callback secrets, identity binding, replay controls, outbox leasing, retries, and safe errors. Production use has not been approved. |
| Redis | `REDIS_URL` appears in local environment documentation, but no Redis client dependency or Redis-backed runtime behavior exists. |
| Workers | No independent worker executable, scheduler, queue consumer, or process supervision exists. Notification outbox processing is PostgreSQL-backed and invoked through application services/endpoints. |
| Audit | Append-oriented PostgreSQL audit events carry actor, state, safe metadata, and correlation ID. Financial records and terminal history are database-protected. |
| Logging | NestJS console logger plus a global safe exception filter. Failures log structured JSON with correlation ID, method, path, status, and safe code. No centralized sink, retention, redaction test gate, or alert routing exists. |
| Health | `/health/live` reports process liveness. `/health/ready` checks database, schema, executor pools, storage configuration, AI state, and Telegram configuration without returning secrets. |
| Deployment | Frontend has OpenAI Sites configuration with no D1/R2. The repository contains no Dockerfile, Compose file, CI/CD workflow, reverse proxy, TLS, API deployment manifest, worker deployment, managed database configuration, or infrastructure-as-code. |
| Tests | Node test runner and TypeScript compilation cover unit, contract, PostgreSQL integration, concurrency, failure injection, dashboard, security boundaries, and UAT. Integration tests require real PostgreSQL. |

## Current identity flow

```text
Non-production identity selector
  -> LOCAL login adapter and opaque session cookie (Competition compatibility uses x-aims-user)
  -> NestJS AuthGuard
  -> active users + technical roles in PostgreSQL
  -> independent business-authority tables
  -> /session safe capability projection
  -> backend authorization on every operation
```

The production header boundary is incomplete. A network deployment must never allow a client to supply or overwrite the trusted identity header.

P1-L removed the raw header from LOCAL protected requests and established the provider-independent server-session boundary. Production identity implementation remains blocked until the IdP and validation/edge contract are approved; Production and Staging currently refuse startup rather than fall back. See [production-identity-architecture.md](production-identity-architecture.md).

## Target logical architecture

```text
Corporate users
  -> Corporate IdP (provider decision required)
  -> OIDC relying party or trusted identity proxy
  -> TLS edge / load balancer
  -> AIMS web
  -> AIMS API modular monolith
       -> normal PostgreSQL role
       -> Finance Control runtime -> constrained Finance executor
       -> Payment runtime -> constrained Payment executor
       -> private object storage quarantine/clean zones
       -> durable worker/outbox runtime (only where asynchronous work is required)
       -> optional AI provider through governed adapter
       -> optional Telegram channel (business decision required)
  -> centralized logs, metrics, traces, alerts, and audit export

Migration job -> migration/admin DB role (not available to runtime)
Backup/restore service -> encrypted PostgreSQL and object backups
```

The frontend, API, and worker may be separate deployable processes from one versioned modular-monolith codebase. A microservice rewrite is neither required nor approved.

## Target identity boundary

```text
Corporate IdP
  -> authenticated external subject and verified claims
  -> AIMS identity mapping
  -> active organization and department membership
  -> explicit AIMS technical roles
  -> independent Approval / Finance Control / Payment / Reporting authorities
  -> AIMS session
  -> operation-specific backend and database authorization
```

The IdP authenticates identity. IdP groups or workspace labels must not automatically grant Finance business authority. Required future controls include issuer/audience/signature validation, state/nonce/PKCE where applicable, short-lived session, secure cookies, CSRF protection if cookies are used, revocation/disable handling, trusted logout, clock-skew policy, proxy-header stripping, and audit of identity mapping changes. Exact IdP: **DECISION REQUIRED**.

## Target document boundary

```text
Authorized client
  -> AIMS upload authorization and limits
  -> private quarantine object
  -> immutable object metadata + SHA-256 in PostgreSQL
  -> asynchronous malware scan
       -> infected/error: remain unavailable; alert/audit
       -> clean: promote or mark clean using immutable version identity
  -> authorized server-mediated download or short-lived signed URL
  -> evidence fingerprint and downstream staleness rules
```

Requirements: block public access, TLS, server-side encryption, separate quarantine and clean access policies, object versioning where justified, durable scan evidence, idempotent scanning, retention/legal-hold input, lifecycle policy, authorization before every read, and reconciliation of PostgreSQL metadata to object hashes. Provider and malware scanner: **DECISION REQUIRED**.

## Financial authority and database boundary

- `aims_app`: normal reads and non-terminal domain writes only.
- Finance runtime login: server-only credential, member only of the constrained Finance executor capability.
- Payment runtime login: server-only credential, member only of the constrained Payment executor capability.
- Migration/admin role: schema and grants only, unavailable to API and workers.
- Reporting remains scope-authorized; a separate read role is optional only if it preserves row/business scope.
- Production connections require TLS verification, bounded pools, explicit statement and lock timeouts, credential rotation, and connection-budget ownership.
- Financial mutations remain transactional and idempotent; queue delivery must be at-least-once safe, not assumed exactly once.

## Worker boundary

Redis is not currently part of application correctness. P7 must decide whether Redis is needed. PostgreSQL outbox rows remain the durable source of work. A future worker must claim jobs with leases, support idempotent retries, backoff, poison/dead-letter handling, backlog metrics, graceful shutdown, and deployment-safe lease recovery. Redis, if introduced, may accelerate delivery but must not become the sole record of a financial action.

## AI boundary

- Send only authorized, minimized evidence approved by company privacy policy.
- Never send bank details, secrets, authorization headers, or unrestricted document content.
- Enforce structured schemas, evidence allowlists, timeouts, bounded retries, circuit breaking, token/request limits, cost budgets, and provider/model allowlists.
- Record safe usage/failure metadata without prompts or sensitive content.
- Provider outage degrades AI features only; deterministic/manual workflow remains available.
- Production provider and permissible data classes are **POLICY DECISION REQUIRED**.

## Environment matrix

| Control | Local | Competition | Staging | Production |
| --- | --- | --- | --- | --- |
| Purpose | Developer work | Frozen judged scenario | Production-like verification | Real Finance operations |
| Identity | Local header selector | Controlled competition selector | Corporate IdP test tenant / trusted proxy | Corporate IdP / trusted proxy |
| Database | Local `aims` | Isolated `aims_competition` | Isolated staging DB | Production DB |
| Reset/seed | Developer-controlled | Guarded deterministic commands | No competition seed; approved bootstrap only | Competition reset/seed forbidden |
| Documents | Local synthetic files | Local synthetic files | Private object storage + scanner | Private object storage + scanner |
| Secrets | Ignored local env | Ignored local env | Controlled runtime injection from an approved store | Controlled runtime injection from an approved store |
| AI | OFF/default or explicit test | OFF/default; optional preflight | Governed sandbox or OFF | Governed provider or OFF |
| Telegram | Disabled/default | Optional controlled test | Disabled unless approved | Disabled unless approved and productionized |
| TLS/network | Loopback | Local controlled | Production-like private network/TLS | Mandatory TLS/private dependencies |
| Data | Synthetic | Synthetic | Sanitized test/UAT | Real approved data |

## Deployment and network requirements

- Public/corporate edge: TLS termination, request-size limits, header normalization, trusted proxy chain, HSTS decision, and authentication integration.
- Web/API: deploy versioned immutable artifacts. API access should be controlled through the edge; direct bypass must not allow identity-header injection.
- PostgreSQL, Redis, workers, executor credentials, and object storage are private. Database and Redis are never internet-facing.
- Health endpoints may reveal only safe component status. Metrics and admin surfaces require controlled access.
- No runtime component receives migration credentials.

## Backup, restore, and financial stop-the-line

Production requires encrypted PostgreSQL backup/PITR and object version/backup policy with documented RPO/RTO. A release cannot be called production-ready until an isolated restore rehearsal starts AIMS, reconciles documents, and proves payment/ledger/commitment invariants.

Immediately suspend affected financial mutation paths and investigate if any of the following occurs: payment/ledger mismatch, `PAID` without one payment, ledger without payment, commitment inconsistency, unauthorized Finance Control or Payment, duplicate payment, database invariant violation, or unexplained reconciliation drift.

## Data bootstrap and migration

Production must not run competition seed data. Initial setup requires an approved organization, departments, categories, fiscal periods, budgets, policy versions, users/identity mappings, and business-authority matrix. Whether production starts empty, imports master data, or imports historical payments is **DECISION REQUIRED**. Historical financial schema changes should prefer forward fixes; destructive down migrations are not assumed safe.

## Production scope

In scope for Production v1: trusted identity, private documents and malware scanning, managed secrets, production PostgreSQL and role provisioning, reliable workers where required, AI governance, observability/alerting, backup/restore rehearsal, TLS/private networking, deployment/rollback, production security review, performance verification, Finance UAT, staging rehearsal, and controlled go-live.

Out of scope unless separately approved: bank APIs, automatic transfers, autonomous payment, AI approval or Finance Control, new agents, forecasting/advanced ML, new workflow, mobile app, major UI redesign, microservices rewrite, or database replacement.

# AIMS P7 Redis / Queue / Worker Decision

Status: DECISION PASS — implementation is not authorized by this document.

Baseline: branch `main`, commit `a705249`, clean worktree, schema 56,
`056_payment_slip_trust_transition`, P6 PASS and frozen. No migration 057 exists.

## Decision

**Redis is not required. A PostgreSQL-backed independent worker is required for
Production v1. A separate scheduler is not required.**

PostgreSQL already owns authoritative workflow state and the transactional
notification outbox. Bounded `FOR UPDATE SKIP LOCKED` claims, leases, idempotent
completion, retries, and persisted final failure provide the required durable
queue semantics at the repository's evidenced scale. Redis would add another
credential, dependency, recovery model, and split-brain failure mode without
solving an identified workload problem. Capacity input remains required at P15.

The worker is required because enabled external notification delivery cannot
depend on an authenticated Finance HTTP request, and Production malware scanning
must survive API request timeouts and process restarts. It must never perform
authoritative Finance Control, Payment recording, ledger posting, commitment
consumption, Approval, Policy, or autonomous workflow transitions.

## Workload matrix

| Workload | Current execution | External/long-running | Retry/crash requirement | Authoritative mutation | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Request initiation/capture | API + PostgreSQL transaction | No | User/idempotent retry | Workflow | `SYNC_REQUEST` |
| Validation | API; optional AI | Conditional | Manual/AI retry; AI OFF works | Validation | `SYNC_REQUEST` |
| Finance Context | Deterministic API transaction | No | Transaction retry | Financial truth | `SYNC_REQUEST` |
| Financial Risk Analysis | API; optional AI/manual fallback | Conditional | Safe retry; failure recorded | Advisory/manual | `SYNC_REQUEST` |
| Policy & Decision | Deterministic API transaction | No | Transaction retry | Route/policy | `SYNC_REQUEST` |
| Approval/webhook | API/webhook transaction | Telegram inbound | Replay/idempotency | Approval | `SYNC_REQUEST` |
| Telegram delivery | PostgreSQL outbox; Finance dispatch endpoint | Yes/failure-prone | Lease, five attempts, terminal state | No | `POSTGRES_OUTBOX_WORKER` if enabled |
| Finance Control | Finance executor transaction | No | Bounded serialization retry | Yes | `SYNC_REQUEST` |
| Payment/ledger/commitment/PAID | Payment executor transaction | No | Idempotent transaction | Yes | `SYNC_REQUEST` |
| Document upload/quarantine | API + storage + PostgreSQL | Storage | Upload retry | Evidence metadata | `SYNC_REQUEST` |
| Malware scan/promotion | Synchronous scan endpoint | Yes | Durable retry and crash recovery needed | Evidence trust | `BACKGROUND_WORKER` in Production |
| AI provider/intelligence | Synchronous API call | Yes/failure-prone | Safe user retry; AI OFF/manual path | No | `SYNC_REQUEST` for v1 |
| Dashboard/reporting | PostgreSQL reads | Query-dependent | User retry | No | `SYNC_REQUEST` |
| Audit events | Transactional/bounded follow-up writes | No | Transaction semantics | Audit evidence | `SYNC_REQUEST` |
| Authentication/session | Synchronous PostgreSQL | IdP later | Client retry; expiry on access | Identity | `SYNC_REQUEST` |
| Session cleanup/housekeeping | No scheduler; expiry enforced on access | No | Not needed for correctness | No | `NO_RUNTIME_REQUIREMENT` for v1 |

Expected volumes are not evidenced beyond low-to-medium application
characteristics. **CAPACITY INPUT REQUIRED FOR P15**.

## Current Redis, queue, and worker inventory

- Redis configuration: YES — unused local `REDIS_URL` placeholder.
- Redis package/connection/read/write/cache/lock/queue/session/limiter: NO.
- Redis runtime dependency: NO.
- Queue: PostgreSQL `notification_outbox` only; no Bull/BullMQ queue.
- Independent worker, scheduler, cron, supervised polling process: NO.
- Outbox consumer logic: YES, invoked only by authenticated
  `POST /approval-notifications/dispatch`.

Outbox rows are created with Approval changes. Claims use `SKIP LOCKED`, a
claim token and worker ID, a default 120-second lease, five maximum attempts,
fixed five-minute retry, terminal failure persistence, stale-claim protection,
and audit events. Delivery is at-least-once: a crash after Telegram accepts a
message but before `SENT` commits may duplicate a message. Callback/action
idempotency protects authority, but transport deduplication is not guaranteed.

**Telegram delivery is not reliable without an independent worker when the
channel is enabled.** If P9 disables Telegram, no Telegram workload runs, but
the worker architecture remains required for Production malware scanning.

The current deterministic scanner runs synchronously. Documents move through
`QUARANTINED`, `SCANNING`, `CLEAN`, `REJECTED`, and `SCAN_FAILED`; failed scans
remain unavailable and can be manually retried. There is no recovery loop for a
process that dies during `SCANNING`. Production storage/scanner providers remain
unselected and are not selected here. Production scanning therefore requires a
worker with versioned claims, leases, bounded attempts, stale-result rejection,
and expired-scan recovery while preserving existing trusted transitions.

## Options

| Option | Assessment | Decision |
| --- | --- | --- |
| A — API/PostgreSQL only | Financially safe, but unattended outbox/scanner recovery is missing | Rejected |
| B — PostgreSQL worker | Atomic durable work source, one recovery domain, simple backup/replay | **Selected** |
| C — Redis queue + worker | Requires DB-to-Redis publication/reconciliation and Redis HA/security without evidenced benefit | Rejected |
| D — Hybrid | Duplicates operational paths without a v1 need | Rejected |

## Future worker contract

After separate authorization, one independent process type from the modular
monolith may claim notification and scan work in bounded batches, persist
attempts/backoff/final failure/correlation/audit, expose liveness/readiness and
backlog/oldest-age/failure metrics, and stop claiming during graceful shutdown.
Expired leases must be recoverable after restart. Persisted `next_attempt_at`
polling handles delayed work; no separate scheduler is required.

The worker is forbidden from Approval, Policy, Finance Control, Payment
recording, ledger/commitment mutations, PAID transitions, authoritative balance
calculation, or autonomous AI/workflow decisions. It receives injected
server-only secrets, no owner/migrator/Finance credential, and only the least
existing application capability plus the Payment trusted path where payment-slip
trust transitions require it. A new role/schema/migration needs separate
authorization.

Failure posture: if the worker is unavailable, synchronous API and Finance
operations remain available while durable notifications/scans accumulate and
untrusted evidence remains blocked. PostgreSQL failure is fail-closed. Duplicate
processing is handled as at-least-once work; poison work reaches a persisted
terminal state and alert. P10/P11/P13 must supply telemetry, ownership, and
deployment supervision.

## Independent read-only review

- Senior Backend Architect: PASS.
- Senior PostgreSQL Architect: PASS.
- Senior Production/SRE: PASS.
- Application Security: PASS.
- Critical: 0; High: 0; Medium: 0.
- Low: capacity, polling cadence, backoff, provider SLA, metrics, alerting, and
  operational ownership remain implementation/later-phase inputs.
- CODE CHANGED DURING REVIEW: NO.

## Gate

- Decision: **REDIS NOT REQUIRED / POSTGRESQL-BACKED WORKER REQUIRED**.
- P7 implementation started: NO.
- Migration 057 created: NO.
- Runtime/frontend changed: NO.
- Next: wait for explicit P7 implementation authorization.

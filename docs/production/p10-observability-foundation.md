# AIMS P10 Vendor-Neutral Observability Foundation

Status: IMPLEMENTED, MEDIUM FINDINGS CORRECTED AND REGRESSION COMPLETE / NEW FROZEN REVIEW PENDING.

## Architecture

AIMS emits machine-readable JSON operational events to stdout/stderr and keeps
bounded in-process counter, gauge and histogram series. The API exposes the
Prometheus-compatible contract at `/metrics`. The worker exposes loopback-only
`/health/live`, `/health/ready` and `/metrics` on `WORKER_HEALTH_PORT` (default
3002). P13 must restrict these operational endpoints at the deployment/network
boundary; they are not public application surfaces.

No vendor SDK, remote exporter, Redis, scheduler, frontend, telemetry table or
database role was introduced. Narrow migration 058 extends the existing trusted
document claim result with an authoritative `expired_lease_recovered` boolean
and adds one partial terminal-outbox index. Scrape/log-collection failure is
non-authoritative and cannot roll back AIMS business transactions.

Migration 058 is not a business capability. The trusted function determines
recovery from the locked pre-update row and returns `true` only to the worker
that successfully reclaimed that expired lease. Fresh and due-retry claims
return `false`. Claim eligibility, locking, token, retry and trust transitions
are unchanged. The function remains owned by `aims_owner`, uses a fixed safe
search path, denies PUBLIC/application/Finance/Payment execution and retains
only the document-worker executor grant.

## Structured event contract

Common fields are `timestamp`, `level`, `service`, `process_type`,
`environment`, `event` and selected bounded operational fields:
`correlation_id`, `operation`, `status`, `duration_ms`, `safe_error_code`,
`route`, `method`, `status_code`, `workload`, `channel`, `provider`, `surface`,
`failure_category` and `component`.

Important events:

| Event | Source | Meaning |
| --- | --- | --- |
| `api_request_completed` | HTTP middleware | Safe route-template request outcome and duration |
| `api_request_failed` | Exception boundary | Bounded HTTP/domain failure classification |
| `database_operation_failed` | PostgreSQL wrapper | Pool/transaction/executor operational failure without SQL |
| `readiness_failed` | API health | One or more required readiness components failed |
| `worker_started`, `worker_stopped` | Worker bootstrap | Process lifecycle |
| `worker_poll_failed` | Worker loop | Bounded workload-cycle failure |
| `worker_workload_completed`, `worker_workload_failed` | Scanner worker | Aggregate scan outcome/duration |
| `provider_operation_failed` | Telegram outbox | Safe provider category without response/payload |
| `worker_health_started` | Worker health server | Loopback health contract listening |
| `worker_start_failed`, `worker_shutdown_deadline_exceeded` | Worker bootstrap | Safe lifecycle failure |

Access logging never consumes raw URLs, query values, bodies, response bodies,
headers, cookies or authorization values. Unknown routes are `UNMATCHED`.

## Correlation

The existing bounded `x-correlation-id` contract remains: a valid
`[A-Za-z0-9._:-]{1,128}` value is retained; absent/invalid input is replaced by
a UUID. HTTP/domain/audit linkage remains intact. Approval notification work
now stores the originating correlation inside the existing JSONB outbox payload
and reuses it for delivery audit/logging. This requires no schema change.
Document worker claims retain their existing persisted scan correlation.
Autonomous work creates a new UUID and never fabricates unrelated linkage.
Correlation IDs are never metric labels.

## Redaction and cardinality

Operational logs accept only an explicit field allowlist and pass their
JSON-safe representation through the central secret redaction boundary. Raw
errors/provider responses are reduced to safe code and failure category.
Payee, purpose, requester/email, filename, comments, clarification text,
bank/payment evidence, documents and uploaded bytes have no operational-log
field. The metrics registry rejects unknown label keys, invalid values, UUIDs
and arbitrary/raw routes before allocating a series.

The bounded failure taxonomy is: `AUTHENTICATION`, `AUTHORIZATION`,
`VALIDATION`, `DATABASE`, `TIMEOUT`, `CONCURRENCY`, `STORAGE`, `SCANNER`,
`TELEGRAM`, `AI_PROVIDER`, `CONFIGURATION`, and `INTERNAL`, with narrower
fixed provider/worker categories where already defined.

Payment recording reports `SUCCESS` when the trusted function returns the
newly supplied candidate identity, `IDEMPOTENT_REPLAY` when it returns the
existing authoritative identity, and `PAYLOAD_MISMATCH` only for the stable
existing `IDEMPOTENCY_CONFLICT` outcome. These classifications do not change
Payment, ledger, commitment or PAID semantics and export no financial values.

Telegram operational backlog is sampled at most once per process minute. The
active query is limited to `PENDING`, `FAILED_RETRYABLE` and `PROCESSING` and
uses the existing claimable partial index. Terminal count is a separate
`FAILED_TERMINAL` query supported by
`notification_outbox_failed_terminal_idx`. Historical `SENT` rows are outside
both predicates. Sampling is non-authoritative and cannot affect delivery or
retry behavior.

## Health/readiness

API liveness remains process-only. API readiness checks database connectivity,
schema 58, Finance/Payment executors, storage/scanner and explicitly enabled
integrations. Disabled AI and Telegram remain healthy and do not initialize a
provider.

Worker liveness is process-only. Worker readiness checks configuration at
startup, then the least-privilege document worker capability and/or Telegram
application database/schema according to enabled workloads. Disabled workloads
are reported `disabled` and do not fail readiness. Responses contain only
bounded states/reasons.

## Preserved authority

Telemetry is not an audit ledger or financial ledger. No budget, actual,
commitment, available, payment amount, bank reference or financial evidence is
exported. PostgreSQL audit remains durable/authoritative. P6 roles, P7 claims
and transitions, P8 AI authority/gates and P9 Telegram authority/retry/security
semantics are unchanged. Production AI and Telegram remain OFF.

## P11/P13 handoff

P11 may consume the inputs listed in the metric catalogue but must separately
approve thresholds, SLOs, owners and routes. P13 owns private exposure,
collection, TLS/network policy and any company telemetry agent. No alert or
provider is configured by P10.

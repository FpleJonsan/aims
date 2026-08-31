# AIMS P10 Observability Architecture and Gap Decision

Status: DECISION COMPLETE — P10 CODE HARDENING REQUIRED; NO PROVIDER SELECTION REQUIRED.

Baseline: `main` at `82d37dd`, clean worktree, schema 57,
`057_p7_document_scan_worker_leases`, no migration 058+, P6/P7/P8/P9 PASS and
frozen, Production AI OFF, Production Telegram OFF, Redis absent, scheduler
absent and P10 runtime not started.

## Decision and authority boundary

P10 must add a vendor-neutral application observability foundation before P11.
It does not require a SaaS, OpenTelemetry exporter, Redis, scheduler, database
migration, database role or AIMS monitoring frontend. Structured stdout/stderr
and a privately exposed Prometheus-compatible metrics contract are sufficient.
Correlation IDs remain the tracing mechanism for this modular monolith and its
separate worker; full distributed tracing/OpenTelemetry is optional until a
measured cross-process diagnostic need or company platform requires it.

Telemetry is non-authoritative and best effort. It must never approve, mutate
workflow, calculate balances, pass Finance Control, record Payment, replace the
append-only audit trail or block/roll back a business transaction because an
exporter is unavailable.

## Existing evidence

| Area | Existing signal | Principal gap | P10 disposition |
| --- | --- | --- | --- |
| API logs | Nest logger and JSON `request_failure` with correlation, method, path, status and code | No success/access event, route template, duration, sizes, service/environment fields or uniform severity contract | Harden |
| Correlation | Bounded validated client value or generated UUID; response echo; controller/domain/audit propagation | No explicit trust/regeneration policy; outbox loses originating correlation; some database-trigger events create unrelated IDs | Harden application-controlled paths; document unavoidable autonomous events |
| Audit | Durable actor, entity, state, correlation and safe metadata records | Operational search/export/retention is not defined | Preserve as authoritative; do not replace with logs |
| API health | `/health/live` and `/health/ready`; DB, schema, executor, storage, scanner, AI and Telegram checks | No request diagnostics/metrics; readiness detail contract needs explicit safe bounded fields | Harden and retain disabled-integration semantics |
| Database | Bounded pools/timeouts and readiness probes | No pool acquisition/exhaustion, timeout, transaction, serialization retry or executor-failure metrics | Harden without query/body/amount logging |
| Worker | JSON lifecycle/failure logs, last successful poll in memory | No externally consumable process liveness/readiness, per-workload cycle/latency/failure metrics or supervision heartbeat contract | Harden |
| Document scan | Durable claim correlation, result logs, backlog/age/lease/retry/terminal health query | Document IDs are logged; no aggregate metrics/export; successful-cycle semantics are process-local | Minimize identifiers and export bounded aggregates |
| Telegram | Durable outbox status/attempt/error, terminal/retry audit and safe provider classifications | No bounded backlog/age/delivery metrics; generated delivery-audit correlation breaks request chain | Harden only while retaining master-OFF behavior |
| AI | Provider/model/version/tokens/latency/retry/status/failure usage records | No operational counters/histograms or exporter; retention remains undecided | Add bounded signals only when enabled; AI OFF is not unhealthy |
| Auth/security | Durable authentication audit plus 401/403/CSRF behavior | No safe aggregate failure/security metrics | Add bounded outcome/category signals; never token/session labels |
| Finance/Payment | Durable business audit and deterministic records | No operational attempt/latency/conflict/rollback metrics | Add outcome/category signals only; never amounts, bank references or evidence |

## Required P10 application contract

- Structured JSON logs with timestamp, severity, service/process, environment,
  safe operation, bounded correlation, status/failure category and duration.
- HTTP access metrics for count, latency and safe size buckets using route
  templates—not raw URLs, bodies or identifiers.
- Database pool/connection/timeout/transaction/retry signals without SQL text,
  parameters, financial values or connection strings.
- Worker cycle, last-success age, workload failure, processing latency, backlog,
  oldest-work age, expired lease, retry and terminal-failure signals.
- Bounded document, Telegram, AI, authentication/security, Approval, Finance
  Control and Payment outcome signals sufficient for later P11 alerts.
- API and worker liveness/readiness contracts that distinguish required,
  optional-enabled and optional-disabled dependencies. AI OFF and Telegram OFF
  remain healthy and require no provider connectivity.
- Automated tests for correlation generation/validation/propagation, access-log
  shape, redaction canaries, cardinality, health/readiness failure modes,
  metrics shape, telemetry-export failure isolation and worker health.

Allowed metric labels are bounded values such as service, operation, safe route
template, method, status class, channel, provider, surface, workload and failure
category. Request/ticket/document/user/chat IDs, correlation IDs, payee,
purpose, raw errors and filenames are prohibited metric dimensions.

## Security and data governance

Operational telemetry must exclude credentials, connection strings, cookies,
session and CSRF tokens, authorization headers, API/provider/Telegram secrets,
action tokens, binding challenges, callback payloads, bank references, payment
credentials/evidence, document content and uploaded bytes. Payee, purpose,
requester and document/file names are excluded by default. Stable actor or
business identifiers may appear only in the durable authorized audit boundary;
operational logs should omit or pseudonymize them when a specific investigation
contract later justifies linkage.

Operational logs, metrics, traces, security events, business audit and AI usage
require separate access and retention decisions. D-006, D-013 and D-017 remain
open for company platform, retention and on-call ownership; none blocks the
vendor-neutral P10 code foundation.

## P11 alert inputs

P10 must make reliable inputs available for API/readiness failure, DB
unavailability/timeouts, elevated error/latency, worker down/stale, backlog age,
expired leases, terminal scan/Telegram failure, enabled-AI provider failure and
schema mismatch. P11—not P10—sets thresholds, SLOs, routes, owners and alerting
products. No arbitrary SLO number is approved here.

## Risk and test evidence

- Critical: NONE.
- High: API success/latency and DB operational behavior are not observable as
  bounded structured signals; worker/outbox failure and backlog are not exposed
  through a production-consumable health/metrics contract.
- Medium: correlation is discontinuous across the Telegram outbox and selected
  autonomous database events; redaction is tested as a primitive rather than at
  every logging boundary; error categories and metric cardinality contracts are
  not centrally enforced.
- Low: full tracing, exemplars and a provider-specific exporter are optional and
  not justified for the current topology.

`npm test` passed: 15 frontend/auth tests and 138 API tests. Existing tests cover
safe provider errors, redaction primitives, health/schema/optional dependency
semantics, worker lifecycle basics, provider failures and AI/Telegram OFF gates.
The P10-specific tests listed above do not yet exist.

## Production-readiness classification

| Capability | Classification |
| --- | --- |
| Structured logging, correlation, HTTP/DB/worker/domain metrics, redaction enforcement | NEEDS P10 CODE HARDENING |
| API health | READY foundation; P10 signal validation required |
| API readiness | READY foundation; P10 contract hardening required |
| Worker health/readiness | NEEDS P10 CODE HARDENING |
| Audit authority | READY; retention/access is external policy work |
| OpenTelemetry/full tracing | OPTIONAL / NOT REQUIRED |
| Specific telemetry provider/exporter | EXTERNAL COMPANY DECISION; not required for P10 implementation |
| Retention | EXTERNAL COMPANY DECISION |
| Alert thresholds/routes/SLO ownership | P11 ALERTING |
| Network restriction for metrics and collection | P13 INFRASTRUCTURE |
| Backup/DR | P12 BACKUP/DR |

No runtime, tests, database, migration, role, frontend, Redis, scheduler or P11
change was made by this audit. Overall Production remains NOT READY.

Next authorization required: explicitly authorize P10 vendor-neutral
observability code hardening and its tests, while keeping provider selection,
alert policy and infrastructure deployment out of scope.

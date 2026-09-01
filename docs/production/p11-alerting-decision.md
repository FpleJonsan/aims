# AIMS P11 Alerting and Operational Response Decision

Status: DECISION COMPLETE — P11 CODE/DOCUMENTATION HARDENING REQUIRED; NO
PROVIDER SELECTION REQUIRED YET.

Baseline: `main` at `d9d7545`, clean worktree, schema 58,
`058_p10_observability_claim_recovery_and_outbox_index`, no migration 059+, P6
through P10 PASS/FROZEN, Production AI OFF, Production Telegram OFF, and no
Redis, scheduler, observability provider or alert provider. The separate
Pre-P11 conformance audit returned decision B with no Critical, High or Medium
finding and explicitly authorized P11 entry. Its frontend findings remain
untouched.

## Decision and authority boundary

P11 must produce a provider-neutral alert specification, severity contract,
runbook set, recovery/grouping rules, ownership matrix and testable rule
semantics before Production deployment. No application-runtime or database
change is justified by this audit. Alerting is an operational request for human
attention; it is never workflow, Approval, Finance Control, Payment or
financial authority. Alert evaluation or delivery failure must not affect a
business transaction.

Decision: **P11 CODE/DOCUMENTATION HARDENING REQUIRED — NO PROVIDER SELECTION
REQUIRED YET.** A company alerting/on-call platform is required before actual
Production routing and paging, but provider-neutral specifications and
runbooks can be completed first. P13 owns private collection/exposure and P17
owns staging validation. P15 evidence is required for performance and capacity
thresholds.

## Event, warning, alert and page

- **Event:** one bounded operational occurrence; retained for diagnosis.
- **Warning:** observable degradation or pattern not yet requiring response.
- **Alert:** sustained or deterministic condition requiring human action.
- **Page:** urgent alert requiring immediate response.

Normal Approval rejection, clarification, deterministic Finance Control FAIL,
document rejection, and Payment `IDEMPOTENT_REPLAY` are business outcomes, not
infrastructure incidents. A repeated `PAYLOAD_MISMATCH` pattern is a bounded
security/integration signal; no payload, fingerprint or bank reference may be
included.

## Proposed severity semantics

| Severity | Meaning | Typical response |
| --- | --- | --- |
| SEV-1 / Critical | Major outage or credible security/financial-integrity risk with immediate Production impact | Immediate page and incident command |
| SEV-2 / High | Major degradation or loss of an essential capability | Urgent page/on-call response |
| SEV-3 / Medium | Degraded capability or accumulating operational risk | Alert to responsible operational queue |
| SEV-4 / Low | Non-urgent operational follow-up | Ticket/business-hours response |

Company alignment, response times and communication obligations remain an
external decision under D-017. Severity never authorizes a business mutation.

## Candidate alert catalogue

Thresholds shown as deterministic or TBD are specifications, not deployed
rules. Evidence-based values must not be guessed.

| Area | Condition | Existing P10 input | Severity | Recovery | Threshold source | Primary owner | Runbook |
| --- | --- | --- | --- | --- | --- | --- | --- |
| API | Process/target unavailable | liveness plus target presence | High; Critical if complete sustained outage | process and target healthy | Business duration + platform mechanics | SRE / Backend | Required |
| API | Required readiness failure | `aims_readiness_status`, `readiness_failed` | High | all required components ready | Deterministic with anti-flap duration | SRE / component owner | Required |
| API | Sustained 5xx increase | HTTP count by safe route/status class | High/Medium | rate returns to normal | P15 evidence + business decision | Backend / SRE | Required |
| API | Sustained latency degradation | request-duration histogram | Medium/High | latency returns below approved objective | P15 load/soak evidence | Backend / SRE | Required |
| Schema | Runtime schema behind/ahead of 58 | readiness schema component | High | expected schema 58 observed | Deterministic | SRE / DBA | Required |
| Database | Complete unavailability | readiness + DB operation failures | Critical/High | connectivity and readiness restored | Deterministic plus sustained duration | SRE / DBA | Required |
| Database | Pool waiting/exhaustion risk | pool waiting/total/idle gauges | Medium/High | waiting returns below approved limit | P15 capacity evidence | DBA / Backend | Required |
| Database | Timeout/lock/transaction degradation | DB outcomes/duration/failure categories | Medium/High | bounded error/latency condition clears | P15 evidence | DBA / Backend | Required |
| Database | Trusted executor unavailable | readiness + executor operation failure | High; Critical for affected Payment integrity incident | executor capability healthy | Deterministic/sustained | DBA / Backend / Finance Ops | Required |
| Worker | Worker unavailable/not ready | `aims_worker_up`, worker readiness/target | High for required scan workload | worker healthy and ready | Deterministic with anti-flap duration | SRE / Backend | Required |
| Worker | Backlog age/growth | backlog and oldest-pending gauges | Medium/High | age/growth below approved threshold | P15 + provider evidence | Backend / SRE | Required |
| Worker | Repeated expired-lease recovery | authoritative recovery counter | Medium | recovery rate returns to normal | Evidence-based | Backend / SRE | Required |
| Documents | Terminal scan failure/backlog | document terminal outcome/backlog | High/Medium | terminal condition investigated and queue healthy | Deterministic existence + business duration | Security / Backend | Required |
| Documents | Scanner or storage unavailable | readiness and bounded worker failure category | High | provider healthy and readiness restored | Deterministic/sustained | Security / SRE | Required |
| Telegram | Enabled delivery backlog/terminal failure | Telegram backlog, oldest age, provider outcomes | Medium | delivery queue/provider recovers | Evidence-based | Telegram owner / SRE | Required if enabled |
| Telegram | Repeated 429/provider outage | bounded provider outcomes | Medium | success rate recovers | Provider/staging evidence | Telegram owner | Required if enabled |
| AI | Enabled provider error/timeout/schema failure | provider outcomes/duration and usage failures | Medium/Low because manual path remains | provider success recovers | Provider/staging evidence | AI owner / Backend | Required if enabled |
| Authentication | Sustained login/401/403 increase | domain outcomes by bounded category | Medium; security escalation by pattern | rate returns to baseline | Staging/Production evidence | Security / Backend | Required |
| Security | CSRF/origin, webhook-secret or invalid-action pattern | bounded auth/domain outcomes | High/Medium | attack/error pattern ceases and cause is contained | Security policy + evidence | Security / SRE | Required |
| Approval | Sustained internal/concurrency failure | domain/DB outcomes | Medium/High | successful processing restored | Evidence-based | Backend / Approval owner | Required |
| Finance Control | Executor/infrastructure failure | domain and DB executor outcomes | High | deterministic control service healthy | Deterministic/sustained | Backend / DBA / Finance Ops | Required |
| Payment | Infrastructure/executor/rollback failure | Payment and DB outcomes | Critical/High by integrity/availability impact | transaction path verified healthy and reconciled | Deterministic + business duration | Backend / DBA / Finance Ops | Required |
| Payment | Repeated `PAYLOAD_MISMATCH` | bounded Payment outcome | High/Medium security/integration signal | pattern stops and source is investigated | Security policy + evidence | Security / Backend | Required |
| Payment | Elevated idempotent replay | `IDEMPOTENT_REPLAY` outcome | Low/Medium reliability warning | replay rate returns to baseline | Evidence-based | Backend / SRE | Optional runbook |

One transient DB/provider failure, one authentication mistake, one lease
recovery or one idempotent replay remains an event unless deterministic
integrity impact or approved evidence says otherwise.

## Current P10 signal sufficiency and gaps

P10 provides suitable candidate inputs for HTTP availability/error/latency,
component readiness/schema, DB pools/operations/duration, worker lifecycle,
backlog/age/recovery, document and Telegram work outcomes, enabled AI provider
outcomes, auth/security categories, and Finance Control/Payment operational
outcomes. Signals are bounded and contain no financial truth.

Missing or deployment-owned inputs:

- target/scrape disappearance and alert-evaluator health require the selected
  P13 collection/evaluation platform;
- repeated process restart requires orchestration/deployment evidence;
- host/container resource, managed PostgreSQL and provider-native health are
  infrastructure inputs;
- no approved baselines exist for latency, error rate, pool wait, backlog age,
  lease recovery or provider performance;
- no company severity, on-call, security escalation or notification-routing
  assignment exists.

These gaps do not justify inventing application metrics or thresholds.

## SLI and SLO decision

Candidate SLIs are API availability, API latency, API error rate, readiness, DB
availability, worker availability, oldest backlog age, document completion,
Telegram delivery success when enabled and AI provider success when enabled.

Schema match, required readiness, process state and forbidden optional-OFF
dependency checks are deterministic now. Latency, error-rate, pool, backlog and
provider objectives need P15/staging evidence. Acceptable outage windows and
response commitments require business/on-call decisions. Formal error-budget
policy is **not required for Production v1 foundation**; owned thresholds,
recovery semantics and tested runbooks are sufficient initially.

## Recovery, grouping, flapping and missing data

Every future rule must specify a firing condition and observable recovery.
Group by environment, service, component, workload, operation and bounded
failure category—never request, user, Payment, document, Telegram identity or
correlation ID. The selected platform must support deduplication, grouping,
suppression, maintenance windows and resolved notifications.

Readiness, DB, worker and provider alerts require sustained/consecutive
evaluation and a recovery hold to avoid flapping; exact durations remain TBD.
Missing samples are not automatically healthy. Target missing, evaluator
unavailable and notification-delivery failure require minimum self-monitoring
owned by P13 and the selected platform.

## Runbook contract

Required runbooks: API unavailable, DB unavailable/degraded, schema mismatch,
worker unavailable/backlog, terminal document failure, scanner/storage outage,
Telegram outage when enabled, AI degradation when enabled, security signal,
Finance Control infrastructure failure and Payment infrastructure/integrity
failure.

Each runbook must contain symptom, impact, safe verification, first response,
escalation, recovery proof, rollback/reference and prohibited actions. It must
never instruct direct PAID/ledger/commitment/Approval/Finance-Control SQL
changes, trigger disabling, runtime superuser grants or historical migration
edits.

## Ownership and escalation

- Application/Backend: API, domain operations, worker and application defects.
- Platform/SRE: process, target, deployment, routing and incident coordination.
- DBA: PostgreSQL availability, pool/lock behavior, executors and schema.
- Security: authentication/webhook/action patterns and data exposure.
- Finance Operations: Payment/Finance-Control impact and reconciliation.
- AI owner: enabled AI provider degradation and usage operations.
- Telegram owner: enabled bot/provider delivery.

Cross-functional escalation is required for DB outage (SRE + DBA), Payment
failure (Backend + DBA + Finance Ops), Finance Control infrastructure failure
(Backend + DBA + Finance Ops), and attack signals (Security + SRE). Actual
people, schedules and response targets require external assignment.

## Security and privacy

Alert payloads may contain only service, environment, operation, bounded
component/failure category, severity and runbook reference. They must exclude
credentials, tokens, cookies, connection strings, raw SQL/errors, request/user
identifiers, payee/purpose, amounts, bank references, documents, filenames and
provider payloads. Destination access, retention, forwarding, device exposure,
residency and cross-border policy remain company decisions.

## Test strategy for future P11 hardening

Future specification/rule tests must prove deterministic firing and recovery,
grouping/cardinality, no sensitive alert content, schema mismatch, target/worker
down, backlog and terminal failure, Payment mismatch patterns, security-rate
conditions, AI OFF and Telegram OFF suppression, and exclusion of normal
business outcomes. Provider integration tests wait for provider selection.

## Production-readiness classification

| Capability | Classification |
| --- | --- |
| Severity model and candidate catalogue | READY decision foundation; company alignment open |
| API/DB/worker/document/control/Payment candidates | READY inputs; NEEDS P11 specification/runbooks |
| Telegram/AI candidates | OPTIONAL while OFF; NEEDS P11 specification before enablement |
| Recovery/grouping/cardinality/privacy contract | READY decision foundation; NEEDS P11 hardening tests |
| Thresholds and performance SLOs | P15 PERFORMANCE EVIDENCE / BUSINESS DECISION |
| Runbooks and role ownership matrix | NEEDS P11 DOCUMENTATION HARDENING |
| Named owners, on-call and escalation targets | EXTERNAL COMPANY DECISION |
| Alert/observability provider and notification routes | EXTERNAL COMPANY DECISION / P13 INFRASTRUCTURE |
| Staging exercise | P17 STAGING VALIDATION |
| Evaluator/target/delivery self-monitoring | P13 INFRASTRUCTURE |

## Audit risk and freeze

- Critical: NONE.
- High: no deployed alert provider, routing or on-call ownership is a genuine
  Production deployment blocker, not a current P10 application defect.
- Medium: thresholds, runbooks, recovery tests and company severity alignment
  remain incomplete P11/external work.
- Low: formal error budgets and provider-specific rule format can wait for
  platform maturity.

No runtime, tests, migration, database, role, grant, frontend, provider, Redis,
scheduler, P10 or P12 change was made. Production AI and Telegram remain OFF.
The Pre-P11 frontend findings `PC-LOW-001` and `PC-INF-001` remain untouched.

Next authorization required: explicitly authorize P11 provider-neutral
alert-specification, runbook and governance hardening with tests, while keeping
provider deployment, notification routing, runtime changes, database changes,
frontend work and P12 out of scope.

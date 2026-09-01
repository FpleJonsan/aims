# AIMS P11 Provider-Neutral Alert Catalogue

Status: IMPLEMENTED / FROZEN REVIEW PENDING.

The canonical machine-reviewable contract is
`apps/api/src/infrastructure/observability/alert-specification.ts`. This document
is its operator-facing index. No specification is a business rule or deployed
provider rule. Numeric thresholds remain deliberately unresolved where P15,
Security, Finance, company standards or provider evidence owns the decision.

Classification is `EVENT`, `WARNING`, `ALERT` or `PAGE`; severity is `LOW`,
`MEDIUM`, `HIGH` or `CRITICAL`. A classification describes operational response,
not AIMS authority. Alert evaluation/delivery cannot mutate business state.

| Key | Class / severity | Component and signal | Threshold owner | Recovery | Feature | Owner / runbook | Future dependency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `API_TARGET_UNAVAILABLE` | PAGE / HIGH | API target + liveness | Company standard | target/liveness healthy | Always | SRE / API | P13 |
| `API_REQUIRED_READINESS_FAILURE` | ALERT / HIGH | readiness gauge/event | Deterministic | all required ready | Always | SRE / API | P13 duration |
| `API_5XX_RATE_DEGRADATION` | WARNING / MEDIUM | HTTP outcomes | P15 | rate recovers | Always | Backend / API | P15/P13 |
| `API_LATENCY_DEGRADATION` | WARNING / MEDIUM | HTTP duration | P15 | latency recovers | Always | Backend / API | P15 |
| `SCHEMA_VERSION_MISMATCH` | ALERT / HIGH | schema readiness | Deterministic | schema 58 | Always | DBA / schema | P13 |
| `DATABASE_UNAVAILABLE` | PAGE / CRITICAL | readiness + DB outcomes | Business | DB/executors healthy | Always | DBA / DB | company/P13 |
| `DATABASE_POOL_DEGRADATION` | WARNING / MEDIUM | pool gauges | P15 | wait pressure clears | Always | DBA / DB | P15 |
| `DATABASE_TIMEOUT_LOCK_DEGRADATION` | ALERT / HIGH | DB outcome/duration | P15 | failures recover | Always | DBA / DB | P15 |
| `TRUSTED_EXECUTOR_FAILURE` | ALERT / HIGH | executor readiness/outcomes | Deterministic | executor healthy | Always | DBA / DB | P13 |
| `WORKER_TARGET_UNAVAILABLE` | ALERT / HIGH | target, up, readiness | Company standard | worker ready | Always | SRE / worker | P13 |
| `WORKER_BACKLOG_AGE_GROWTH` | WARNING / MEDIUM | backlog/oldest age | P15 | age/growth recover | Always | Backend / worker | P15 |
| `WORKER_TERMINAL_BACKLOG` | ALERT / HIGH | terminal backlog | Business | terminal work reconciled | Always | Backend / worker | policy |
| `WORKER_LEASE_RECOVERY_RATE` | WARNING / MEDIUM | recovery counter | P15 | rate normal | Always | Backend / worker | P15 |
| `DOCUMENT_TERMINAL_FAILURE_BACKLOG` | ALERT / HIGH | terminal scan work | Business | queue reconciled | Always | Security / documents | policy |
| `SCANNER_STORAGE_UNAVAILABLE` | ALERT / HIGH | readiness/failure category | Deterministic | providers healthy | Always | Security / documents | P3/P4/P13 |
| `TELEGRAM_DELIVERY_DEGRADATION` | WARNING / MEDIUM | backlog/provider outcome | Provider evidence | delivery recovers | Telegram enabled | Telegram owner / optional | external |
| `AI_PROVIDER_DEGRADATION` | WARNING / LOW | provider outcome/duration | Provider evidence | provider recovers | AI enabled | AI owner / optional | external |
| `AUTH_SECURITY_FAILURE_PATTERN` | ALERT / HIGH | bounded auth/security outcomes | Security policy | contained/normal | Always | Security / security | policy |
| `FINANCE_CONTROL_INFRASTRUCTURE_FAILURE` | ALERT / HIGH | domain/executor outcomes | Deterministic | technical path healthy | Always | Backend / control | P13 |
| `PAYMENT_INFRASTRUCTURE_FAILURE` | PAGE / CRITICAL | domain/executor/DB outcomes | Business | healthy and reconciled | Always | Backend / Payment | company/P13 |
| `PAYMENT_PAYLOAD_MISMATCH_PATTERN` | ALERT / HIGH | mismatch outcome | Security policy | pattern contained | Always | Security / Payment | policy |
| `PAYMENT_IDEMPOTENT_REPLAY_RATE` | WARNING / LOW | replay outcome | P15 | rate normal | Always | Backend / Payment | P15 |

## Missing data and suppression

Zero is a current metric value; no samples are unknown. Target absence,
collector failure and provider absence must be distinguished by P13. Missing AI
or Telegram samples are healthy when the relevant feature is OFF. Maintenance
or deployment suppression requires an approved external window. Every
actionable rule must use bounded deduplication/grouping and send recovery after
its documented recovery condition and hold.

Allowed grouping dimensions are `environment`, `service`, `component`,
`workload`, `operation` and `failure_category`. Dynamic business identifiers and
financial values are prohibited.

## Explicit non-incidents

Approval rejection/clarification, deterministic Finance Control FAIL,
document REJECTED, Payment SUCCESS, Payment `IDEMPOTENT_REPLAY`, policy denial,
legitimate authorization denial and optional AI manual fallback do not create
infrastructure incidents. A single `PAYLOAD_MISMATCH` is not an automatic page.


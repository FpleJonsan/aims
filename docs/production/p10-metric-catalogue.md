# AIMS P10 Metric and Alert-Input Catalogue

All metrics are operational-only. Label schemas are centrally enforced;
identifiers, user-controlled text, raw errors and financial values are absent.
Duration histograms use fixed seconds buckets: `0.005`, `0.01`, `0.025`,
`0.05`, `0.1`, `0.25`, `0.5`, `1`, `2.5`, `5`, `10`, `30`. These buckets do
not define an SLO.

| Metric | Type | Meaning | Labels | Sensitivity/source |
| --- | --- | --- | --- | --- |
| `aims_http_requests_total` | Counter | Completed API requests | `method`, `route`, `status_class` | Safe route templates / HTTP middleware |
| `aims_http_request_duration_seconds` | Histogram | API duration | `method`, `route` | Operational timing only |
| `aims_readiness_status` | Gauge | Component state: not-ready 0, ready 1, disabled 2 | `component` | Bounded API readiness components |
| `aims_db_pool_connections` | Gauge | Pool total/idle/waiting | `pool`, `state` | Connection counts only |
| `aims_db_operations_total` | Counter | Transaction/executor/pool/retry outcome | `pool`, `operation`, `outcome`, `failure_category` | No SQL or parameters |
| `aims_db_operation_duration_seconds` | Histogram | DB operation duration | `pool`, `operation` | No query contents |
| `aims_worker_up` | Gauge | Worker process lifecycle | none | Process only |
| `aims_worker_work_total` | Counter | Claims/polls/success/retry/terminal outcomes | `workload`, `outcome`, `failure_category` | Aggregate work only |
| `aims_worker_work_duration_seconds` | Histogram | Workload duration | `workload` | No job identifiers |
| `aims_worker_lease_recoveries_total` | Counter | Successful authoritative expired-lease reclaims | `workload` | Locked claim result or successfully reclaimed stale outbox claim |
| `aims_worker_backlog` | Gauge | Pending/retrying/claimed/terminal/expired work | `workload`, `state` | Indexed/durable aggregate state |
| `aims_worker_oldest_pending_seconds` | Gauge | Oldest eligible work age | `workload` | Aggregate age only |
| `aims_domain_operations_total` | Counter | Auth, Approval, Finance Control and Payment outcomes, including `SUCCESS`, `IDEMPOTENT_REPLAY`, and `PAYLOAD_MISMATCH` | `operation`, `outcome`, `failure_category`, `channel` | Counts only |
| `aims_domain_operation_duration_seconds` | Histogram | Domain operation duration | `operation`, `channel` | No business values |
| `aims_provider_operations_total` | Counter | Telegram/AI provider outcome | `provider`, `surface`, `outcome`, `failure_category` | Safe category only |
| `aims_provider_operation_duration_seconds` | Histogram | Provider duration | `provider`, `surface` | No provider payload |
| `aims_ai_tokens_total` | Counter | Known provider input/output token usage | `surface`, `direction` | No prompts/evidence; absent when unknown/OFF |

## P11 alert inputs (no thresholds authorized)

| Future condition | Inputs |
| --- | --- |
| API unavailable/error/latency | HTTP request count/duration plus liveness |
| Readiness or schema failure | `aims_readiness_status` and readiness events |
| Database unavailable/contention | DB operation outcomes/duration and pool waiting |
| Worker unavailable/stale | `aims_worker_up`, workload results and orchestration health probes |
| Backlog/expired lease | Worker backlog, oldest-pending gauges and authoritative recovery counter |
| Terminal document failure | Document-scan terminal outcome/backlog series |
| Terminal Telegram failure | Telegram-delivery terminal/provider series |
| Enabled-AI provider failure | AI provider outcomes/duration (AI OFF is normal) |
| Authentication/security increase | Bounded `LOGIN`, `SESSION_AUTHENTICATE`, `CSRF_ORIGIN`, 401 and 403 outcomes |
| Finance Control/Payment operational failure | Bounded domain outcomes/durations and DB executor outcomes |

The API and worker metric endpoints are infrastructure surfaces. P13 must
restrict them; P10 does not configure a firewall, collector or provider.

Telegram backlog gauges are sampled at most once per process minute. Active
and terminal status queries use separate partial indexes and exclude historical
`SENT` rows through top-level predicates. Sampling is non-authoritative and is
not persisted. P11 may consume these inputs, but no threshold is configured.

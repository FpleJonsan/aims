# AIMS Production Roadmap

The proposed schedule is a sequencing framework, not a calendar commitment. Twenty delivery checkpoints are plausible only with timely company decisions, parallel platform/security work, dedicated Finance UAT participants, and access to staging infrastructure. P1 identity architecture is documented, but implementation remains blocked on Company IT/Security inputs.

| Phase | Objective and scope | Dependencies | Exit gate | Verification |
| --- | --- | --- | --- | --- |
| P0 | Baseline, gap analysis, target architecture, decisions, scope and roadmap | Frozen competition release | Five required P0 documents reviewed; no business behavior change | Unit/lint/type/build; senior review |
| P1 | Identity decision architecture: current-flow discovery, trust boundary, claim/session/mapping contract, staging requirements and threat/test plans | D-001, D-002 | Architecture/security review passes; unresolved company inputs explicit | [Identity architecture](production-identity-architecture.md); read-only security review |
| P2 | Plug approved OIDC/SSO or trusted proxy into the P1-L provider-independent session boundary; complete Production lifecycle policy | P1/P1-L, test tenant | Production catalogue absent; spoofing/replay/session tests pass | Auth integration, inactive/revoked user, workspace/SoD regression |
| P3 | Private object-storage adapter, encryption, versioning/lifecycle, authorized reads and staging configuration | D-003, D-013, P5 interface | Local adapter impossible in staging/prod; object reconciliation defined | Upload/read/IDOR/hash/version failure tests |
| P4 | Malware quarantine/scan/release worker and durable scan evidence | P3, D-004, P7 worker contract | Only CLEAN versions can become evidence; error/infected remain unavailable | Scanner outage, poison file, retry, staleness and authorization tests |
| P5 | Secret manager integration, environment separation, workload identity and rotation runbooks | D-002, D-005 | No secrets in images/files; independent credential rotation rehearsed | Secret scan, startup fail-closed, rotation smoke |
| P6 | Production PostgreSQL service, TLS, roles, pool/timeouts, migration/bootstrap and backup ownership | D-007, D-015, D-018, P5 | Clean production-like migration; least-privilege roles; synthetic fixtures excluded | Full PostgreSQL suite, role matrix, migration integrity, reconciliation |
| P7 | Decide Redis; implement reliable worker/outbox processing, supervision, retries, backlog/dead-letter and graceful deployment | D-008, D-014, P5-P6 | Crash/restart/duplicate delivery cannot corrupt state; backlog observable | Failure injection, lease recovery, Redis outage if used |
| P8 | Production AI governance: privacy, provider/model, timeout, circuit breaker, cost/token limits and AI OFF operations | D-009, D-010, P5, P10 interface | Approved data contract; AI outage cannot block core workflow | Schema/injection/redaction/outage/cost tests; AI OFF UAT |
| P9 | Decide Telegram and other external integrations; disable or productionize | D-011, P5, P7, P10 interface | Unsupported channels disabled; enabled channels monitored and rotated | Webhook TLS/replay/identity/retry/redaction tests |
| P10 | Structured logs, correlation, safe audit access, metrics and dashboards | D-006, D-014, P6-P9 signals | Operators can trace a request without exposing sensitive data | Redaction tests, dashboard signal validation |
| P11 | Alerting, SLO/SLA inputs, on-call routing and financial stop-the-line automation/runbooks | P10, D-017 | Actionable alerts have owners and tested routes | Alert exercises for DB, storage, worker, payment and AI |
| P12 | Backup, PITR, object protection, DR procedure and isolated restore rehearsal | D-012, D-013, P3, P6 | RPO/RTO approved; restored AIMS reconciles documents and finances | Restore evidence and invariant queries |
| P13 | Repeatable deployment, TLS, trusted edge, private networking, CI/CD and migration job | D-002, D-016, P2-P12 | Staging deploy is immutable, gated, and repeatable | Pipeline, TLS/header, network and rollback smoke |
| P14 | Production security red-team across identity, storage, secrets, network, DB, workers, AI and integrations | P13 | No unresolved Critical/High; Medium disposition approved | New production attacks plus all competition regressions |
| P15 | Capacity model, load/performance, pools, indexes, queues and `RT-LOW-001` decision | D-014, P10, P13 | Approved peak workload meets SLO without authority/integrity regression | Load, soak, lock contention and large-history reporting tests |
| P16 | Finance UAT with all eight personas, approved policies, bootstrap data and operational procedures | P2-P15, Finance participants | Formal business acceptance; reconciled test cycle | Persona scripts, exception paths, reconciliation sign-off |
| P17 | Staging release candidate and production-like migration rehearsal | P16, D-016 | Versioned RC passes full gates in staging | Full automated suite, smoke, migration and rollback rehearsal |
| P18 | Go-live rehearsal: cutover, rollback/forward-fix, communications, restore and stop-the-line | P17 | Timed rehearsal meets RTO and support expectations | End-to-end rehearsal evidence |
| P19 | Production readiness review | P18 | Security, Finance, Architecture, SRE, DBA and business owners approve or reject | Checklist and open-risk sign-off |
| P20 | Controlled go-live | P19 approval | Monitored release, opening reconciliation and support handoff complete | Post-deploy smoke, reconciliation, alert/watch period |

## Dependency map

```text
P0
 |-- Identity P1-P2 -------------------------|
 |-- Documents P3-P4 --|                     |
 |-- Secrets P5 -------+-- DB P6 -- Workers P7
 |-- AI governance P8 (can launch OFF)       |
 |-- Integrations P9 (can disable)           |
 |                                           v
 +------------------------------------ Observability P10-P11
                                             |
                                      Backup / DR P12
                                             |
                                  Deployment / TLS / CI P13
                                             |
                                      Security review P14
                                             |
                                       Performance P15
                                             |
                                         Finance UAT P16
                                             |
                                      Staging RC P17
                                             |
                                       Rehearsal P18
                                             |
                                  Readiness review P19
                                             |
                                     Controlled live P20
```

## Parallelization opportunities

- After P0 decisions, identity design, object-storage design, secret-manager integration, PostgreSQL platform work, and observability schema can proceed in parallel with shared architecture checkpoints.
- P3 object adapter and P7 worker reliability can begin in parallel, but malware promotion in P4 depends on both.
- AI governance and the Telegram decision can proceed in parallel; launch may keep either feature disabled.
- Backup design can start with PostgreSQL/object design, but the restore exit gate waits for deployed staging components.
- Finance UAT preparation—personas, policies, acceptance criteria, bootstrap datasets—can begin early, while execution waits for P15.

## Hard dependencies

- IdP and trusted-edge decisions precede production authentication implementation.
- Hosting and secret-manager decisions precede production DB/storage/worker deployment.
- Object storage precedes malware promotion.
- Production-like DB and documents precede meaningful restore rehearsal.
- Telemetry precedes alert validation, security assurance, performance diagnosis and go-live support.
- Security and performance gates precede Finance UAT sign-off and staging RC.
- Restore rehearsal, rollback rehearsal and stakeholder approval precede go-live.

## Realism assessment

The sequence is sound, but a literal 20-day elapsed schedule is high risk unless environments, vendors, privacy decisions, company engineers, DBA/SRE support, and Finance UAT participants are already available. Treat phases as gated work packages. P1-P9 and early P10 design can overlap; P12-P20 contain hard evidence gates that must not be compressed merely to meet a date.

## Release and rollback strategy

- Work from `production/v1`; never move competition tags.
- Build one immutable artifact set for web, API and workers; promote the same digest through staging.
- Use protected staging RC and production tags after approved gates.
- Roll back stateless application artifacts/configuration when safe. For financial schema and data, prefer reviewed forward fixes; never assume destructive down migrations are safe.
- Emergency patches require targeted regression, affected integrations, UAT scope, migration/data reconciliation, staging smoke and a new immutable tag.

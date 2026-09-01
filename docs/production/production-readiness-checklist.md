# AIMS Production Readiness Checklist

Initial P0 status reflects repository evidence. `BLOCKED` means required production work or an external decision remains; it is not a competition defect.

| Gate | Initial status | Evidence required for PASS |
| --- | --- | --- |
| Frozen competition release recoverable | PASS | Tags resolve to frozen commits; competition remains runnable. |
| Production branch isolated | PASS | P0 work occurs on `production/v1`. |
| 12-stage workflow preserved | PASS | No order, merge, shortcut or authority regression. |
| Financial equation/invariants | PASS | PostgreSQL integration, concurrency and reconciliation suites remain green. |
| Payment execution boundary | PASS | AIMS records external payment and never transfers money. |
| AI OFF | PASS | Complete deterministic/manual workflow and UAT pass without provider. |
| Production identity architecture | PASS | [P1 identity architecture](production-identity-architecture.md) defines trust, mapping, claim, session, lifecycle, threat and test contracts. |
| Corporate identity / SSO | BLOCKED | Approved IdP, issuer/audience validation, secure session/logout, lifecycle and spoofing tests. |
| Identity-to-authority administration | BLOCKED | Approved mapping and joiner/mover/leaver process; ADMIN remains non-operational. |
| Local identity/session foundation | PASS | P1-L namespaced mapping, hashed opaque session, CSRF/origin control, revocation, logout and fail-closed environment tests. |
| Authorization regression | PARTIAL | Local session preserves current PostgreSQL authority evaluation; real IdP/staging identity and full Production regression remain blocked. |
| Private object storage | BLOCKED | Encrypted private quarantine/clean storage, authorized reads, version/hash reconciliation. |
| Malware protection | BLOCKED | Real scanner, durable verdict, retry/error handling and promotion-only-after-CLEAN proof. |
| Secret-management foundation | PASS | Provider-independent inventory, classification, environment validation, redaction, ownership, rotation and incident contracts are tested/documented. |
| Production secret integration | BLOCKED | Selected store, workload identity/runtime injection, independent rotation and operational audit. |
| PostgreSQL role/runtime foundation | PASS | Disposable clean bootstrap, NOLOGIN ownership, executor separation including the document worker, defaults, drift checks, TLS/database identity validation and schema-58 UAT pass. |
| Production PostgreSQL deployment | BLOCKED | Selected service/version, private TLS/CA distribution, HA, capacity, role/secret provisioning and monitoring. |
| Migration/bootstrap | BLOCKED | Production-safe migration path excludes fixtures; checksum/manifest and clean rehearsal pass. |
| Redis decision | PASS | P7 confirms Redis is not required for Production v1; P15 may reopen only with measured evidence. |
| PostgreSQL-backed worker | PASS FOUNDATION | Independent process, durable scan claims, optional unattended outbox dispatch, bounded retry/terminal failure, safe health signals and graceful shutdown are implemented without Redis. Production providers/deployment remain blocked. |
| Worker reliability | PARTIAL | Lease recovery, stale-worker rejection, poison handling and graceful shutdown pass; Production supervision, centralized telemetry/alerts and provider SLA evidence remain blocked. |
| AI governance foundation | PASS | Provider deadlines/retry/response bounds, exact Validation manifests, Risk evidence catalogs, input/output limits, minimized projections and linked traceability are implemented. Production AI remains OFF. |
| AI provider governance | DECISION REQUIRED | After code hardening, approve provider/model, permissible data, retention/training/residency/deletion terms, cost policy and operational ownership—or launch with AI OFF. |
| Telegram | CODE FOUNDATION PASS / EXTERNAL GATES OPEN | P9 hardening and final review PASS. Keep OFF pending approved bot/token custody, privacy, monitoring and edge controls. |
| Structured logging/redaction | P10 PASS / FROZEN | Structured stdout/stderr, safe request/worker fields, fixed taxonomy and representative AI/document/Payment/Telegram redaction canaries pass; company collection/access/retention remains external. |
| Metrics/alerting | P11 PASS / FROZEN; DEPLOYMENT BLOCKED | Provider-neutral specifications, catalogue, runbooks, tests and five-discipline frozen review PASS. Company platform/on-call decisions and P13 private collection/evaluation/routing remain open. |
| Correlation and audit trace | P10 PASS / FROZEN | HTTP/domain/audit and existing-payload outbox/worker correlation pass. Audit remains authoritative; operational retention/export remains external. |
| PostgreSQL backup/PITR | P12 DECISION COMPLETE / BLOCKED | PITR is required capability, but provider-neutral checker/manifest hardening, encrypted schedule, retention, isolated protection and ownership remain incomplete. |
| Object backup/versioning | P12 DECISION COMPLETE / BLOCKED | DB/object recovery must be manifest-bound and fail closed on missing/version/hash mismatch; provider versioning/backup/immutability and policy remain absent. |
| Restore rehearsal | P12 DECISION COMPLETE / BLOCKED | Implement read-only verification/reconciliation and complete an isolated restore that validates schema, privileges, finances, documents, application, workers and current external reality. |
| RPO/RTO | COMPANY DECISION REQUIRED | No numeric target is approved or invented; Finance, business continuity, SRE and provider evidence must define and prove targets. |
| Deployment artifacts | BLOCKED | Versioned immutable web/API/worker artifacts and production manifests. |
| CI/CD gates | BLOCKED | Lint, types, unit, PostgreSQL integration, build, scans, migration validation, staging smoke and approval. |
| TLS / trusted proxy | BLOCKED | HTTPS, header stripping/trust chain, secure cookies if used, HSTS decision and tests. |
| Private network | BLOCKED | PostgreSQL, Redis, workers, executors and object storage are non-public. |
| Rate/resource controls | BLOCKED | Usage-informed auth/write/upload/AI/export/webhook limits and abuse tests. |
| Dependency/supply chain | BLOCKED | Lock enforcement, vulnerability/artifact/container scans and update ownership; SBOM decision. |
| Capacity inputs | DECISION REQUIRED | Users, departments, request/document/payment volumes, concurrency and history. |
| Performance/load | BLOCKED | Peak, soak, contention, queue and reporting tests meet approved SLO. |
| `RT-LOW-001` disposition | ACCEPTED | Evaluate against production capacity in P15; preserve authorization semantics. |
| Data retention/legal hold | POLICY DECISION REQUIRED | Approved rules for requests, documents, audit, AI, approvals, payments, ledger and notifications. |
| Production bootstrap/data migration | DECISION REQUIRED | Approved opening data, reconciliation, cutover and rollback ownership. |
| Finance UAT | BLOCKED | Eight personas complete approved real-rule scenarios; Finance stakeholders sign off. |
| Production security red-team | BLOCKED | New identity/storage/secrets/network/worker/AI tests plus existing control regressions. |
| Staging RC | BLOCKED | Production-like environment passes all gates using immutable artifacts. |
| Rollback/forward-fix | BLOCKED | Application rollback and safe schema forward-fix rehearsed; no destructive assumption. |
| Incident response | P11 PASS / FROZEN; EXTERNAL GATES BLOCKED | Severity, ownership and runbook contracts passed frozen review; company alignment, named on-call, communications, response targets and financial stop-the-line exercises remain required. |
| Go-live approval | BLOCKED | P19 review accepted by Finance, Security, Architecture, SRE/DBA and business owners. |
| Opening reconciliation | BLOCKED | Post-deploy budgets, commitments, payments, ledger, documents and authorities reconcile. |

## Financial stop-the-line checklist

Suspend affected mutation paths and escalate immediately for any payment/ledger mismatch, `PAID` without exactly one payment, ledger without payment, commitment mismatch, duplicate payment, unauthorized Finance Control, unauthorized Payment, database integrity violation, or unexplained financial reconciliation drift.

## Production support minimum

- Named service owner, Finance owner, security contact, DBA/SRE responder and escalation path.
- Runbooks for identity, database, storage, malware, worker, AI, Telegram (if enabled), payment recovery and reconciliation.
- Safe correlation-based diagnostics without documents, prompts, bank details, authorization headers or credentials.
- Tested restore, rollback/forward-fix and emergency credential rotation.

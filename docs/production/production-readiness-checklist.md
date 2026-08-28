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
| Corporate identity / SSO | BLOCKED | Approved IdP, issuer/audience validation, secure session/logout, lifecycle and spoofing tests. |
| Identity-to-authority administration | BLOCKED | Approved mapping and joiner/mover/leaver process; ADMIN remains non-operational. |
| Authorization regression | NOT STARTED | Production auth plus IDOR, SoD, amount/scope, revocation and session tests. |
| Private object storage | BLOCKED | Encrypted private quarantine/clean storage, authorized reads, version/hash reconciliation. |
| Malware protection | BLOCKED | Real scanner, durable verdict, retry/error handling and promotion-only-after-CLEAN proof. |
| Secret management | BLOCKED | Selected store, runtime injection, environment isolation, independent rotation and audit. |
| Production PostgreSQL | BLOCKED | Selected service/version, TLS, HA, pools/timeouts, role provisioning and monitoring. |
| Migration/bootstrap | BLOCKED | Production-safe migration path excludes fixtures; checksum/manifest and clean rehearsal pass. |
| Redis decision | DECISION REQUIRED | Verified need and design, or explicit no-Redis decision. |
| Worker reliability | BLOCKED | Supervision, leases, idempotent retry, poison/dead-letter, backlog, graceful shutdown. |
| AI provider governance | DECISION REQUIRED | Provider/model/privacy/cost/timeout controls approved, or production AI OFF. |
| Telegram | DECISION REQUIRED | Explicit disabled-for-v1 decision or complete production channel controls. |
| Structured logging/redaction | BLOCKED | Central sink, access/retention, safe fields and automated redaction verification. |
| Metrics/alerting | BLOCKED | Health, DB, outbox, storage, AI, Finance Control and Payment alerts with owners. |
| Correlation and audit trace | PARTIAL | Correlation/audit exist; operational access, retention, export and monitoring remain. |
| PostgreSQL backup/PITR | BLOCKED | Encrypted schedule, retention, off-host/managed protection and ownership. |
| Object backup/versioning | BLOCKED | Version/replication/backup policy consistent with retention and legal hold. |
| Restore rehearsal | BLOCKED | Isolated restore starts AIMS and reconciles document hashes and financial invariants. |
| RPO/RTO | DECISION REQUIRED | Business-approved targets demonstrated by rehearsal. |
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
| Incident response | BLOCKED | Severity, on-call, communications and financial stop-the-line exercises approved. |
| Go-live approval | BLOCKED | P19 review accepted by Finance, Security, Architecture, SRE/DBA and business owners. |
| Opening reconciliation | BLOCKED | Post-deploy budgets, commitments, payments, ledger, documents and authorities reconcile. |

## Financial stop-the-line checklist

Suspend affected mutation paths and escalate immediately for any payment/ledger mismatch, `PAID` without exactly one payment, ledger without payment, commitment mismatch, duplicate payment, unauthorized Finance Control, unauthorized Payment, database integrity violation, or unexplained financial reconciliation drift.

## Production support minimum

- Named service owner, Finance owner, security contact, DBA/SRE responder and escalation path.
- Runbooks for identity, database, storage, malware, worker, AI, Telegram (if enabled), payment recovery and reconciliation.
- Safe correlation-based diagnostics without documents, prompts, bank details, authorization headers or credentials.
- Tested restore, rollback/forward-fix and emergency credential rotation.

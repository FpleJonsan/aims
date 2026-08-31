# AIMS Production Decision Register

Status values are `DECISION REQUIRED`, `POLICY DECISION REQUIRED`, or `CONFIRMED`. Owners are roles, not invented people.

| ID | Decision | Status | Options / constraints | Required input | Owner | Blocking phase |
| --- | --- | --- | --- | --- | --- | --- |
| D-001 | Corporate identity provider and integration pattern | DECISION REQUIRED | Vendor-neutral P1 contract complete; direct OIDC/BFF is recommended where supported, or a fully controlled identity-aware proxy | Existing corporate platform, test tenant, issuer/audience/claims, registration, edge topology, session/MFA/logout policy and owners | Company IT / Security | P1 implementation / P2 |
| D-002 | Hosting platform and network ownership | DECISION REQUIRED | Suitable managed platform or company standard; must support private dependencies and controlled edge | Cloud/on-prem standard, regions, network topology, support model | Platform / IT | P3, P5, P6, P13 |
| D-003 | Production object storage | DECISION REQUIRED | Private S3-compatible or platform-native equivalent; blocked public access, encryption, lifecycle, versioning | Hosting decision, residency, retention, access and cost constraints | Platform / Security / Finance data owner | P3 |
| D-004 | Malware scanning service | DECISION REQUIRED | Managed scanner, approved engine/service, or isolated scanning worker | Allowed file types, SLA, privacy/residency, operations ownership | Security / Platform | P4 |
| D-005 | Production secret manager | DECISION REQUIRED | Platform-native store or approved Vault; runtime injection and rotation required | Hosting standard, IAM model, audit and rotation policy | Security / Platform | P5 |
| D-006 | Monitoring, logging, alerting, and error platform | DECISION REQUIRED | Company-standard telemetry stack; avoid sensitive payload capture | Existing tools, retention, on-call routing, data classification | SRE / Security | P10 |
| D-007 | PostgreSQL hosting and HA model | DECISION REQUIRED | Prefer managed service where it meets role/function/trigger requirements | Region, HA, version, extension policy, connection limits, backup ownership | DBA / Platform | P6 |
| D-008 | Redis necessity and worker architecture | CONFIRMED | Redis is not required for Production v1; the PostgreSQL-backed independent worker implements durable outbox delivery and document scanning foundations. Financial truth and authoritative transitions remain synchronous PostgreSQL operations. | P15 capacity may reopen Redis only with measured need; Production providers/supervision remain later gates | Architecture / SRE | P10-P15 deployment evidence |
| D-009 | Production AI provider and permitted models | DECISION REQUIRED | Approved provider/model allowlist or AI OFF | Procurement, privacy/security review, residency, SLA, cost | AI Governance / Security / Finance data owner | P8 |
| D-010 | Finance data allowed to leave AIMS for AI | POLICY DECISION REQUIRED | Minimized facts only; documents/invoice text/payee/personal data require explicit approval; bank data prohibited | Legal/privacy classification, DPA, retention and residency | Legal / Privacy / Finance data owner | P8 |
| D-011 | Telegram in Production v1 | DECISION REQUIRED | `DISABLED FOR V1` preferred unless business confirms requirement; otherwise productionize fully | Business need, approved channel, support and compliance position | Finance product owner / Security | P9 |
| D-012 | RPO and RTO | DECISION REQUIRED | Must be business-owned and tested, not inferred from provider snapshots | Maximum tolerable data loss and downtime by workflow | Finance owner / Business continuity / SRE | P12 |
| D-013 | Data retention and legal hold | POLICY DECISION REQUIRED | Separate periods for requests, documents, audit, AI usage/output, approvals, payments, ledger, notifications | Legal, tax, audit, privacy and deletion requirements | Legal / Finance data owner | P3, P12, P20 |
| D-014 | Expected production capacity | DECISION REQUIRED | Users, departments, requests/day/year, documents/request, file sizes, concurrency, approval/payment volume, reporting years | Forecast and peak workload | Finance product owner / Operations | P7, P10, P15 |
| D-015 | Production bootstrap and historical migration | DECISION REQUIRED | Empty start, approved master-data import, historical payment import, or phased cutover | Source systems, data quality, reconciliation and cutover ownership | Finance systems owner / Data owner | P6, P16, P17 |
| D-016 | Environment promotion and approval authority | DECISION REQUIRED | Required approvers for staging RC and production deployment | Change-management and release policy | Engineering / Finance / Security | P17-P20 |
| D-017 | Production support and on-call model | DECISION REQUIRED | Business hours or 24x7; escalation for financial stop-the-line conditions | SLA, responder roles, communication channels | Operations / Finance / SRE | P10, P19 |
| D-018 | Single-currency Production v1 scope | DECISION REQUIRED | Preserve current no-inferred-FX behavior; approve currencies or keep MYR-only | Finance policy and authoritative FX requirements | Finance systems owner | P6, P16 |

## Confirmed principles

| ID | Decision | Status | Evidence |
| --- | --- | --- | --- |
| C-001 | Preserve the modular monolith | CONFIRMED | No production requirement currently justifies a microservice rewrite. |
| C-002 | PostgreSQL remains financial authority | CONFIRMED | Existing transactional, trigger, role, idempotency, and concurrency controls are verified. |
| C-003 | AIMS records but does not execute payment | CONFIRMED | Frozen Production v1 payment boundary. |
| C-004 | AI remains optional and advisory | CONFIRMED | AI OFF UAT and frozen authority rules. |
| C-005 | Competition release remains independently recoverable | CONFIRMED | Tags `v1.0.0-competition` and `v1.0.0-competition.1` remain unchanged. |
| C-006 | Credential-bearing Git remote URLs are prohibited | CONFIRMED | Prior local PAT incident was remediated; use credential helper, CLI, SSH, or approved workload identity. |
| C-007 | External identity proves who the user is; AIMS PostgreSQL decides Finance authority | CONFIRMED | [P1 identity architecture](production-identity-architecture.md) and frozen authorization model. External groups, roles, titles and departments grant no operational authority. |
| C-008 | Production identity uses an issuer-bound stable subject mapping | CONFIRMED FOUNDATION | P1-L implements provider-independent `(issuer, subject)` mapping. Exact corporate issuer, claims, and provisioning remain Company IT decisions. |
| C-009 | Local authentication uses a server-side opaque session | CONFIRMED LOCAL | P1-L stores only SHA-256 token/CSRF hashes, uses an HttpOnly cookie plus Origin/double-submit CSRF checks, and re-reads current AIMS authority. This does not approve a Production session lifetime or IdP. |
| C-009 | Production local/competition authentication fallback is prohibited | CONFIRMED | Production must reject the catalogue, synthetic selector/header adapter, competition aliases and guarded data commands. |
| C-010 | P8 AI code governance boundary is hardened; Production AI remains OFF | CONFIRMED FOUNDATION | Provider reliability, exact Validation manifests, Risk evidence catalogs, bounds, traceability and Finance Intelligence minimization are implemented. Provider/privacy/operations selection remains open and no provider is selected. |

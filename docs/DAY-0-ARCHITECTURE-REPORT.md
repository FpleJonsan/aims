# 1. Executive Assessment

AIMS should proceed as a **modular monolith** with three deployable processes—Nuxt web, NestJS API, and a NestJS/BullMQ worker—sharing one PostgreSQL database, Redis-backed asynchronous jobs, and S3-compatible document storage. This gives the finance workflow a single transactional authority while keeping UI, request handling, and unreliable/long-running integrations operationally isolated.

The proposed stack is coherent. The repository itself is greenfield: it contains only `.git`, has no commits, and has no application, configuration, dependencies, tests, data model, or legacy constraints. That reduces migration risk but means none of the required controls exists yet.

The principal architecture decisions are:

- PostgreSQL is the sole source of financial and workflow truth.
- A server-side state-transition service owns all state changes; AI, Telegram, and the frontend may request actions but cannot mutate state directly.
- Financial balances derive from an append-only budget ledger/commitment model under database transactions and locks, not from LLM output or cached dashboard values.
- Policy versions, approval requirements, and immutable approval snapshots make historical decisions reproducible.
- Every workflow-changing command carries an idempotency key and produces an audit event in the same transaction.
- Documents are immutable versions with content hashes. Material changes after approval invalidate prior analysis/approval and require a controlled return through validation.
- AI is an optional bounded adapter. The same validation and assessment records support AI and manual authorship; provider failure routes work to humans without inventing new payment-request states.

The system is architecturally ready to enter Day 1 after the open product decisions in section 19 receive provisional defaults or confirmation. The competition’s original 10-day sequence is too compressed for production correctness if “day” means one normal engineer-day; the revised plan protects the payment path first and defers nonessential AI breadth.

# 2. Current Environment Audit

Audit date: 2026-08-22 (Asia/Kuala_Lumpur). No secret values were read or printed.

| Area | Observed state | Assessment / action |
|---|---|---|
| Repository | `/Users/woonchunkit/Documents/ChatGPT/AIMS`; only `.git` exists | Greenfield; no existing code to migrate |
| Git | Branch `main`; no commits; clean working tree before this report | Create initial architecture/foundation commit only after Day 1 approval |
| Repository instructions | No `AGENTS.md` found | No repository-specific conventions exist |
| Node.js | `v24.5.0` at `/opt/homebrew/bin/node` | Compatible major, but old patch; pin a current Node 24 LTS patch in toolchain/container |
| pnpm | `9.11.0` | Usable, but pin an agreed current major through Corepack; do not rely on a global install |
| npm | `11.5.1` | Available; not selected package manager |
| Yarn | `1.22.22` | Available; do not mix lockfiles/package managers |
| Corepack | `0.34.0` | Available for package-manager pinning |
| Docker CLI | `29.4.3` | Installed |
| Docker daemon | Socket access denied during audit | Runtime availability unverified; Day 1 must start and smoke-test Docker Desktop/daemon |
| Docker Compose | `v5.1.4` | Installed and suitable |
| PostgreSQL | `psql` and local server not found | Use Compose locally; verify image/version and readiness on Day 1 |
| Redis | `redis-server` and `redis-cli` not found | Use Compose locally; verify persistence policy and readiness on Day 1 |
| Frontend/backend | None | No Nuxt/Nest code exists |
| Database/config | None | No schema, connection string, migrations, or env templates exist |
| AI SDK/integration | None | Provider abstraction must be introduced deliberately |
| Telegram | None | Deferred until core approval API exists |
| Authentication | None | Security-critical Day 1 foundation |
| Test frameworks | None | Add from the start; no baseline tests exist |
| Environment files | None | Add `.env.example`, validation, and secret-safe ignore rules on Day 1 |

The audit cannot establish available CPU/RAM, deployment target, OIDC issuer, network policy, object-store credentials, backup facilities, or whether Docker Desktop is merely stopped versus inaccessible to this sandbox. These are not reasons to scaffold now; they are Day 1/deployment discovery inputs.

# 3. Technology Stack Decision

| Technology | Decision | Reasoning and impact |
|---|---|---|
| TypeScript | **KEEP** | One language across web/API/worker improves contract reuse. Enable strict mode and forbid unsafe DTO binding. |
| Node.js | **KEEP**, pin Node 24 LTS | Nuxt 4 requires Node 22+ and recommends an even-numbered active LTS; NestJS 11 requires Node 20+; current Prisma supports Node 24. The installed `24.5.0` should be upgraded to a current patched Node 24 LTS and pinned. [Nuxt requirements](https://nuxt.com/docs/4.x/getting-started/installation/), [NestJS migration guide](https://docs.nestjs.com/migration-guide), [Node release status](https://nodejs.org/en/about/previous-releases) |
| pnpm workspaces | **KEEP** | Efficient monorepo management. Pin via `packageManager`; one lockfile. Cost is minor workspace configuration. |
| Nuxt 4 / Vue 3 | **KEEP** | Appropriate typed SSR-capable internal UI. Prefer client-side authenticated app rendering where SSR adds no value; keep secrets/API authority server-side. |
| Pinia | **KEEP** | Suitable for UI/session state, but never the authority for permissions, workflow state, or financial values. |
| Nuxt UI | **KEEP** | Accelerates accessible internal UI. Validate licensing, theme, and component behavior during Day 1 spike. |
| TanStack Table | **KEEP** | Good headless support for server-side sorting/filtering/pagination; API remains authoritative. |
| ECharts | **KEEP** | Mature dashboard visualization. Charts consume deterministic API aggregates only. |
| NestJS 11 REST API | **KEEP** | Modules, guards, validation, OpenAPI, and interceptors fit a modular monolith. Avoid exposing ORM records directly. |
| OpenAPI | **ADD** | Generate and test the API contract; optionally generate a typed frontend client to prevent drift. |
| PostgreSQL | **KEEP** | Transactions, constraints, row locks, isolation, and robust querying fit financial integrity. Select a currently supported production major (provisional: PostgreSQL 17) and pin its image digest/version. |
| Prisma | **KEEP, conditional on Day 1 spike** | Type safety and migrations are valuable. Prisma 7 currently requires ESM and a database driver adapter; validate interactive transactions, raw SQL locking, isolation levels, partial indexes/migration SQL, and NestJS build compatibility before lock-in. If it fails, change to Drizzle or Kysely plus a migration tool; benefit would be more explicit SQL control, cost would be less generated model ergonomics. [Prisma overview](https://docs.prisma.io/docs/orm), [system requirements](https://docs.prisma.io/docs/orm/reference/system-requirements) |
| Redis + BullMQ | **KEEP** | Appropriate for AI, document scanning/extraction, notification, and webhook work. Queue state is never business truth; jobs reference durable database work items. |
| S3-compatible storage / MinIO | **KEEP / ADD for local** | Keep file bytes outside PostgreSQL, while metadata/hash/version live in PostgreSQL. Add MinIO in local Compose only; production can use managed S3-compatible storage. |
| OpenAI-compatible provider + Zod | **KEEP** | Vendor abstraction and runtime-validated structured outputs enforce replaceability. Keep SDK inside infrastructure adapter. |
| Telegram Bot API | **DEFER to approval slice** | Correct first channel, but only after channel-independent approval commands and identity binding exist. |
| OIDC | **KEEP target; ADD local auth only if necessary** | OIDC is the production boundary. A temporary local adapter may unblock development, but must implement the same principal/role/department contract and be disabled outside local/test. |
| Docker / Compose | **KEEP** | Reproducible local PostgreSQL, Redis, MinIO, mail/webhook fakes, and services. Do not containerize every developer tool unnecessarily. |
| OpenTelemetry | **ADD readiness; DEFER full backend** | Establish correlation IDs, structured logs, trace interfaces, and metrics names now; connect a collector/backend after core flows work. |
| Kubernetes, Kafka, Temporal, GraphQL, vector DB, Python service | **DEFER** | No demonstrated need; each adds operational and consistency cost without solving Day 1 risks. |

# 4. Proposed AIMS Architecture

```text
 Users / Finance / Approvers                     Telegram (initial channel)
             |                                              |
             v                                              v
 +-------------------------+                    +-------------------------+
 | Nuxt 4 Web Application  |                    | Telegram Webhook Adapter|
 | UI only; no authority   |                    | verify, map, translate  |
 +------------+------------+                    +------------+------------+
              | HTTPS / REST                                 |
              +--------------------+-------------------------+
                                   v
 +-----------------------------------------------------------------------+
 |                         NestJS API                                    |
 | AuthN/AuthZ | Commands | Queries | Validation | OpenAPI | Idempotency |
 |-----------------------------------------------------------------------|
 | Payment Requests | Documents | Budgets | Policies | Approvals         |
 | Finance Context  | Finance Control | Payments | Audit | Notifications |
 | AI facade        | Dashboard | Identity | Integrations                |
 +----------------------+----------------------+-------------------------+
                        | transaction          | durable work/outbox
                        v                      v
              +------------------+       +-------------+
              | PostgreSQL       |       | Redis/BullMQ|
              | source of truth  |       | delivery only|
              +--------+---------+       +------+------+ 
                       |                        |
                       | metadata               v
                       |                +-------------------+
                       |                | NestJS Worker(s)  |
                       |                | AI/docs/notifies  |
                       |                +----+---------+----+
                       v                     |         |
              +------------------+           v         v
              | S3 / MinIO       |      LLM provider  Telegram/API
              | immutable objects|      (optional)    integrations
              +------------------+

 Cross-cutting: RBAC/ABAC, policy versions, audit + outbox, correlation IDs,
 schema validation, malware scanning, metrics/tracing, secrets management.
```

Use a monorepo such as `apps/web`, `apps/api`, `apps/worker`, and small packages for contracts/config/testing. Domain modules reside in the API/worker application boundary; avoid a generic “shared” package that leaks persistence models everywhere. Commands mutate through domain services; queries use explicit read models. The API and worker may share domain/application libraries, but only the API accepts user commands.

The transactional outbox is the bridge from committed database events to BullMQ. A dispatcher claims outbox rows, publishes jobs with stable IDs, and marks delivery; consumers are idempotent. Redis loss can delay work but cannot erase a payment, approval, commitment, or audit fact.

# 5. Domain Boundaries

| Domain | Owns | Must not own |
|---|---|---|
| Identity & Access | users, service principals, roles, permissions, department scope, OIDC/local identity mapping, Telegram identity binding | Approval route or policy thresholds |
| Departments | department master data, active status, hierarchy if approved | User authorization inferred solely from department membership |
| Payment Requests | ticket allocation, request data, state machine, immutable material-change snapshots | Document bytes, policy configuration, payment execution |
| Documents | upload intents, metadata, versions, hashes, scan status, evidence references | Silent replacement or approval decisions |
| Budgets | fiscal periods, budget allocations/revisions, commitment/actual ledger | AI-derived balances |
| Finance Context | deterministic point-in-time projections and budget context | Persisted fabricated KPIs or policy decisions |
| Policies | versioned rules, thresholds, evidence/route/authority requirements, evaluation result | Human identity hardcoded in code; AI authority |
| Approvals | approval cases/steps/actions, authority validation, channel-independent commands | Telegram-specific callback handling |
| Finance Control | final control checklist/result/hold reasons | Payment recording or bypass of failed checks |
| Payments | external-payment record, references/slips/status, duplicate protection, actual conversion | Bank transfer execution in V1 |
| AI | feature flags, provider/agent contracts, runs, validated outputs, evidence, usage | State transitions, balances, approval authority, payment mutation |
| Notifications | durable notification intent, templates, delivery attempts | Business state as inferred from message delivery |
| Telegram | webhook verification, account binding, presentation/callback translation | Approval domain rules |
| Dashboard & Reporting | deterministic query models, filters, exports | Independent financial truth |
| Audit | append-only business/security event record and integrity controls | Arbitrary sensitive payload copies |
| Integrations | vendor adapters, retry/circuit-breaker policies, health | Domain decisions |

Dependencies point inward: channel/infrastructure adapters call application commands; application services coordinate domain modules; domain rules do not import Telegram, an LLM SDK, Redis, or HTTP concepts.

# 6. Payment Request State Machine

Roles below are logical authorities evaluated server-side: Requester, Validator, Finance Analyst, Approver, Finance Controller, Payment Recorder, and System Policy. “System” is deterministic application logic, never AI.

| From | Allowed next state | Actor | Required conditions / transaction | Audit event and idempotency |
|---|---|---|---|---|
| DRAFT | SUBMITTED | Requester with department scope | Required fields and upload references present; allocate ticket if not already allocated; freeze submission revision in one transaction | `REQUEST_SUBMITTED`; client command key; ticket unique |
| DRAFT | CANCELLED | Requester | Owner and not submitted; row version check | `REQUEST_CANCELLED`; repeat returns same result |
| SUBMITTED | VALIDATING | Validator or deterministic system dispatcher | Request revision fixed; validation work item created transactionally | `VALIDATION_STARTED`; unique work item per revision |
| SUBMITTED | CANCELLED | Requester/authorized Finance | No approval/payment; cancellation policy permits | `REQUEST_CANCELLED` |
| VALIDATING | NEEDS_CLARIFICATION | Validator | Persist validation findings and requested fields | `CLARIFICATION_REQUESTED`; finding-set key |
| VALIDATING | ANALYZED | Validator | Validation completed; either AI output schema-valid and reviewed as required, or manual validation recorded; deterministic finance context captured/referenced | `VALIDATION_COMPLETED`; one completion per revision |
| VALIDATING | CANCELLED | Authorized Requester/Finance | No payment/approval; cancel in same transaction as work cancellation marker | `REQUEST_CANCELLED` |
| NEEDS_CLARIFICATION | VALIDATING | Requester submits clarification | New request/document revision, required response present; invalidate stale derived results | `CLARIFICATION_RESPONDED`; revision unique |
| NEEDS_CLARIFICATION | CANCELLED | Requester/authorized Finance | Cancellation policy permits | `REQUEST_CANCELLED` |
| ANALYZED | PENDING_APPROVAL | Finance Analyst or System Policy | Human/manual or reviewed AI assessment exists; versioned policy evaluated; approval plan and required commitment created atomically | `APPROVAL_REQUESTED`; unique plan per request revision/policy version |
| ANALYZED | NEEDS_CLARIFICATION | Finance Analyst | Analysis exposes missing/contradictory evidence | `CLARIFICATION_REQUESTED` |
| ANALYZED | CANCELLED | Requester/authorized Finance | Release any reservation if present | `REQUEST_CANCELLED` |
| PENDING_APPROVAL | PENDING_APPROVAL | Authorized Approver | Valid next step action/partial route; lock approval case; persist action and advance step atomically | `APPROVAL_STEP_APPROVED`; unique `(step, approver, action-key)` |
| PENDING_APPROVAL | APPROVED | Authorized Approver or deterministic auto-approval rule | All required steps satisfied; authority/amount/current revision checked; lock case/request | `REQUEST_APPROVED`; duplicate callback returns original result |
| PENDING_APPROVAL | REJECTED | Authorized Approver | Valid active step; reason required; lock case/request; release commitment atomically or through invariant-preserving ledger entry | `REQUEST_REJECTED`; unique action key |
| PENDING_APPROVAL | NEEDS_CLARIFICATION | Authorized Approver | Active step; reason/questions required; close/invalidate current approval plan; retain or release commitment per explicit policy | `CLARIFICATION_REQUESTED` |
| PENDING_APPROVAL | CANCELLED | Requester plus policy-authorized Finance | Cancellation allowed; invalidate approval tokens; release commitment | `REQUEST_CANCELLED` |
| APPROVED | FINANCE_CHECK | Finance Controller or deterministic dispatcher | Approval snapshot complete and current; create control case | `FINANCE_CHECK_STARTED`; unique case per approved revision |
| FINANCE_CHECK | READY_FOR_PAYMENT | Finance Controller | Every deterministic gate passes against locked request/document/approval/policy/commitment snapshots | `FINANCE_CONTROL_PASSED`; one active pass per revision |
| FINANCE_CHECK | FINANCE_HOLD | Finance Controller | One or more gate failures recorded with safe reasons | `FINANCE_CONTROL_FAILED` |
| FINANCE_HOLD | FINANCE_CHECK | Finance Controller | Hold causes resolved; evidence/revision rules satisfied; stale approvals re-run where material | `FINANCE_CHECK_RESUMED` |
| FINANCE_HOLD | NEEDS_CLARIFICATION | Finance Controller | Requester input required; invalidate approval if material fields/documents may change | `CLARIFICATION_REQUESTED` |
| FINANCE_HOLD | CANCELLED | Authorized Finance | Reason required; release commitment | `REQUEST_CANCELLED` |
| READY_FOR_PAYMENT | PAID | Payment Recorder | Re-run readiness invariants; external payment data complete; duplicate checks pass; lock request/commitment; insert payment and convert commitment to actual atomically | `PAYMENT_RECORDED`; unique request payment and bank-reference constraints plus command key |
| READY_FOR_PAYMENT | FINANCE_HOLD | Finance Controller | New deterministic blocker before payment; reason required | `PAYMENT_READINESS_REVOKED` |
| READY_FOR_PAYMENT | CANCELLED | Privileged Finance with segregation rule | No payment exists; reason; release commitment | `REQUEST_CANCELLED` |

Terminal states are `PAID`, `REJECTED`, and `CANCELLED`; no ordinary outbound transitions exist. Corrections are new append-only payment status/correction events under a separately authorized process, not reopening the request or deleting payment history.

Invalid examples include DRAFT→APPROVED, SUBMITTED→PAID, ANALYZED→READY_FOR_PAYMENT, PENDING_APPROVAL→PAID, APPROVED→PAID, FINANCE_HOLD→PAID, PAID→DRAFT/CANCELLED, and any transition initiated by AI or a notification adapter. A no-op self-transition is not generally valid; the PENDING_APPROVAL row above represents a step action while the aggregate state remains unchanged.

Material changes to amount, currency, payee, payment details, category, department, purpose, or supporting-document version never mutate an approved snapshot in place. They create a new revision, invalidate downstream artifacts, and route to VALIDATING (normally through NEEDS_CLARIFICATION). The exact user-facing transition should be codified before implementation.

# 7. AI-Assisted / Manual / Fallback Architecture

One application workflow uses common work items and result contracts:

1. The state machine creates a `ValidationTask` or `AssessmentTask` for a request revision.
2. An execution-policy resolver reads the global switch, feature switch, provider health/circuit state, and user choice.
3. In AI-assisted mode, a worker produces a candidate structured result. It is schema-validated, evidence-checked, stored as `AI`, and presented for required human review. It cannot advance the state itself.
4. In manual mode, an authorized user completes the same business result shape with source `MANUAL`, required remarks/evidence, and validation rules.
5. On timeout, rate limit, outage, invalid structure, or exhausted retry budget, the task becomes manually actionable with an operational AI status. The payment-request state remains the correct business state (`VALIDATING` or `ANALYZED`); there is no `AI_FAILED` request state.
6. A deterministic application command checks the accepted result and performs an allowed transition transactionally.

Store AI and human assessments separately. `FinalWorkingAssessment` references the selected source/result plus override actor, time, and reason. It does not overwrite either input. Rule-based flags are also separate (`RULE_BASED`) and cannot be suppressed silently.

Feature configuration is versioned and auditable: global master plus per-feature flags, optionally scoped only after an explicit need. A configuration change affects new invocations, not historical outputs. Manual mode must be covered by the same acceptance and end-to-end tests as AI mode.

# 8. Multi-Agent Architecture Boundary

“Agent” means a bounded structured analysis component, not an autonomous business actor.

| Agent | Eligible stage | Input | Output |
|---|---|---|---|
| Document Agent | Validation | request revision, sanitized extracted text, document metadata/hash, requested fields | extracted fields, confidence, missing fields, discrepancy findings, evidence refs |
| Financial Risk Agent | Analysis | deterministic finance-context snapshot, validated request facts, permitted historical aggregates | risk candidate, priority candidate, flags, narrative, evidence refs, uncertainty |
| Spending Pattern Agent | Analysis/Finance Watch | bounded deterministic aggregates and comparison windows | detected patterns, method, affected dimensions, evidence refs, confidence |
| Compliance Agent | Validation/Analysis | request facts, document facts, machine-readable policy context (not authority choice) | possible compliance issues, cited rules/evidence, uncertainty |
| Finance Insight Agent | Offline/query insight | authorized, minimized aggregates | observation/recommendation with query/evidence refs and limitations |
| Aggregator | AI application layer | schema-valid outputs only | normalized candidate assessment with contradictions preserved |

Every invocation receives a contract-versioned payload containing request/revision IDs, snapshot timestamp, currency semantics, evidence handles, and data classification. It returns a versioned Zod-validated discriminated union. Evidence references point to a document version plus page/region/text span hash, or to a deterministic query ID, parameters hash, as-of timestamp, and returned fact identifiers. Unsupported claims are rejected or explicitly marked unsubstantiated.

The orchestrator is a normal application service/state machine: bounded parallel calls, no free-form agent-to-agent conversation, no recursive delegation, and no business-state access token. Aggregation preserves disagreements and provenance; it does not average away severe flags. A deterministic rule can require human review when agents conflict, confidence is low, or evidence is absent.

Failure controls: per-call timeout, total stage deadline, at most one retry for transient errors with jitter, circuit breaker per provider/model, cancellation on stale request revision, and manual fallback. Cost controls: allowlisted models, input-size/token caps, pre-extraction, caching by safe content/config/prompt hash where valid, per-feature/daily budgets, concurrency limits, usage alerts, and fail-closed-to-manual—not fail-open to approval.

# 9. Financial Consistency Model

Use an append-only monetary ledger with integer minor units (for example sen) plus ISO currency; never binary floating point. A budget belongs to fiscal year, department, category, and currency. Cross-currency consolidation requires an explicit exchange-rate policy and rate snapshot; until confirmed, balances are per currency.

Definitions for a single budget dimension and currency:

```text
Revised Budget = Original Allocation + posted Budget Revisions
Actual Spending = sum(posted ACTUAL entries) - sum(posted ACTUAL_REVERSAL entries)
Active Commitments = sum(active commitment reserved amounts)
Available Budget = Revised Budget - Actual Spending - Active Commitments
Projected Available = Available Budget - approved/planned projections explicitly defined by policy
```

Lifecycle:

- **Create commitment:** atomically when a request enters `PENDING_APPROVAL` (provisional recommendation). Lock the budget row/advisory key, recompute available balance from authoritative entries, reject/hold according to policy if insufficient, insert one commitment tied to request revision, and create ledger/audit/outbox records.
- **Update commitment:** never edit the amount silently. A material amount/currency/budget-dimension change invalidates approval, releases/supersedes the old commitment, and creates a new version after revalidation/policy evaluation.
- **Release commitment:** on rejection, cancellation, approved expiry, or explicit route invalidation, using a unique release event. Clarification behavior must be configured: retain temporarily with expiry or release immediately.
- **Convert to actual:** in the same serializable/locked transaction that inserts the unique payment record and moves the request to `PAID`. Consume/release the commitment and post actual spending exactly once. Variance between approved/committed and paid amount is forbidden unless an authorized reapproval path exists.

Do not store `available_budget` as independently editable truth. It is derived in a transaction or maintained as a projection with a ledger reconciliation invariant. Dashboard queries use posted entries and active commitments with an as-of timestamp.

Primary hazards are oversubscription from simultaneous reservations, double conversion/payment, stale budget revisions, commitment leakage after cancellation, inconsistent currency/rounding, and partial writes. Mitigate with database transactions, row/advisory locks by budget key, optimistic aggregate versions, unique lifecycle-event constraints, and scheduled reconciliation that alerts but never “fixes” money silently.

# 10. Initial Data Model

All primary keys should be non-guessable UUID/UUIDv7-style identifiers; ticket numbers are separate human identifiers allocated by a database sequence/atomic counter and protected by a unique constraint.

| Classification | Major entities / key relationships |
|---|---|
| Identity/configuration | `users`, `identities`, `roles`, `permissions`, `user_role_assignments`, `department_access_grants`, `telegram_identity_bindings`, `departments`, `categories`, `fiscal_periods`, `currencies` |
| Request transaction | `payment_requests`, `payment_request_revisions`, `request_state_transitions`, `clarification_threads`, `clarification_messages` |
| Documents | `documents`, `document_versions` (object key, SHA-256, size, media type, scan status), `request_document_links`, `document_evidence_refs`, `duplicate_document_matches` |
| Validation/assessment | `validation_tasks`, `validation_results`, `validation_findings`, `financial_assessments`, `assessment_flags`, `assessment_evidence`, `assessment_overrides` |
| Budgets | `budgets`, `budget_allocations`, `budget_revisions`, `budget_commitments`, `commitment_events`, `financial_ledger_entries`, `finance_context_snapshots` |
| Policy/configuration | `policy_sets`, `policy_versions`, `policy_rules`, `policy_evaluations`, `policy_evaluation_facts`, `approval_route_templates`, `authority_grants` |
| Approval transaction/snapshot | `approval_cases`, `approval_steps`, `approval_assignments`, `approval_actions`, `approval_snapshots` (request/document/amount/payee/policy hashes) |
| Finance/payment | `finance_control_cases`, `finance_control_checks`, `finance_hold_reasons`, `payments`, `payment_status_events`, `payment_artifacts` |
| AI operations | `ai_feature_config_versions`, `ai_runs`, `ai_run_attempts`, `ai_outputs`, `ai_evidence_refs`, `prompt_versions`, optional `ai_cost_rates` |
| Messaging/integration | `notification_intents`, `notification_deliveries`, `webhook_receipts`, `integration_accounts`, `outbox_events`, `inbox_messages` |
| Audit | `audit_events` append-only, optionally hash-chained/partitioned; security access logs remain operational logs with appropriate retention |
| Reporting | SQL views/materialized read models as justified; export jobs and artifacts with requester/scope/expiry |
| Idempotency | `idempotency_records` keyed by actor/client scope + operation + key, request hash, status, and stored result reference |

Important constraints include unique `ticket_number`; unique request revision number; unique active approval case per request revision; unique approval action key; unique active commitment per request revision/budget; unique payment per request (V1); suitably scoped unique bank reference where provider semantics permit; unique webhook provider/update ID; unique document hash match records; foreign keys everywhere; and check constraints for nonnegative amounts, valid currencies, and permitted statuses.

Immutable snapshots capture exactly what was approved: request revision, amount/currency, payee/payment-details hashes, document-version/hash set, finance-context as-of reference, policy version/evaluation, route, and authority facts. Snapshot data is append-only; supersession creates a new row.

# 11. Security & Threat Model

| Rank | Threat | Mitigation |
|---|---|---|
| **CRITICAL** | Duplicate payment / simultaneous record attempts | Unique payment-per-request constraint, idempotency record, request/commitment lock, readiness recheck, payment + actual conversion in one transaction |
| **CRITICAL** | Approval spoofing, replay, or authority bypass | Server-side identity binding, active-step/amount/authority checks, one-time action nonce, expiry, request-revision binding, row lock, unique action key; never trust Telegram/UI claims |
| **CRITICAL** | Amount, payee, payment details, or documents changed after approval | Immutable revision and document versions, approval snapshot hashes, finance-gate comparison, automatic approval invalidation and controlled revalidation |
| **CRITICAL** | Broken authorization / cross-department financial access | Deny-by-default RBAC plus department ABAC in service/query layer, scoped repository methods, object-level tests, optional PostgreSQL RLS as defense-in-depth after operational validation |
| **HIGH** | IDOR through predictable tickets/IDs/download URLs | Object authorization on every lookup, opaque internal IDs, short-lived signed object URLs after authorization, do not treat ticket secrecy as control |
| **HIGH** | Telegram callback forgery/webhook replay | Webhook secret/header validation, HTTPS, provider update-ID inbox uniqueness, callback payload signed or opaque server token, expiry, account binding, optional IP controls only as defense-in-depth |
| **HIGH** | Budget race/oversubscription | Lock budget dimension, recompute within transaction, serializable retry or explicit row/advisory locking, invariant tests |
| **HIGH** | Malicious uploads | Allowlist type/size, magic-byte inspection, quarantine, malware scan, safe parser sandbox/limits, no active rendering, immutable objects, least-privilege bucket credentials |
| **HIGH** | Prompt injection in documents | Treat document text as untrusted data, separate instructions/data, tool-less agents by default, allowlisted retrieval, output schema/evidence validation, human review |
| **HIGH** | Secrets leaked to frontend/logs/AI records/prompts | Secret manager/env injection, redaction, structured allowlist logging, frontend runtime separation, provider data-minimization, scanning in CI |
| **HIGH** | Mass assignment | Explicit DTO allowlists, global validation with unknown-field rejection, command mapping, never bind persistence models directly |
| **HIGH** | Audit bypass/tampering | Audit in same transaction as mutation, database role denies update/delete, append-only retention/export, reconciliation and alerting |
| **HIGH** | LLM hallucination affects workflow | Structured schema, evidence requirement, deterministic recomputation, human acceptance, no mutation credentials, manual fallback |
| **MEDIUM** | Duplicate invoice/request | Hash/extracted invoice key/vendor/amount/date similarity flags; deterministic uniqueness where business keys are reliable; reviewed override with audit |
| **MEDIUM** | Web/API CSRF, XSS, session theft | OIDC authorization-code + PKCE, secure HttpOnly SameSite cookies/BFF or well-protected bearer tokens, CSRF control, CSP/output encoding, short token lifetimes |
| **MEDIUM** | Notification disclosure | Minimize message contents, avoid documents/bank details in Telegram, authorization required to view full record, delivery audit |
| **MEDIUM** | Denial of service/cost exhaustion | Rate limits by identity/IP/feature, file and token caps, queues, quotas, circuit breakers, budget alarms |
| **MEDIUM** | Export leaks excessive data | Server-side scope, column allowlist, step-up authorization for sensitive exports, encrypted expiring artifacts, export audit |
| **MEDIUM** | Dependency/supply-chain compromise | Lockfile, pinned images, provenance/SBOM and vulnerability/license scans, controlled upgrades, minimal images |
| **LOW** | Ticket-number enumeration | Authorization remains primary; rate limit searches and avoid detailed existence errors |
| **LOW** | Operational metadata privacy | Retention limits, access controls, safe correlation IDs, aggregate monitoring |

Security assumptions requiring deployment confirmation: identity provider MFA/claims, data classification and retention, residency, backup encryption, S3 provider, Telegram acceptability for approval, and separation-of-duties rules.

# 12. Concurrency & Idempotency Strategy

Every mutation endpoint accepts a client-generated idempotency key. The server scopes it by authenticated principal and operation, stores a canonical request hash, and returns the original result for a true replay; reuse with a different payload is a conflict. Webhooks use provider event/update IDs; workers use stable business job IDs and an inbox/processed marker.

Use optimistic concurrency (`version` column / ETag) for normal request editing and pessimistic row or PostgreSQL advisory locks for approvals, finance control, commitments, and payment. Lock in a documented order—request, budget key(s), approval/control case, commitment—to reduce deadlocks. Keep transactions short and perform network/file/LLM calls outside them.

Critical invariants are database-enforced, not check-then-insert application code:

- one V1 payment per request;
- one successful approval action per active step/action token;
- one state transition from an expected version;
- one active commitment lifecycle per request revision;
- one webhook receipt per provider event;
- ticket number uniqueness;
- payment and commitment-to-actual conversion commit together.

Use retry-on-serialization/deadlock with bounded attempts. Outbox publication is at-least-once, so every consumer is idempotent. “Exactly once” is achieved for business effects through unique constraints and transactional state, not claimed from Redis delivery semantics.

# 13. Audit Strategy

Create one append-only `audit_events` record in the same PostgreSQL transaction as each important business mutation. Mandatory fields: event ID, occurred/recorded time, actor type/ID, acting identity/channel, action, entity type/ID, request revision, previous/new workflow state where applicable, correlation ID, causation/idempotency IDs, and an allowlisted safe metadata object.

Audit request creation/submission; document upload/version/supersession; validation and manual validation; AI invocation/result acceptance; human override; policy evaluation/version; approval request/action/clarification; finance control; payment/status/correction; commitment lifecycle; identity/authority/config changes; AI switches; exports; and privileged reads where required.

Do not log API keys, access tokens, Telegram callback secrets, full bank details, raw uploaded document content, hidden reasoning, or unrestricted DTO dumps. Mask identifiers based on classification. Separate application logs (diagnostics, mutable retention) from business audit (append-only evidence).

Use a restricted database writer procedure/role or equivalent so the application can insert but not update/delete audit rows. Add retention/archival, access monitoring, periodic count/gap reconciliation, and optional event hash chaining/export to immutable storage after legal/audit requirements are confirmed. Audit failure must fail the associated critical mutation.

# 14. AI Security & Reliability Strategy

- Provider credentials exist only in runtime secret injection and provider adapters; redact authorization headers and SDK errors.
- Data minimization precedes calls: send only authorized pages/fields; exclude payment credentials and unnecessary personal data; confirm provider retention/training and regional terms.
- Uploaded text is hostile. Agents receive fixed system instructions, delimited content, no general tools/network/database write access, and allowlisted context assembled server-side.
- Outputs use versioned JSON Schema/Zod contracts. Parse, validate ranges/enums/evidence, verify evidence belongs to the exact request/document revision, and reject unknown or unsupported claims.
- AI results are candidates with provider/model/prompt version, timestamps, token/cost/latency/status/retry/schema-valid metadata. Never store hidden chain-of-thought.
- Global and feature flags are evaluated at invocation time; emergency kill switch works without redeploying and is audited.
- Timeouts, bounded retries, circuit breakers, concurrency limits, and manual queue fallback prevent provider failure from blocking the business workflow.
- AI runs are reproducible enough for audit through input/evidence hashes and configuration snapshots, while raw sensitive prompts are retained only if policy explicitly permits.
- Maintain a curated adversarial evaluation set: prompt injection, conflicting invoices, multilingual/poor scans, ambiguous currencies, mismatched payees, fabricated citations, and missing evidence.
- Monitor schema failure, unsupported-claim rate, human override rate, false-positive/negative samples, latency, availability, token/cost, and drift by prompt/model version. Roll out model/prompt changes through offline evaluation and controlled canaries.
- Ask AIMS is read-only, authorization-scoped, citation-required, rate-limited, and prohibited from executing workflow commands. Prefer curated query tools returning deterministic facts over raw database access.

# 15. Infrastructure Plan

Day 1 local Compose should contain only PostgreSQL, Redis, and MinIO plus an initialization mechanism; run app processes locally initially for fast development, or provide optional profiles. Add health checks, named volumes, nondefault local credentials sourced from ignored env, and pinned image versions. No production secrets enter Compose files.

Deployment has separate web, API, and worker processes from the same versioned release. PostgreSQL should be managed where possible with point-in-time recovery, encryption, connection pooling, tested restores, and least-privilege roles. Use managed Redis with authentication/TLS and define whether queued jobs may be reconstructed from durable work/outbox records. Use versioned/encrypted S3 storage, private buckets, lifecycle rules, quarantine, and short-lived signed URLs.

CI stages: formatting/lint/typecheck, unit/integration/API tests, migration validation on ephemeral PostgreSQL, security/dependency/secret scans, build immutable images, generate SBOM, and E2E smoke. CD applies reviewed forward migrations with backup/rollback strategy before compatible app rollout. Use expand/contract schema changes; never deploy an incompatible destructive migration in one step.

Observability foundation: JSON logs, request/job correlation and trace IDs, RED metrics for API, queue depth/age, DB pool/transaction errors, AI metrics, webhook/notification delivery, failed audit/outbox/reconciliation alarms. Add OpenTelemetry instrumentation interfaces now and choose a telemetry backend later. Health endpoints distinguish liveness from dependency readiness.

Recovery targets, region/data residency, environments, ingress/WAF, DNS/TLS, secret manager, and notification provider are deployment decisions still to be confirmed.

# 16. Testing Strategy

| Layer | Required coverage |
|---|---|
| Unit/property tests | State transition matrix, policy evaluator, money/currency arithmetic, fiscal periods, budget equations, authority rules, assessment selection, hashing/canonicalization |
| Database integration | Constraints, locks, isolation/retry, commitment lifecycle, outbox/audit atomicity, migrations, concurrent approval/payment/reservation races using real PostgreSQL |
| API contract | Authentication, authorization and IDOR matrix, DTO rejection/mass assignment, idempotency replay/conflict, pagination/filter/export, OpenAPI compatibility |
| Worker/integration | At-least-once duplicate delivery, stale revision cancellation, retry/dead-letter/manual fallback, provider/Telegram fakes, storage failure |
| AI contract/evaluation | Fake provider for deterministic tests; malformed/hostile/unsupported output; evidence validation; prompt-injection corpus; golden evaluation with human-reviewed expectations |
| E2E | Full manual path first: submit→validate→analyze→policy→approve→finance gate→record payment; then AI-assisted and AI-outage variants; reject/cancel/clarify paths |
| Security | Cross-department access, role/authority escalation, replay, callback forgery, upload attacks, signed URL scope/expiry, CSRF/XSS, secret/log assertions |
| Performance/resilience | Simultaneous budget reservations, double-click approvals/payments, large histories/exports, queue/provider outage, DB restart, restoration drill |

The test database must be PostgreSQL, not SQLite, for correctness-sensitive suites. Concurrency tests should use barriers to force races, not hope timing collides. Test fixtures contain synthetic data and fake secrets only. CI must exercise manual mode with all AI flags off; this is a release gate.

# 17. Revised 10-Day Execution Plan

Ten days can produce a competition-ready, integrity-focused vertical slice with production-oriented foundations, but not the full eventual capability set at mature production depth. Scope must prioritize one currency/organization deployment assumptions, manual-first workflow, and one bounded AI capability. Each “day” below is a milestone and may require multiple engineers or extension when exit criteria fail.

| Day | Revised objective and exit criteria |
|---|---|
| 0 | This architecture/discovery report; resolve blocking choices; no feature code |
| 1 | Monorepo/toolchain, Compose dependencies, env validation, CI, Nest/Nuxt shells, OIDC-compatible identity contract/local adapter, RBAC/ABAC skeleton, logging/correlation, Prisma locking spike; architecture tests green |
| 2 | Payment request aggregate/revisions/state-transition service, ticket sequence, document metadata/version/hash/upload quarantine, transactional audit/outbox; manual submit/validate foundation |
| 3 | Manual validation and assessment end-to-end; document scan/extraction pipeline interfaces; one Document AI provider adapter with schema/evidence validation and outage fallback—not broad agents |
| 4 | Budgets, revisions, ledger, commitment lifecycle, deterministic finance context, currency rules; forced-race integration tests |
| 5 | Versioned policy evaluator, authority grants, approval plan/snapshots; keep explainability deterministic; do not spend this day on multiple AI agents |
| 6 | Channel-independent approval commands, concurrency/idempotency/replay controls, web approval UI; full approval tests |
| 7 | Telegram adapter and secure identity binding/callback handling; notification outbox; Telegram remains optional |
| 8 | Final finance-control gate, payment recording, commitment→actual transaction, duplicate-payment race tests, payment history/search/filter/pagination/export minimum |
| 9 | Deterministic dashboard plus one bounded Financial Risk analysis; AI flags/observability/manual override. Defer Finance Watch and Ask AIMS unless all core gates pass |
| 10 | Threat-model verification, recovery/failure drills, accessibility/performance, migration/backup restore test, UAT, runbook, demo rehearsal; fix defects rather than add features |

Deferred beyond Day 10 unless capacity is proven: Spending Pattern Agent, Compliance Agent, full Finance Watch, Ask AIMS, advanced exports, complex multi-currency consolidation, broad telemetry backend, and non-Telegram channels. “Multi-agent” is not itself a Day 10 success criterion; safe evidence-backed outcomes are.

# 18. Day 1 Entry Criteria

Day 1 may begin only after explicit approval to proceed and these criteria are met or given documented provisional defaults:

- This state machine, modular-monolith boundary, manual-first path, and commitment timing are accepted.
- Node 24 LTS and pnpm version pinning are accepted; Docker daemon can run locally.
- Target PostgreSQL major and Prisma conditional spike criteria are accepted.
- A provisional identity approach, role list, department-scope model, and production OIDC direction are identified.
- Currency precision, fiscal-year definition, time zone, and Day 10 supported-currency scope are defined.
- Document types/limits/retention and local object-store approach are defined.
- A policy configuration representation and provisional approval roles are approved without naming/hardcoding people.
- Telegram approval is legally/organizationally acceptable in principle, with secure identity enrollment required.
- Test/UAT owners and a synthetic demo dataset are available.
- No real LLM or Telegram secret is committed; secret injection method is agreed.

Day 1 exit should include a documented Prisma go/no-go result, running dependency health checks, CI baseline, validated configuration, a minimal authenticated health/API path, and no business feature implementation beyond foundation contracts.

# 19. Open Decisions

1. **Organization/tenancy:** Is AIMS single-organization for V1, or must hard tenant isolation exist from the first migration?
2. **Identity and authority:** Which OIDC provider, MFA requirements, canonical roles, department-access rules, segregation-of-duties constraints, delegated/temporary authority, and approver enrollment process apply?
3. **Money scope:** Which currencies are allowed in the 10-day release; what are currency minor-unit/rounding rules; can budgets and payments differ in currency; and what authoritative FX source/as-of policy applies if consolidation is required?
4. **Fiscal/budget rules:** Fiscal-year boundaries, budget dimensions, whether negative availability is forbidden or held, commitment creation timing (recommended: entry to `PENDING_APPROVAL`), clarification hold/expiry, and revision/transfer authorization need confirmation.
5. **Policy semantics:** Formal threshold boundary behavior, multi-step versus any-one approval, auto-approval eligibility/controls, evidence rules, expiry, escalation, and what happens when policy or authority changes mid-route.
6. **Material change:** Confirm which fields always invalidate validation/approval and whether any nonmaterial remark edit is allowed without a new approval cycle.
7. **Duplicate rules:** Define reliable invoice/business keys, bank-reference uniqueness scope, partial/split/multiple payments, over/underpayment, reversals, voids, and correction workflow. The proposed V1 assumes exactly one full payment per request.
8. **Documents/data governance:** Allowed formats/sizes, malware scanner, retention/legal hold, encryption/KMS, data residency, sensitive-field masking, and whether provider submission of document content is permitted.
9. **Telegram governance:** Is Telegram an approved channel for financial approvals; how are accounts bound/revoked; what content may messages expose; what is the required callback/action expiry?
10. **AI governance:** Provider/model/region, data retention/training terms, per-feature human-review requirements, cost ceiling, quality thresholds, and who can operate the AI kill switch.
11. **Operations:** Development/staging/production hosting target, recovery time/point objectives, availability target, backup/restore owner, monitoring platform, and incident/audit retention requirements.
12. **Delivery capacity:** Engineer/tester/security/product availability and which deferred capabilities are explicitly outside the competition release.

These decisions can use documented safe defaults for initial foundation work, but policy, money, identity, and payment semantics must be confirmed before their corresponding feature is considered complete.

# 20. Final Readiness

The repository and proposed technology have no blocking incompatibility. The architecture provides a safe path to start foundation work while preserving explicit decision gates before policy, approval, and payment behavior. Docker runtime access and the Prisma locking/ESM behavior must be verified during Day 1, not assumed.

**DAY 0 STATUS:**
**READY FOR DAY 1**

Proceed only after explicit approval; do not infer this report’s readiness conclusion as authorization to begin Day 1.

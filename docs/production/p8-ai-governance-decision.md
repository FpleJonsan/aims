# AIMS P8 AI Governance Decision

Status: DECISION COMPLETE — P8 CODE HARDENING REQUIRED; no Production AI
provider selected and no runtime implementation authorized by this document.

Baseline: `main` at `ba8e603`, clean worktree, target schema 57,
`057_p7_document_scan_worker_leases`, P6/P7 PASS and frozen, no migration 058.

## Decision

Current AI authority is correctly advisory, optional, human-reviewed, and
non-authoritative. AI OFF preserves the deterministic/manual workflow and needs
no provider credential or outbound request. However, Production AI must remain
OFF because provider reliability/resource bounds and evidence validation are not
yet sufficient. The selected P8 outcome is:

**P8 CODE HARDENING REQUIRED — NO PROVIDER SELECTION YET.**

No arbitrary SQL, provider-direct database access, Finance/Payment executor
authority, worker migration, Redis requirement, or autonomous workflow action
was found.

## AI surface inventory

| Surface | Input and document access | Output/evidence boundary | Human/AI-OFF behavior | Authority |
| --- | --- | --- | --- | --- |
| Validation Document Agent | Request payee/amount/currency/due date and every current CLEAN document body | Strict extraction/finding schema; prompt requests manifest IDs, but persistence does not validate IDs against that manifest | Finance review required; MANUAL or AI-unavailable fallback | None |
| Financial Risk | Current request, passed Validation identity, deterministic Finance Context snapshot/metrics | Strict agent schemas; evidence references required syntactically but not validated against a deterministic catalog | Human final assessment/override; MANUAL fallback | None |
| Spending Pattern | Same bounded workflow context as Financial Risk | Same schema and unresolved catalog-validation gap | Human final assessment; feature may be disabled | None |
| Compliance | Same bounded workflow context as Financial Risk | Same schema and unresolved catalog-validation gap | Human final assessment; feature may be disabled | None |
| Aggregator | Completed advisory agent outputs and authoritative Finance Context ID | Strict aggregate schema; remains advisory | Human final assessment; partial failures retained | None |
| Finance Watch | Authorized dashboard summaries, budget/trend/workflow projections and deterministic evidence catalog | Strict schema plus exact evidence identifier/value validation | Explicitly disabled when flag is OFF; failure history persisted | None |
| Ask AIMS | Bounded classified question, at most three authorized dashboard tools and evidence catalog | Strict schema plus exact evidence identifier/value validation; no SQL field | Explicitly disabled when flag is OFF; question stored only as hash | None |

No other runtime AI route, hidden document processor, or asynchronous AI worker
was found. Live smoke scripts are operator diagnostics, not product routes.

## Provider inventory

- Interface: `AiProvider` for document analysis; typed compatible methods for
  financial agents and Finance Intelligence.
- Runtime adapter: `OpenAiCompatibleProvider` using manual `fetch` to the
  Responses-style endpoint.
- Fake provider: yes, deterministic test only.
- Null/OFF provider: represented by `null`; service flags prevent calls.
- SDK: no.
- Model/base URL: configurable.
- API key: server-only and included in P5 redaction/placeholder validation.
- Production provider selected: no.

## Authority and trust findings

The provider has no database credential and cannot call policy, approval,
Finance Control, Payment, ledger, commitment, or PAID paths. Monetary metrics
sent to risk/intelligence surfaces originate in deterministic PostgreSQL
queries and integer calculations. Model output is stored as interpretation and
requires human finalization where workflow-relevant.

Validation selects only current `CLEAN` documents. UNVERIFIED, QUARANTINED,
SCANNING, SCAN_FAILED, REJECTED, unknown, and null trust states are excluded.
Risk agents and Finance Intelligence do not read document bodies directly.

## Findings and required future correction scope

### HIGH

1. `P8-HIGH-001 — Provider reliability is unbounded.` The provider `fetch` has
   no AbortSignal/deadline, retry budget/backoff, explicit 429/5xx retry policy,
   or response-byte ceiling. A stalled provider can hold a synchronous request
   indefinitely and oversized responses can consume unbounded memory. Add finite
   validated connect/request deadlines, bounded retries with jitter/backoff for
   approved transient classes, response limits, safe classifications, and tests.

2. `P8-HIGH-002 — Validation evidence is not manifest-bound.` Runtime schema
   validates UUID/version shapes, but `persistOutput` accepts any existing
   `payment_documents` ID. A model-supplied ID from another request could satisfy
   the foreign key and be persisted as cross-request evidence. Validate every
   extraction/evidence `(documentId, version)` against the exact current CLEAN
   manifest supplied to that call, reject null document references except an
   explicitly modeled request-only evidence type, and add fabricated/cross-scope
   tests.

### MEDIUM

1. `P8-MEDIUM-001 — Risk-agent evidence is not catalog validated.` Agent schemas
   require typed references but `saveAgent` persists them without matching an
   allowlisted deterministic evidence catalog. Build and validate a bounded
   catalog for each run and aggregator input.

2. `P8-MEDIUM-002 — Provider request bounds are incomplete.` Per-document upload
   size and output-token limits exist, but total documents, aggregate encoded
   bytes, finding/evidence collection sizes, input text, and concurrent agent
   calls are not comprehensively bounded. Add explicit tested limits without
   expanding AI capability.

3. `P8-MEDIUM-003 — Usage/cost traceability is incomplete.` Provider, model,
   prompt version, tokens, latency, status, and linked run are generally stored,
   but correlation/actor/mode/schema-version coverage is inconsistent and
   `estimated_cost` is not populated. Define versioned configuration-based cost
   estimation prospectively; never rewrite historical prices or store prompts.

4. `P8-MEDIUM-004 — Data minimization needs an explicit projection.` Finance
   Intelligence passes broad dashboard result objects and raw payee labels in
   addition to its minimized evidence catalog. Define surface-specific REQUIRED,
   OPTIONAL, and PROHIBITED projections; exclude bank/payment details, identity,
   comments, Telegram/session data, and unnecessary raw labels.

### LOW

1. Central AI metrics/alerts, provider SLA ownership, budget thresholds, and
   circuit-breaker policy remain P10/P11/P15/provider-selection work.

## Production provider governance gate

Later provider selection must establish enterprise/API terms, training use,
retention and deletion, region/residency, subprocessors, file retention,
abuse-monitoring handling, incident notification, access/audit controls, service
limits, approved models, and contractual data classes. Repository `store:false`
is a request option, not proof of contractual retention or training guarantees.

## Readiness classification

| Area | Classification |
| --- | --- |
| AI authority / AI OFF | READY |
| Human review and override | READY |
| Document CLEAN gating | READY, subject to manifest-binding correction |
| Validation evidence integrity | NEEDS P8 CODE HARDENING |
| Risk-agent evidence integrity | NEEDS P8 CODE HARDENING |
| Structured output schemas | NEEDS P8 CODE HARDENING for collection/input bounds |
| Provider timeout/retry/resource handling | NEEDS P8 CODE HARDENING |
| Finance Watch / Ask AIMS SQL and scope boundary | READY |
| Usage/cost traceability | NEEDS P8 CODE HARDENING |
| Provider privacy/contract | BLOCKED ON PRODUCTION PROVIDER SELECTION |
| Central observability/alerting | BLOCKED ON P10/P11 |
| Production v1 with AI OFF | OPTIONAL AI; deterministic workflow remains viable |

## Gate

- Runtime code changed: NO.
- Migration 058: NONE.
- Frontend changed: NO.
- Redis/scheduler/worker relationship changed: NO.
- P9 started: NO.
- Next: wait for explicit P8 hardening authorization. Production AI remains OFF.

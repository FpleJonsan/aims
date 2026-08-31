# AIMS P8 AI Governance Hardening

Status: IMPLEMENTED; AI-OFF configuration-gate correction verified and pending
final read-only re-review.

This change hardens the existing optional, synchronous, advisory AI surfaces. It
does not select a provider, enable Production AI, add an agent, alter financial
authority, move work to P7, change the frontend, or create migration 058.

## Resolved authorized findings

| Finding | Resolution |
| --- | --- |
| H-01 | Central finite timeout, propagated abort, bounded transient retry with exponential backoff and jitter, streaming response-byte ceiling, output-token ceilings, and safe normalized failures. |
| H-02 | Validation sends an exact CLEAN document ID/version/SHA-256 manifest, rejects all output references outside it, and locks/rechecks the complete CLEAN manifest before persistence. |
| M-01 | Risk agents and Aggregator receive a bounded deterministic evidence catalog and all evidence references must match its source/reference/field keys exactly. |
| M-02 | Central document, aggregate-byte, input-text, question, evidence and output-collection bounds reject oversized input/output without truncating security-relevant results. |
| M-03 | Existing run/usage/audit links record provider, model, prompt/contract version, tokens, latency, retry count, actor/correlation where available, AI mode, safe failure and schema version. Unknown cost remains `NULL`, never zero. |
| M-04 | Finance Watch receives only period/data-quality plus authorized evidence; Ask AIMS receives the question, authorized scope, bounded evidence and tool names/count. Raw dashboard/tool rows and raw payee labels are not sent. |

## Reliability configuration

The following optional server-only values have bounded defaults and are
validated whenever `AI_MASTER=ON`:

- `AI_REQUEST_TIMEOUT_MS` (default 30000; maximum 120000)
- `AI_MAX_RETRIES` (default 2; maximum 5)
- `AI_RETRY_BASE_DELAY_MS` (default 250; maximum 10000)
- `AI_MAX_RESPONSE_BYTES` (default 2097152; maximum 8388608)

Only network failures, timeouts, 429, and provider 5xx responses are retried.
Authentication, invalid request, malformed JSON, schema-invalid output and
oversized output are terminal. The budget is one initial attempt plus the
configured retry count. Aborting the client request is best-effort client-side
cancellation and is not claimed as provider-side cancellation.

## Evidence, trace and privacy semantics

Uploaded content and questions remain untrusted data. A Validation result is
accepted only while the same request's exact CLEAN ID/version/SHA-256 set still
matches. Risk evidence cannot trigger model-directed database lookup. Provider
structured output remains strict and human-reviewed.

Usage cost is unknown unless a separately approved, versioned pricing policy is
introduced. `estimated_cost IS NULL` means unknown; zero must not mean free.
The linked run plus audit correlation provides the logical invocation chain;
retry count records provider attempts without creating authoritative business
mutations.

## Open Production gates

Production AI remains OFF. Provider/model selection, retention, training,
residency, deletion, subprocessors, contractual privacy, incident response,
pricing policy, monitoring and operational ownership remain blocked on separate
Production decisions. P7 remains frozen and AI remains synchronous for v1.

## Verification closure

Repository lint, typecheck, 15 frontend/auth tests, 130 API tests, frontend/API
builds and whitespace validation pass. Every disposable integration uses schema
57 and passes: core PostgreSQL, Validation, Finance Context, Financial Analysis,
Policy, Approval/Telegram, Finance Control, Payment, Dashboard/Intelligence,
document security, P7 worker and four-scenario UAT including AI OFF. The P6
001–057 role/default-privilege/attack proof passes. No live provider call was
required and no Production provider was selected.

P8 IMPLEMENTATION FROZEN: YES

## AI-OFF configuration-gate correction

The frozen review's single Medium finding is resolved. Runtime provider wiring,
Production configuration validation and readiness now reuse one explicit
`AI_MASTER` interpretation. The provider factory returns the existing `null`
boundary before reading or parsing any provider-only value when the master is
OFF. A stale API key, malformed base URL, invalid timeout, invalid retry values,
invalid response ceiling, or enabled subordinate flag cannot initialize or call
the provider while the master is OFF.

The inverse remains fail closed: master ON requires a non-placeholder key, an
HTTPS provider URL and valid bounded reliability controls. Secret presence is
not feature enablement. Production AI remains OFF and its provider/privacy/
contract gate remains open.

P8 CORRECTION IMPLEMENTATION FROZEN: YES

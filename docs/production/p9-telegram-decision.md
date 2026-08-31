# AIMS P9 Telegram Production Hardening Decision

Status: DECISION COMPLETE — P9 CODE HARDENING REQUIRED; no external Telegram
setup or Production enablement authorized.

Baseline: `main` at `81ff93c`, clean worktree, target schema 57,
`057_p7_document_scan_worker_leases`, no migration 058+, P6/P7/P8 PASS and
frozen, Production AI OFF, P9 not previously started.

## Decision

**P9 CODE HARDENING REQUIRED — NO EXTERNAL SETUP YET.**

Telegram remains optional and the core/web workflow remains functional with it
disabled. Telegram actions resolve an active AIMS identity and converge into
the same `ApprovalService.act` transaction used by web Approval. That service
locks the request and step, revalidates current user/authority, amount and
department scope, self-approval, case/step status, request revision, current
Validation/Finance Context/Risk/Policy identities and CLEAN evidence
fingerprint. Telegram has no Finance Control, Payment, ledger, commitment,
PAID, Policy or database-executor capability.

Production enablement is nevertheless unsafe until the findings below are
corrected. No runtime correction, external bot setup, credential, migration,
database, role, P7, P8, frontend, Redis or scheduler change occurred in this
decision gate.

## Surface inventory

| Surface | Authentication and authorization | Mutation / external use | Secret and OFF behavior | Audit / idempotency |
| --- | --- | --- | --- | --- |
| Web Approval | AIMS session plus current `ApprovalService.act` authority | Approval action | No Telegram dependency | Transactional action/audit; command key and terminal-step uniqueness |
| Webhook | Telegram header secret, timing-safe comparison | Claims update then routes callback/reply | Uses webhook secret, but is not gated by `TELEGRAM_APPROVAL_ENABLED` | Update ID state machine plus domain idempotency |
| Identity binding | Authenticated technical ADMIN; target must be active | Creates/replaces user-ID/chat binding | No provider call | Bound/revoked audit; active user and Telegram-user uniqueness |
| Action tokens | Opaque UUID plus truncated HMAC; SHA-256 stored | Selects exact action/case/step/recipient | Callback secret; 15-minute TTL | Status/expiry, command-key and step uniqueness prevent duplicate business action |
| Reject/clarify reply | Active binding by numeric user and bound chat | Creates pending interaction, then calls `act` | Webhook secret | Ten-minute pending interaction; one pending binding; command-key replay safety |
| Notification enqueue | Current active authority and binding selected in Approval transaction | Inserts minimal outbox payload | No outbound call at enqueue | Unique aggregate/event/recipient |
| Outbox delivery | Normal application database boundary | Sends Telegram message | Channel constructed only when master flag and token exist; callback generation needs secret | SKIP LOCKED claim token, lease, five attempts, terminal state and audit |
| Independent worker | Explicit worker config and normal `aims_app` URL for Telegram | Polls outbox and calls Telegram | Master flag controls workload creation; worker validation is incomplete | Safe polling; P7 document executor remains separate |
| Manual dispatch route | Authenticated FINANCE | Invokes the same outbox dispatcher | Disabled channel fails delivery, not Approval | Same claims/retries/audit |
| Readiness | None; health endpoint | Read only | Reports disabled unless master flag true | No secret values returned |

No legacy alternative Telegram authority, debug approval bypass, fake
Production Telegram adapter or request-controlled chat destination was found.

## Findings

### HIGH

1. **P9-HIGH-001 — Telegram OFF does not close the inbound operational path.**
   Provider construction and worker delivery honor
   `TELEGRAM_APPROVAL_ENABLED`, but the webhook controller and
   `telegramWebhook` service do not. If the master flag is OFF while a stale
   webhook secret, binding and action token remain, a valid callback can still
   execute the authoritative Approval action. Secret presence therefore remains
   an effective inbound enablement path. Gate the webhook before update claims
   or domain work, return a safe disabled response, and prove OFF matrices with
   stale secrets/tokens and zero mutation.

2. **P9-HIGH-002 — Telegram provider I/O is unbounded and can stall the shared
   worker.** `TelegramApprovalChannel.send` uses bare `fetch` with no deadline or
   `AbortSignal`, reads unbounded JSON and has no shutdown/lease coherence. A
   hung Telegram call blocks the sequential worker loop, including document
   scanning when both workloads share the process, and can outlive the outbox
   lease so another worker reclaims and resends. Add a finite validated
   deadline, propagated cancellation, bounded response reader and a worker
   lease/shutdown invariant. Preserve at-least-once delivery claims.

### MEDIUM

1. **P9-MEDIUM-001 — Telegram response/retry classification is incomplete.**
   429 is retried only through the fixed five-minute outbox delay; `Retry-After`
   is ignored. Selected 5xx/network errors retry, terminal 4xx stop, but empty,
   malformed, oversized and protocol-level error responses lack distinct safe
   classifications and tests.

2. **P9-MEDIUM-002 — Webhook/application input bounds are incomplete.** The
   framework's default total JSON limit is finite, but update IDs are not
   constrained to safe non-negative integers, binding numeric strings have no
   explicit length/format bounds, callback data/nesting are not contract
   validated, and reply text bypasses DTO validation when passed internally to
   `act`. Add an explicit bounded webhook contract and safe rejection tests.

3. **P9-MEDIUM-003 — Independent Telegram-worker startup validation is
   incomplete.** The worker validates the master flag, token and normal runtime
   database identity, but not the callback secret it needs to generate tokens,
   placeholder/Production strength, or Telegram HTTP reliability controls. An
   enabled worker can start and repeatedly fail jobs instead of failing closed.

4. **P9-MEDIUM-004 — Binding lifecycle and destination policy need hardening.**
   Binding is explicit, audited, unique and action-time fail closed, but there
   is no dedicated revoke-without-rebind operation or verified ownership/private
   chat handshake. ADMIN supplies the numeric chat ID directly. Requests cannot
   redirect notifications, but Production private-chat/group policy and an
   ownership proof remain undefined.

5. **P9-MEDIUM-005 — Action-time authority regression coverage is incomplete.**
   Code queries current active authority, amount bounds and department at action
   time, and existing tests deny insufficient/self/wrong-department actors.
   There is no explicit executable sequence proving an already-notified
   approver is denied after authority revocation or amount-limit reduction.

6. **P9-MEDIUM-006 — Outbound data minimization needs a Production contract.**
   Current messages contain ticket number, currency, amount and purpose only;
   bank/payment data, documents, risk, Finance Control, credentials and callback
   business fields are absent. Purpose is free-form business text and is sent
   without a Telegram-specific projection/length policy. Approve or remove it
   before real-data enablement.

### LOW / LATER GATES

- Central metrics and alerts for webhook authentication/identity/token failures,
  provider outcomes, pending age, leases, retries and terminal failures remain
  P10/P11 work.
- Edge rate limiting, TLS termination, trusted proxy controls and public webhook
  exposure remain P13 work.
- At-least-once delivery may duplicate an external Telegram message after
  provider acceptance and response loss. Domain action idempotency prevents a
  duplicate Approval mutation; provider-message exactly-once is not claimed.

## Authority, token and identity conclusions

The stable Telegram numeric user ID maps through an explicit active binding to
an active AIMS user; display names, usernames, emails and message content do not
establish identity. Conflicting active Telegram-user bindings are denied by a
partial unique index. Rebinding revokes prior tokens/interactions and is audited.
Inactive users and revoked bindings fail closed.

Tokens are 15 minutes, opaque, approximately 144-bit HMAC-authenticated in
addition to a UUID identifier, stored only as SHA-256, single-action and bound
to exact case, step and recipient. Reject/clarification pending interactions
expire after 10 minutes. Replay is stopped by token state, webhook update state,
unique command keys, one terminal action per step and serialized domain locks.

Web and Telegram converge at `ApprovalService.act`. Current authority, amount
bounds, scope, self-approval, active user, current case/step and evidence/policy
freshness are rechecked there. Technical ADMIN has no operational authority
unless independently granted current Approval authority. Clarification closes
and invalidates the old case, returns the request to SUBMITTED/revalidation and
prevents old tokens from reviving it.

## Outbox and provider semantics

Notification enqueue occurs in the Approval transaction. Claims use
`FOR UPDATE SKIP LOCKED`, unique claim tokens and worker IDs. The default lease
is 120 seconds, attempts are capped at five, retries use persisted
`next_attempt_at`, terminal failure is retained and stale claim completion is
rejected. Delivery is **at-least-once attempt**, not exactly once. A Telegram
accept/response-loss window can produce a duplicate message, while Approval
business mutation remains idempotent.

The Telegram worker uses the normal application boundary only and cannot set
role to owner, migrator, Finance, Payment or document-worker executors. P7's
document-worker authority and P8 remain unchanged.

## Data and external governance

Sent fields are ticket number, amount, currency and purpose. Callback data is
opaque. Payee, requester, category, department, due date, risk, priority,
urgency, comments, document names/contents, Finance Context, Finance Control,
bank reference, payment reference/details, credentials and internal authority
limits are absent.

Before enablement the company must approve bot ownership, token/webhook/callback
secret custody, rotation and incident owners, webhook registration/allowed
updates, private-chat/group policy, message data classification, Telegram
processing/retention, device/forwarding/screenshot risk, residency/cross-border
implications and support ownership. Telegram is not treated as an enterprise
confidentiality guarantee.

## Executable evidence and missing coverage

- `npm test`: PASS — 15 frontend/auth and 134 API tests.
- `npm run test:approval:integration --workspace @aims/api`: PASS — 20/20
  against a guarded disposable schema-57 database with cleanup.
- Existing proof covers authentic/incorrect secret, unknown identity, inactive
  user binding denial, rebind/revocation, expired/revoked/consumed/cross-identity
  tokens, duplicate callbacks/webhook updates, wrong/stale steps and cases,
  evidence/material invalidation, amount/scope/self-approval denial, all three
  actions, clarification, concurrency, outbox token rotation, lease recovery,
  stale workers and terminal state.
- Missing mandatory proof covers webhook master OFF, stale secret/token while
  OFF, explicit authority revocation after notification, amount reduction after
  notification, provider timeout/abort, 429 Retry-After, 5xx/network matrix,
  malformed/oversized response, bounded webhook fields, arbitrary destination
  ownership and terminal provider classifications.

## Production readiness classification

| Area | Classification |
| --- | --- |
| Feature gating / OFF webhook | NEEDS P9 CODE HARDENING |
| Secret handling | NEEDS P9 CODE HARDENING for worker parity; P5 foundation otherwise READY |
| Webhook authentication | READY when ON; OFF gating NEEDS P9 CODE HARDENING |
| Webhook bounds | NEEDS P9 CODE HARDENING |
| Identity binding | NEEDS P9 CODE HARDENING for revocation/ownership policy |
| Action-token design | READY |
| Replay protection | READY |
| Action-time authority and web convergence | READY; revoked/reduced regression proof NEEDS P9 CODE HARDENING |
| Amount authority / self-approval / ADMIN boundary | READY |
| Data minimization | NEEDS P9 CODE HARDENING and privacy approval for purpose |
| Destination policy | BLOCKED ON PRIVACY / COMPANY APPROVAL and NEEDS P9 CODE HARDENING |
| Outbox claim/lease/idempotency | READY |
| Worker concurrency/database authority | READY |
| Telegram timeout/response bounds/retry classification | NEEDS P9 CODE HARDENING |
| Terminal delivery persistence | READY |
| Audit | READY foundation; centralized consumption remains P10/P11 |
| Observability | BLOCKED ON P10 / P11 OBSERVABILITY |
| Privacy and bot ownership | BLOCKED ON PRIVACY / COMPANY APPROVAL / EXTERNAL TELEGRAM SETUP |
| Network/TLS/rate limiting | BLOCKED ON P13 NETWORK / TLS |
| Telegram disabled for Production v1 | OPTIONAL / NOT REQUIRED FOR PRODUCTION V1 |

## Gate

- Critical: 0.
- High: 2.
- Medium: 6.
- Low: 3 accepted later/external gates.
- Runtime/tests/migration/database/roles/frontend/P7/P8 changed: NO.
- Redis/scheduler required: NO.
- P10 started: NO.
- P9 final: NO.
- Next: wait for explicit P9 implementation authorization. Do not configure an
  external bot or Production credentials.

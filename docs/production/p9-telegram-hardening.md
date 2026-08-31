# AIMS P9 Telegram Production Hardening

Status: PASS / FROZEN — external Production Telegram setup remains unauthorized.

Baseline: `main` at `901a8c8`, clean worktree, schema 57,
`057_p7_document_scan_worker_leases`, no migration 058+, P6/P7/P8 PASS and
frozen, Production AI OFF, Redis absent, scheduler absent and Telegram not
externally configured.

## Implemented boundary

- `TELEGRAM_APPROVAL_ENABLED` is the sole master gate. The webhook returns a
  non-operational result before secret validation, update claiming, token
  consumption or domain work when OFF. Stale subordinate configuration cannot
  activate inbound or outbound Telegram work.
- API, worker and readiness use one Telegram configuration contract. Enabled
  mode requires bot, webhook and callback secrets, rejects placeholders, and
  validates finite provider limits and outbox-lease coherence. Disabled mode
  requires no Telegram secrets and ignores malformed subordinate-only values.
- Outbound provider I/O has a 10-second default deadline with `AbortSignal`, a
  64-KiB default response ceiling and active-request cancellation on worker
  shutdown. One provider call occurs per claim; retries are persisted in the
  PostgreSQL outbox rather than slept in-process.
- Network, timeout, 429, selected 5xx, terminal 4xx, empty, malformed,
  oversized and Telegram `ok:false` results receive safe classifications. 429
  uses bounded deterministic header-before-body Retry-After precedence.
- Webhook updates enforce bounded depth, nodes, arrays and objects, safe integer
  IDs, Telegram callback-size limits and 2,000-character interactive text.
  Production approval callbacks require a same-user private chat.
- Direct administrator destination entry was removed from the HTTP API. The
  API issues an expiring one-time opaque binding challenge; the user presents
  it to the bot from the same Telegram identity/private chat. Challenge,
  binding, rebind and explicit revoke are audited. Revoke cancels pending
  interactions, revokes tokens and terminalizes outstanding delivery until a
  verified rebind.
- Telegram purpose text is deterministically normalized, control-character
  stripped and limited to 160 Unicode code points. Plain text is used and no
  additional sensitive fields were added.
- Telegram still converges on `ApprovalService.act`; no Telegram-only Approval,
  Finance Control, Payment, ledger, commitment, Policy or PAID authority exists.

## Executable evidence

- `npm test`: PASS — 15 frontend/auth and 138 API tests.
- Approval/Telegram disposable integration: PASS — 26/26, including master
  OFF, private binding/revoke, bounds, replay, stale cases, self/scope rules,
  and authority revoked or amount reduced after notification.
- P6 disposable database proof: PASS — migrations 001–057, role/default
  privilege manifest, attack tests and UAT.
- P7 document worker: PASS — 13/13, including bounded provider shutdown and
  recoverable leases.
- Finance Control/Payment: PASS — 35/35.
- All other repository integration suites and four-scenario UAT: PASS.
- Integration isolation guard: PASS — shared local `aims`, competition,
  staging and Production unchanged.
- Lint, typecheck, frontend build, API build and `git diff --check`: PASS.

## Preserved boundaries

Schema remains 57; migration 058+ is absent. No database, role, grant,
frontend, Redis, scheduler, P7 document authority, P8 AI authority, financial
logic or locked workflow change occurred. Production Telegram remains OFF and
no bot, credential or webhook was configured.

External gates remain open: approved bot ownership and token custody,
privacy/security and retention/residency approval, device/forwarding policy,
P10/P11 monitoring/alerting and P13 TLS/network/edge rate protection.

## Final frozen review

The mandatory read-only review passed from Senior Application Security,
Backend Architecture, PostgreSQL/Concurrency, Production/SRE and Data
Governance/Privacy perspectives. Critical, High, Medium and Low findings
requiring correction: NONE. Code, database, documentation, tests, migrations
and privileges changed during the review: NO.

P9: PASS / FROZEN. Overall Production ready: NO. P10: NOT STARTED.

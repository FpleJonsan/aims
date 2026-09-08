# P13.3.1 Storage Object Version Binding

Status: PASS / FROZEN at schema 61.

Migration `061_p13_storage_object_version_binding` adds a provider-neutral,
immutable physical-object identity to `payment_documents`. The source identity
is the storage backend, uploaded key, opaque source version, SHA-256, byte size,
and logical document version. A separate trusted key and opaque trusted version
are initially null and may be written exactly once by the durable document
worker during an authoritative `SCANNING` to `CLEAN` completion.

Existing rows remain `LEGACY_UNBOUND`. Migration 061 does not infer versions,
upgrade historical trust, change PAID records, or alter accounting. Legacy
rows are not claimable by the version-bound worker and are not eligible as new
authoritative workflow evidence.

The P7 worker claim and completion functions bind and compare the complete
physical identity, scan attempt, claim token, and P12 recovery generation.
Mismatched or stale completions fail closed. CLEAN completion atomically stores
the trusted identity. API-triggered synchronous document and payment-slip scan
authorities are removed; uploads converge on the durable worker.

Before CLEAN, the worker verifies the promoted result and then reads exact
destination metadata by backend, trusted key and immutable version. Provider,
backend, status, key, version, SHA-256 and byte size must agree with the exact
source bytes scanned. Missing, ambiguous or mismatched proof follows the
existing failure lifecycle and cannot establish trust. Promotion is
deterministic and accepts an existing destination only when its complete
immutable identity matches; cancellation propagates and an expired lease is
rejected by database time before completion.

The storage abstraction canonicalizes the provider-neutral logical destination
before promotion. The worker retains that requested trusted key, supplies it to
promotion, and requires exact equality with the returned key. Equal bytes at a
different non-empty key do not satisfy object identity and cannot become CLEAN.

Completion arguments are explicitly required and all identity comparisons are
NULL-safe. Upload provider and backend provenance come only from the selected
server-side adapter. The unused synchronous scan-and-promote helper was removed,
leaving the P7 durable worker as the single protected scan authority.

Claim parameters are also fail-closed: a NULL lease duration or maximum-attempt
ceiling is rejected before row selection, audit insertion, or any claim-state
mutation. This prevents SQL three-valued logic from bypassing lease bounds or
the retry ceiling.

At the claim boundary, row-locked terminalization also covers a version-bound
`SCANNING` row whose recovery fence cleared its token, lease, and generation
after the attempt ceiling was reached. It retains the attempt count, uses the
existing terminal `SCAN_FAILED` representation, and appends bounded audit
evidence without implying a malware verdict. A fenced row below the ceiling
remains eligible for the existing safe reclaim path; stale-generation workers
cannot complete either path.

The P12 checker retrieves the exact trusted backend/key/version and verifies
SHA-256 and byte size. It reports legacy CLEAN evidence as not independently
version-verifiable, distinguishes orphan objects by backend/key/version, and
never repairs, binds, or upgrades evidence.

Migration 061 creates no login role, provider-specific column, provider
adapter, infrastructure, frontend, workflow, financial authority, or provider
selection. The existing local adapter implements a development-only opaque
version contract and remains rejected in protected environments.

Clean `001`–`061` execution and the guarded `060` to `061` transition are
exercised only in disposable `aims_test_*` databases. The shared local `aims`
database is not migrated by this phase.

# AIMS P12 Backup, Restore and Disaster Recovery Runbook

## Scope and authority

This is the canonical provider-neutral recovery sequence for AIMS schema 59. It does not configure backups, PITR, object replication, credentials, routing or a cloud provider. A backup is evidence from which recovery may be attempted; it is not proof that AIMS or an external payment system is reconciled.

The Incident Commander records the recovery authorization and keeps the API, document worker, notification dispatcher, AI and Telegram stopped. Production AI and Telegram remain OFF throughout validation. Preserve forensic evidence before selecting a trusted database recovery point, object recovery reference and compatible application release.

## Mandatory order

1. Declare the incident and obtain recovery authorization.
2. Freeze traffic, API processes, workers and outbound integrations. Preserve logs and affected media.
3. Select a trusted database restore point, object restore reference and application release. Record provider attestations without copying credentials or provider payloads.
4. Restore the historical database and object state into an isolated recovery environment. Recover secrets through the approved external secret process; do not put them in the manifest or evidence report.
5. Keep every service frozen. Confirm the restored schema is recognizable before proceeding; do not run automatic migrations.
6. Using the separately controlled `aims_migrator` recovery procedure, call `advance_aims_recovery_generation(reason, correlation_id)` exactly once for this recovery authorization. Never run the restore checker as a substitute for this step and never move generation backwards.
7. Read and record the new generation and its append-only event evidence. Confirm stale sessions, Approval action credentials, Telegram pending interactions, document claims and outbox claims are fenced.
8. Prepare the version 1 recovery manifest. Its expected generation must be the newly advanced generation.
9. Run the read-only restore checker. Reconcile current identity/authority assignments and external payment reality. Resolve every FAIL or NOT_VERIFIABLE result and record all warnings/exceptions.
10. Obtain explicit human recovery approval. A checker result never authorizes resume.
11. Start the API first with AI and Telegram OFF. Reauthenticate users; do not preserve old sessions. Start the document worker only after claim review, then review the outbox before enabling any separately approved dispatcher. Resume traffic last.
12. Capture post-incident evidence, actual restore duration, recoverable-point observations and remaining exceptions.

The required sequence is: **RESTORE → KEEP SERVICES FROZEN → ADVANCE RECOVERY GENERATION → VERIFY GENERATION → RUN RESTORE CHECKER → RECONCILE IDENTITY AND EXTERNAL PAYMENT REALITY → HUMAN RECOVERY APPROVAL → START API/WORKERS IN APPROVED ORDER → RESUME TRAFFIC**.

## Recovery manifest and checker

The JSON manifest contract is implemented in `apps/api/src/infrastructure/recovery/recovery-manifest.ts`. Version `1` binds the declared database/object recovery evidence, recovery point, application release, schema 59, migration 059 and post-restore generation. Every operator/provider-supplied reference is bounded and rejects credential-bearing database URIs, generic URI userinfo and known secret assignments without echoing the value. It contains no secrets, financial values, payee/purpose, bank references, document bytes, raw SQL or raw provider data. Manifest existence is not authenticity; provider attestation/signing remains a future provider capability.

Build and invoke the offline checker from the API workspace:

```text
RECOVERY_CHECK_DATABASE_URL=<controlled migrator connection> \
AIMS_RELEASE_ID=<exact release identifier> \
RECOVERY_CHECK_TIMEOUT_MS=<tool-safety duration within documented bounds> \
npm run recovery:check --workspace @aims/api -- /secure/operator/path/recovery-manifest.json
```

The controlled checker connection must be the restored, isolated database and must be capable of `SET LOCAL ROLE aims_owner`. The checker immediately opens a repeatable-read, read-only transaction and never calls the generation-advance function. Default local document verification additionally requires the existing non-Production local-storage variables. A future provider adapter must implement the same provider-neutral `DocumentStorage` contract.

Exit codes:

- `0`: verification PASS; human recovery approval is still required.
- `2`: verification failed, incomplete, warning-bearing, or requires manual reconciliation; not safe for automatic resume.
- `3`: bounded invocation, manifest, configuration or execution error.

Machine-readable JSON goes to stdout; the concise status goes to stderr. The manifest filename is represented only by a one-way bounded identifier. Output contains bounded codes/counts and at most 100 detailed findings by default. It does not dump business records.

The checker uses ordered keyset pages for every CLEAN database document and bounded continuation pages for storage enumeration. Storage pages are ordered by the complete normalized object key; cursors are strict `key > cursor` continuation boundaries under that same comparator. The local adapter incrementally walks directories with `opendir()`, closes every directory handle during normal, abort and error unwinding, and scans the frozen restored object set while retaining only the smallest `pageSize + 1` qualifying complete keys. Its adapter-owned key metadata is therefore `O(pageSize + traversal depth)`, excluding filesystem/runtime internals, and does not grow with flat-directory cardinality. Filesystem traversal and creation order cannot skip directory/file prefix collisions. This is a correctness boundary for the local development adapter, not a Production throughput claim. The restored database and object dataset must remain operationally frozen for the entire verification.

`FULL` means every eligible CLEAN row was processed and every required storage page completed; it reports eligible, processed, failed and unverified counts plus explicit completion. A deadline, cancellation, page/provider failure, cursor loop, duplicate/out-of-order key, empty non-terminal page or safety-bound exhaustion makes FULL/orphan coverage incomplete and prevents PASS. `LIMITED` remains diagnostic and cannot contribute complete document-integrity assurance. One authoritative overall deadline bounds connection acquisition and every PostgreSQL statement using the remaining duration and transaction-local `statement_timeout`; completion is checked again after each operation and timeout destroys an unusable pooled connection without leaking session state. Storage metadata and enumeration calls receive an operation-scoped signal composed with caller cancellation and the overall deadline. A per-operation timeout aborts the underlying call and the checker waits within a separate bounded cleanup interval for traversal/resource settlement before emitting a sanitized timeout finding. The default overall duration is a **tool execution safety default**, not an RTO, SLO or Production recovery target. Per-object timeouts are separate and cannot extend the overall deadline.

Independent SQL checks use read-only savepoints. An unexpected worker/outbox or other check failure is recorded as a bounded failure, the transaction is recovered to its savepoint, and later safe independent checks continue. Any required check failure makes PASS impossible.

### Authoritative financial graph verification

For every restored Payment, the checker validates the complete stored business
lineage rather than treating individually valid rows as sufficient. The Payment
must map to its PAID request, current approved Approval case, current passed
Finance Control run, the exact consumed Approval commitment, the exact ACTUAL
ledger entry, and one coherent budget/currency lineage. Approval and Finance
Control upstream validation, Finance Context, risk-analysis and Policy identities
must agree. Cross-wired rows, stale terminal authority, currency divergence and
Payment/ledger/commitment double reduction are failures.

The schema-59 financial cardinality is one-to-one in both directions: each
Payment identifies one unique PAYMENT ledger entry and one unique consumed
commitment; each PAYMENT ledger entry references exactly that Payment, and each
Payment-linked CONSUMED commitment references exactly that Payment. Reverse
set-based checks reject orphan effects, extra effects and cases where the effect
points to a Payment that identifies a different ledger or commitment. ACTIVE,
RELEASED and non-Payment historical commitments, and non-PAYMENT ledger reference
types, are outside this reverse Payment rule. Under the current lifecycle,
CONSUMED is Payment-only: a CONSUMED commitment with a null or missing Payment
link is inconsistent and fails recovery verification.

Payment command version and fingerprint are recomputed using the version-1
deterministic command contract. Both legitimate values of the recorded
`confirmPossibleDuplicate` input are accepted; a key/fingerprint/request mismatch
is not. Bank-reference uniqueness is evaluated only in the database-authoritative
`payment_method + currency + normalized reference` scope, and output never
contains the reference. Available is recomputed read-only per active budget and
currency as active budget version minus authoritative ACTUAL ledger entries minus
ACTIVE commitments. The verification universe begins with every active budget;
each must have exactly one active version. A missing active version cannot
disappear through a join, and multiple active versions also fail. Consumed
commitments are excluded so Payment is not deducted twice.

### Restored P6 trust verification

The checker evaluates the recovered database itself against the frozen P6
catalog contract. It checks role attributes and exact AIMS memberships, database
owner and CONNECT restrictions, public-schema ownership/USAGE/CREATE, relation
and function ownership, PUBLIC table/sequence/function ACLs, exact Finance,
Payment and document-worker executor allowlists in both directions (missing and
unexpected effective EXECUTE authority), worker cross-authority denial,
recovery-generation advance authority, SECURITY DEFINER owner/search path/ACL,
and the complete frozen `aims_owner` default-ACL state across all represented
schemas, object classes, grantees, privilege types and grant options. These
checks report drift only: they never issue GRANT, REVOKE, ALTER, repair, or
executable DDL.

The disposable P6 bootstrap proof and restored-state checker are complementary.
The former proves the build/hardening process; the latter determines whether the
specific recovered database still matches that trust boundary.

## Mandatory reconciliation

- Database consistency does not establish bank/payment reality after recovery point T. Finance Operations must compare verified external payment evidence and explicitly resolve `EXTERNAL_PAYMENT_RECONCILIATION_REQUIRED` without fabricating evidence.
- A restored PAID request requires exactly one authoritative Payment with matching ledger, consumed commitment, Approval and passed Finance Control lineage. Preserve `Available = Active Budget − Actual Ledger − Active Commitments` per budget and currency; do not aggregate across currencies or perform FX conversion.
- CLEAN documents require readable object bytes/metadata, exact SHA-256 and authoritative size. Missing, mismatched or unverifiable objects fail closed. Orphans never become evidence and are neither attached nor deleted by the checker.
- Review SCANNING claims, leases/retries and PENDING/PROCESSING/FAILED outbox states. The checker does not claim, complete, retry, dispatch or clear them. Duplicate notification risk is not financial authority.
- Reconcile restored identities and current external authority. Require reauthentication; generation fencing keeps old sessions and action credentials unusable.

## Prohibited actions

Never manually mark PAID; insert Payment, ledger, commitment, Approval or Finance Control PASS records; mark a document CLEAN; grant privileged roles to `aims_app`; disable segregation of duties; edit historical migrations; delete audit history; reset recovery generation backwards; or fabricate external payment evidence. The checker performs no repair, audit insert, outbox enqueue, AI call, Telegram call, provider backup call or generation advance.

## External ownership gates

No numeric RPO, RTO or retention target is approved. Record the selected and latest recoverable points, observed data-loss-window evidence, actual restore duration and any externally approved targets. P13 owns managed database selection, backup/PITR deployment, object versioning/backup, network/TLS, secret provider, monitoring and deployment infrastructure.

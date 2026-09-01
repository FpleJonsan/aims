# P12 Recovery Generation Fencing

Status: prerequisite PASS / FROZEN after five-discipline read-only review. This is the narrow P12
restore-boundary prerequisite only. It does not resume general P12 implementation
or select a backup, PITR, storage, or recovery provider.

## State classification

| Persisted state | Classification | Reason |
| --- | --- | --- |
| `aims_sessions` | GENERATION_BOUND; INVALIDATE_ON_GENERATION_ADVANCE | Bearer session authority must not resurrect after restore. |
| `approval_action_tokens` | GENERATION_BOUND; INVALIDATE_ON_GENERATION_ADVANCE | One-time Approval transport credentials can authorize a later human action. Current Approval authority is still independently revalidated. |
| `telegram_pending_interactions` | GENERATION_BOUND; INVALIDATE_ON_GENERATION_ADVANCE | A pending reply can complete a previously initiated Approval interaction. |
| Telegram binding challenges in `audit_events.safe_metadata` | GENERATION_BOUND | The challenge is one-time ephemeral authority; the audit event remains immutable history. |
| `notification_outbox` PROCESSING claims | GENERATION_BOUND; INVALIDATE_ON_GENERATION_ADVANCE | Delivery is not business authority, but an old process must not finalize a restored claim. |
| `payment_documents` scan claims | GENERATION_BOUND; INVALIDATE_ON_GENERATION_ADVANCE | A trusted worker claim can change evidence trust state and was the proven restore defect. |
| Telegram webhook update rows | ALREADY_SAFE_WITH_EXISTING_SEMANTICS | They are bounded idempotency/processing records, not business authority; every actionable credential they carry is fenced and current authority is rechecked. |
| Telegram identity bindings and external identity mappings | HISTORICAL_ONLY / NO EPHEMERAL AUTHORITY | They represent identity relationships. Current user, binding status, credential generation, and business authority remain mandatory. |
| Payments, idempotency identity, ledger, commitments, budgets, Finance Context, Policy decisions, Approval/Finance Control history, document hashes and audit history | HISTORICAL_ONLY / AUTHORITATIVE | These are durable business truth and must survive recovery unchanged. |
| Redis, scheduler, in-memory nonce/claim state | NOT APPLICABLE | AIMS does not use these as persisted authority. |

## Model and serialization

Migration 059 creates one PostgreSQL-owned singleton with a unique opaque UUID
and a strictly increasing sequence. An append-only event table records each
generation, bounded reason, correlation UUID, and timestamp. Migration creates
generation 1 and invalidates active pre-059 ephemeral authority without treating
deployment as a recovery incident.

`advance_aims_recovery_generation(text, uuid)` is a fixed-search-path,
`SECURITY DEFINER` capability owned by `aims_owner`, executable only by
`aims_migrator`. PUBLIC and all runtime/executor roles are denied. The command is
intentionally non-idempotent: every successful call advances to a new UUID and
sequence. Reusing a correlation UUID is rejected, giving operators an explicit
duplicate-command signal and durable evidence.

Consumers and the advance operation share the fixed transaction advisory lock
`aims:recovery-generation`; database triggers/functions also lock the singleton.
Consequently a credential mutation either commits wholly before advance or is
denied against the new generation. Client, API, worker, webhook, headers, token
payloads, environment variables, and process caches cannot select the trusted
generation.

## Recovery ordering

After restoring a backup containing generation G, keep API and workers stopped.
Using the controlled migrator connection, execute the advance function exactly
once with a bounded incident reason and new correlation UUID. Verify the returned
generation differs from G, the sequence increased, and exactly one matching event
exists. Only then may API and worker traffic resume. A later restore repeats the
same operation, producing G2, G3, and so on.

Migration 059 itself is not a DR event. Fresh bootstrap 001–059 creates a valid
initial generation. Upgrade 058→059 safely revokes sessions and active action
credentials and releases active claims for current-generation reissue/reclaim.

General restore checking, manifests, reconciliation reports, full DR runbooks,
provider configuration, RPO/RTO/retention decisions, and restore rehearsals remain
outside this correction and require separate authorization.

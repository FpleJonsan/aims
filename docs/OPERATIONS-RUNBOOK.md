# AIMS Operator Runbook

## Start and readiness

1. Provision PostgreSQL and restricted application, Finance executor, and Payment executor logins.
2. Load secrets through the deployment secret manager; never bake `.env` into an image.
3. Apply migrations in lexical order with `ON_ERROR_STOP=1` using the migration administrator.
4. Start the API with `npm run build --workspace @aims/api` then `npm start --workspace @aims/api`.
5. Start the web application after `npm run build`.
6. Probe `/health/live` for process liveness and `/health/ready` for PostgreSQL, executor, storage, AI, and Telegram configuration state. AI/Telegram disabled is healthy; an enabled but incomplete integration is not ready.

Production startup requires trusted identity and both executor database URLs. The repository intentionally refuses local document storage in production. OpenAPI is disabled in production.

## Migrations

- Back up PostgreSQL before deployment.
- Apply forward migrations only and never edit already-deployed migration files.
- Use an isolated empty database to test the complete chain before release.
- Run migrations with an administrator unavailable to the runtime API.
- Stop deployment on the first error. Do not mark an incomplete migration as applied.
- A baseline/squash may be evaluated later for release ergonomics; keep the immutable chain and checksum record. No squash has been performed.

## AI operations

- `AI_MASTER` and feature switches are authoritative database configuration.
- AI OFF needs no provider key and leaves manual Validation/Financial Analysis, deterministic Policy, Approval, Finance Control, Payment, and Dashboard operational.
- AI ON also requires a server-side provider key. Check failed immutable AI runs and usage events; do not replay a stale result into a changed request.
- Rotate the provider key in the secret manager, restart instances, run only the explicit live smoke tests, then revoke the old key.
- Provider failure is not a reason to bypass a mandatory business stage.

## Telegram operations

- Keep `TELEGRAM_APPROVAL_ENABLED=false` unless the channel is intentionally deployed.
- When enabled, configure bot token, independent webhook/callback secrets, and HTTPS webhook URL. Strip untrusted copies of the Telegram secret header at the edge.
- Register the webhook with the current secret, verify delivery, then enable dispatch.
- Rotate by installing new secrets, re-registering the webhook, restarting workers/API, and invalidating old callback tokens.
- Web approval remains available when Telegram is disabled or unavailable.

## Outbox recovery

Inspect `notification_outbox` for `FAILED` and old `PROCESSING` rows. Claims older than `OUTBOX_PROCESSING_LEASE_SECONDS` are reclaimable. A worker must claim with its token, deliver, and complete only its own claim. The integration suite proves crash/lease-expiry/reclaim and duplicate tolerance. Investigate permanent 4xx responses before manual retry.

## Payment recovery

- Never insert directly into `payments` or `financial_ledger_entries`.
- Retry the same domain command with the same `commandKey` after a timeout or lost response.
- A matching replay returns the original payment; a changed payload is an idempotency conflict.
- Confirm request `PAID`, one payment, one consumed commitment, and one actual ledger entry before deciding whether recovery is needed.
- Serialization retry exhaustion (`40001`) is an operational alert; retain the correlation and command IDs.

## Documents

Local storage is only for synthetic local/demo files and is non-recoverable by design unless the operator separately backs it up. Production requires an S3-compatible versioned bucket, encryption, blocked public access, lifecycle policy, malware quarantine/scan/promotion, and a tested backup/replication strategy.

Restore order is PostgreSQL first, object versions second, then API/workers, and web last. Validate database-to-object hashes before reopening mutations.

## Backup and credential recovery

- PostgreSQL: scheduled encrypted backups, point-in-time recovery where supported, retention policy, off-host copy, and restore rehearsal.
- Object storage: versioning, retention/lifecycle, replication or provider backup, and restore test.
- Restore secrets from the secret manager; never from logs or database audit metadata.
- Rotate normal DB, Finance executor, and Payment executor credentials independently and verify role membership remains least-privilege.
- Restore does not count as tested until a documented rehearsal validates financial reconciliation and sample document hashes.

## Operational signals

Alert on request 5xx failures, database connectivity, `40001` exhaustion, failed AI runs, provider latency, outbox age/failures, Telegram failures, Finance Control failures, and Payment recording failures. Include correlation IDs, entity IDs, safe failure classifications, and latency; exclude prompts, documents, credentials, payment details, and bank references.


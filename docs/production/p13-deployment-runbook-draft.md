# AIMS P13 Provider-Neutral Deployment Runbook — Draft

This is a non-executable draft. It contains no credentials, provider commands,
real hostnames, approved thresholds or authority to deploy.

## Preconditions

1. Approved change, release, security, DBA and Finance owners are recorded.
2. The immutable artifact passed staging, P14 security, P15 load and P16 UAT.
3. Target environment identity, database, storage, scanner, secrets, network,
   observability and recovery services are isolated and approved.
4. AI and Telegram are OFF unless separately approved; initial launch keeps both
   OFF.
5. Target database identity, current schema and expected release are verified.
6. Approved PostgreSQL checkpoint/PITR and object recovery points exist and are
   protected. This is not a claim that recovery has been proven.
7. Maintenance/zero-downtime strategy and rollback authority are explicit.

## Deployment sequence

1. Freeze and identify the artifact by immutable digest, Git SHA, runtime and
   expected schema.
2. Retrieve secrets using the deployment workload identity; do not write a
   Production `.env` file or expose values in output.
3. Validate host/origin/TLS, critical provider config and distinct database
   runtime identities before starting any service.
4. Confirm the private target database, TLS `verify-full`, backup checkpoint and
   migration lock/change approval.
5. Run the one-shot migration job as `aims_migrator`; use controlled `SET ROLE
   aims_owner`; apply only reviewed forward migrations.
6. Run post-migration hardening and the exact P6 privilege manifest. Stop on any
   drift. Do not grant the API or worker migration authority.
7. Start or replace the API with traffic disabled. Verify liveness, readiness,
   schema, distinct pools, storage/scanner capability and release identity.
8. Start or replace the worker. Verify liveness/readiness, dedicated document
   role, lease-safe polling, scanner/storage access and backlog visibility.
9. Start/verify the web artifact and its server/client API routing. Validate
   HTTPS, host, cookie, Origin/CSRF, headers and deep routes.
10. Execute read-only smoke tests for authentication, Requester access, Finance
    authorization boundaries, upload quarantine, and health/telemetry. Do not
    create a real external payment merely as a deployment probe.
11. Human approvers review evidence and enable traffic.
12. Observe API/worker/DB/storage/scanner signals and P11 evaluator behavior for
    the approved period. Record the deployment evidence bundle.

## Stop and failure rules

- **Migration fails:** stop. Preserve error/checkpoint evidence. Do not edit
  schema history or improvise a reverse migration. Obtain DBA-reviewed forward
  fix authority.
- **Migration succeeds but application fails:** keep or restore a compatible
  prior application artifact if proven compatible. Otherwise disable traffic
  and forward-fix. Never roll back financial records.
- **Readiness fails:** do not enable traffic. Liveness must remain independent of
  optional providers that are OFF.
- **Worker fails:** keep untrusted work queued, stop/restart under supervision,
  and rely on database lease recovery. The worker gains no financial authority.
- **Storage/scanner fails:** quarantine remains untrusted; no CLEAN promotion.
- **Database failover:** gate API/worker through readiness, then verify TLS,
  schema and P6 role/privilege state before normal operation.
- **Secret retrieval fails:** fail closed; never substitute local/default values.

## Rollback boundaries

- Application artifact rollback: permitted only with schema compatibility and
  approved authority.
- Database schema rollback: not presumed safe; use forward fix.
- Financial rollback: prohibited as a deployment technique.
- Data recovery: invokes the separate P12 frozen-service, generation,
  reconciliation and human-resume process—not this runbook.

## Authoritative P12 recovery order

1. Restore PostgreSQL and the required exact object state into an isolated
   environment; keep application services and outbound integrations frozen.
2. Use the separately authorized privileged mechanism to advance the recovery
   generation, fencing stale sessions, Approval/Telegram authority and
   worker/outbox claims from the restored generation.
3. Verify that generation advancement succeeded.
4. Run the read-only P12 checker with a manifest bound to the current generation.
   The checker does not advance generation or repair state.
5. Finance manually reconciles external payment reality. A bank transfer absent
   from the restored database is never inferred or fabricated by AIMS.
6. Reconcile current organizational identity and authority against the restored
   historical state.
7. Obtain Finance, Security and SRE/Incident Commander human approval.
8. Resume services and outbound integrations in the approved order.

## Incident operation

The platform must allow optional integrations to remain disabled, workers to
drain/stop safely, and traffic or Payment operations to be stopped by authorized
operators while preserving read access and audit evidence. Infrastructure
operators do not receive Finance Control or Payment authority.

## Post-deployment record

Capture artifact digest, Git SHA, schema/migration, P6 proof identifier,
deployment/change identifier, timestamps, environment, health/smoke results,
backup checkpoint references and human approvals. Store only bounded references;
never copy credentials, financial values, bank references or document content.

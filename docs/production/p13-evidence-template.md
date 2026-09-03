# AIMS P13 Deployment Evidence Template

This template defines future evidence. Blank fields are **NOT VERIFIED**, not
PASS. Record bounded identifiers only—never credentials, tokens, connection
strings, document data, bank references or raw provider responses.

## Release

- Environment:
- Artifact digest:
- Git SHA/tag:
- Build/runtime version:
- Expected schema/migration:
- Staging acceptance reference:
- Change approval reference:

## TLS, ingress and network

- Browser-to-ingress TLS/certificate proof:
- HTTP-to-HTTPS and Host-validation proof:
- Security-header policy proof:
- Proxy trust/client scheme proof:
- Private API/worker/DB/storage/scanner network proof:
- Deny-by-default/egress review reference:

## PostgreSQL and migration

- Provider/version/HA compatibility proof:
- DB TLS `verify-full` proof:
- Private exposure proof:
- Pre-migration checkpoint reference:
- Migrator identity and one-shot execution reference:
- Applied schema/migration:
- P6 exact role/ownership/default-ACL/function-grant proof:
- Runtime DDL-denial proof:
- Pool/connection budget proof:

## Identity, session and secrets

- Corporate/test IdP issuer/audience/subject proof:
- Local/competition identity rejection proof:
- Secure/HttpOnly/SameSite/Path cookie proof:
- Origin/CSRF/proxy-TLS proof:
- Secret-backend workload identity proof:
- Least-privilege, rotation, audit and break-glass references:
- Confirmation that no Production `.env` is stored on disk:

## Storage and scanner

- Private access/public-block proof:
- Encryption and versioning/exact-version proof:
- Metadata/hash/cancellation proof:
- Recovery-version retrieval proof:
- Scanner provider/verdict/timeout/health proof:
- QUARANTINED-to-CLEAN fail-closed lifecycle proof:
- Temporary-disk bounds and cleanup proof:
- `AIMS_ENVIRONMENT=staging` plus local storage rejection proof:
- `AIMS_ENVIRONMENT=production` plus local storage rejection proof:
- Staging plus deterministic scanner rejection proof:
- Production plus deterministic scanner rejection proof:
- Protected recovery CLI plus local fallback rejection proof:
- Protected worker plus unsafe-provider rejection proof:
- Explicitly approved provider construction-success proof:

## Processes and health

- Web supervision/start/stop proof:
- API supervision/graceful shutdown proof:
- Worker supervision/lease-safe restart proof:
- Migration job isolation proof:
- API live/ready proof:
- Worker live/ready proof:
- Release identity in health/logs proof:
- Multi-instance worker proof:

## Observability and alerting

- Structured-log collection/redaction/access proof:
- Metric collection/private access proof:
- Correlation/deployment metadata proof:
- P11 evaluator/grouping/no-data proof:
- Approved routing/on-call proof:
- Retention decision reference:

## Backup, PITR and DR

- PostgreSQL backup/WAL/PITR status proof:
- Backup encryption/immutability/isolation proof:
- Object version backup/recovery proof:
- Recovery key availability proof:
- Approved RPO/RTO reference:
- Restored environment frozen-services proof:
- Privileged recovery-generation advancement proof:
- Current-generation verification proof:
- P12 bound manifest/checker result reference:
- External-payment reconciliation reference:
- Current identity/authority reconciliation reference:
- Isolated restore/rehearsal evidence:
- Finance/Security/SRE human recovery approval reference:
- Ordered-resume evidence:

## Deployment result

- Readiness result:
- Smoke-test result:
- Traffic-enable approval:
- Observation window reference:
- Rollback/forward-fix decision if applicable:
- Open exceptions and expiry/owner:
- Final outcome: NOT VERIFIED / PASS / FAIL

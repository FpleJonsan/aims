# AIMS Secrets and Credential Management Foundation

## Status and boundary

P5 establishes a provider-independent boundary. AIMS accepts secrets only through controlled server-process runtime injection. It does not select a Production secret manager, persist infrastructure secrets in the business database, expose a secret-management UI, or implement home-grown encryption. Production deployment remains blocked until Security and Platform approve the injection mechanism and custodians provision required values.

`process.env` is the current injection transport, not the system of record. `production-config.ts` validates deployment-critical values before API startup. `secret-boundary.ts` catalogues server-only names and supplies common redaction. Business objects receive capabilities or provider adapters, never a secret catalogue.

## Inventory and classification

No values are recorded here.

| Logical secret | Class and consumer | Allowed environments | Owner / custodian | Rotation behaviour | Logs/audit |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | Restricted; API database pool | local, competition, test; future hosted | Platform / DBA | New connection; restart required | Never |
| `FINANCE_DATABASE_URL` | Highly restricted; Finance executor pool | local, competition, test; future hosted | Platform / Finance Security | Rotate independently; restart required | Never |
| `PAYMENT_DATABASE_URL` | Highly restricted; Payment executor pool | local, competition, test; future hosted | Platform / Payment Security | Rotate independently; restart required | Never |
| `DOCUMENT_WORKER_DATABASE_URL` | Highly restricted; document-worker pool only | local/test; future hosted | Platform / Document Security | Rotate independently; restart worker required | Never |
| Migration/admin credential | Privileged; migration operator only | separately authorised environment | DBA | Operational runbook | Never; unavailable to runtime |
| `OPENAI_API_KEY` | Restricted; server AI adapter | local live opt-in; future approved hosted | AI Platform / Security | Restart required | Never |
| Telegram bot/webhook/callback secrets | Restricted; server channel adapter | approved environments when enabled | Integration / Security | Coordinated provider rotation; restart required | Never |
| Future OIDC client secret | Restricted; future IdP adapter | future staging/Production | Identity / Security | Not implemented | Never |
| Future storage/scanner credentials | Restricted; future private adapters | future staging/Production | Platform / Document Security | Not implemented | Never |

Opaque local sessions use random database-backed session and CSRF tokens. There is no global signing secret, so P5 does not invent one. Competition identity configuration and the deterministic local scanner are not valid Production credentials. BYOK is not implemented; tenant-provided keys require a separately approved encrypted-storage and access design.

## Environment and startup contract

- Local/test may use ignored `.env` injection with non-Production credentials. `.env.example` contains placeholders only.
- Competition retains its isolated database and identity catalogue. Production rejects competition identity mode and cannot use it as fallback.
- Staging remains fail closed until an approved test IdP and injection path exist.
- Production requires separate runtime, Finance executor, and Payment executor database credentials, private object storage, a provider malware scanner, and corporate authentication. Missing, malformed, or placeholder database credentials abort startup.
- AI OFF requires no provider secret; AI ON requires it. Disabled Telegram requires no channel secrets; enabled Telegram requires all secrets and a Production HTTPS webhook.
- Browser-public configuration is limited to `NEXT_PUBLIC_AIMS_API_URL` and `NEXT_PUBLIC_AIMS_LOGOUT_URL`. Both are URLs, never credentials.

Diagnostics and readiness may report only `configured`, `not configured`, `ready`, or `disabled`. They must not report values, fingerprints, connection strings, headers, or environment dumps.

## Isolation and redaction

The operational exception boundary redacts expected HTTP error messages and returns a generic unexpected-error response. Logs contain request metadata only. `redactSensitiveData` is the safe-copy primitive for future structured logs/audit metadata containing provider errors. Audit may identify an integration, action, outcome, actor, correlation ID and safe failure code; raw or old/new secret values are forbidden.

Technical ADMIN, Finance users, Requesters and business authority grants do not confer infrastructure-secret access. Executor credentials are selected by server wiring, never a role or request field. Migration credentials remain outside application runtime configuration.

## Rotation readiness

Automatic and zero-downtime rotation are not implemented.

Database rotation: create a replacement restricted login, verify least-privilege grants, inject it into a replacement instance, establish new pools, verify readiness and business smoke tests, drain old connections, then revoke the old login. Runtime, Finance and Payment credentials rotate independently.

Provider rotation: create a replacement credential, inject it into a replacement instance, perform a bounded health or explicitly opted-in live test without logging the value, switch traffic, then revoke the old credential. Telegram webhook/callback overlap is future work.

Session revocation is separate from infrastructure rotation. Revoke sessions only when identity/session trust is affected.

## Compromise response

1. Contain or disable the affected integration.
2. Record logical name, environment, custodian, discovery time and service—never the value.
3. Revoke or rotate through its owner/provider.
4. Redeploy using controlled runtime injection and verify readiness.
5. Review access and provider/application/audit evidence without copying the value into tickets.
6. Confirm the old credential is unusable and retain only safe incident metadata.

## Production handoff

Security/Platform must still select the Production secret provider or orchestrator integration, define workload access and audit/alerting, approve rotation procedures, and prove that values are runtime-injected rather than placed in image layers, build arguments, source, frontend bundles, logs, or persistent volumes. That deployment decision is outside P5.

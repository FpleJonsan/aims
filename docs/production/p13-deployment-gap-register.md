# AIMS P13 Deployment Gap Register

Severity describes risk if deployed to Production now. Missing provider/company
decisions are deployment gaps, not automatically application vulnerabilities.

| ID | Severity | Category | Current | Required | Code? | Migration? | Provider? | Company? | Phase | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P13-G01 | HIGH | Application / Identity | Production and staging intentionally fail startup; local session only | Approved corporate/test IdP adapter preserving AIMS authority | YES | NO | YES | YES | P13/P17 | `production-config.ts`, `auth-environment.ts` |
| P13-G02 | HIGH | Provider integration / Storage | API, worker and recovery CLI have no staging/Production object-storage adapter | Implement the selected approved private, versioned object provider across required entry points | YES | NO | YES | YES | P13 | `app.module.ts`, `worker-main.ts`, `recovery-check-main.ts` |
| P13-G03 | HIGH | Provider integration / Scanner | Deterministic scanner only; no staging/Production provider adapter | Implement selected approved scanner with bounded cancellation and verdict mapping | YES | NO | YES | YES | P13 | `worker-config.ts`, `app.module.ts` |
| P13-G04 | HIGH | Infrastructure / Deployment | No Production artifact/container/process definition or CI/CD | Immutable reproducible artifact and supervised web/API/worker/migration units | YES | NO | YES | YES | P13/P17 | package scripts; no deployment definition |
| P13-G05 | HIGH | Infrastructure / PostgreSQL | Provider not selected/configured | Private compatible HA PostgreSQL, verify-full TLS, monitoring, backup/PITR | NO | NO | YES | YES | P13/P17 | P6 proof and config validation |
| P13-G06 | HIGH | Infrastructure / Secrets | Validation/redaction exists; local scripts load `.env` | Approved runtime secret retrieval/injection, rotation/audit/break-glass | MAYBE | NO | YES | YES | P13/P17 | scripts and P5 boundary |
| P13-G07 | HIGH | Network / TLS | No deployed ingress, DNS, trusted proxy or private-network policy | TLS ingress, host/origin/proxy validation, private DB/storage/scanner, egress policy | YES | NO | YES | YES | P13/P17 | `main.ts`; repository has no edge definition |
| P13-G08 | MEDIUM | Backend / Shutdown | Worker has bounded shutdown; API does not enable Nest shutdown hooks | API drains/closes pools on SIGTERM within platform deadline | YES | NO | NO | NO | P13 | `main.ts`, `Postgres.onModuleDestroy()` |
| P13-G09 | MEDIUM | Frontend / Config | Browser URL configurable; SSR API URL fixed to localhost | Explicit hosted server/client API routing compatible with immutable promotion | YES | NO | NO | YES | P13 | `app/lib/api-client.ts` |
| P13-G10 | MEDIUM | Health / Readiness | API readiness checks driver strings, not provider capability; worker management binds loopback | Provider-aware readiness and platform-reachable private probes | YES | NO | YES | NO | P13 | `health.service.ts`, `worker-health-server.ts` |
| P13-G11 | MEDIUM | Backend / Proxy | CORS exists; trusted proxy/client-IP/forwarded-proto policy absent | Explicit proxy trust and Secure-cookie/scheme behavior behind approved ingress | YES | NO | YES | YES | P13 | `main.ts`, `session.service.ts` |
| P13-G12 | HIGH | Observability / Alerting | P10/P11 application foundation only | Central collection, evaluator, routing, access and retention | MAYBE | NO | YES | YES | P13/P17 | P10/P11 docs and metrics endpoints |
| P13-G13 | HIGH | Recovery | P12 checker/runbook exists; no actual backup/PITR/object recovery service | Protected encrypted DB WAL/PITR and exact object-version recovery with rehearsal | NO | NO | YES | YES | P13/P18 | P12 documents |
| P13-G14 | MEDIUM | Release identity | Logs/health do not consistently expose immutable release/SHA | Bounded release identity in build and operational evidence | YES | NO | NO | YES | P13 | health/telemetry sources |
| P13-G15 | MEDIUM | Supply chain | Lockfile exists; no CI dependency/image scan, SBOM or immutable base process | Reproducible install and gated dependency/artifact scanning | YES | NO | YES | YES | P13/P14/P17 | lockfile; no CI workflow |
| P13-G16 | MEDIUM | Rate/resource controls | DTO/upload/export bounds exist; no deployed edge rate policy | Owned, measured auth/upload/webhook/general limits | MAYBE | NO | YES | YES | P13/P15 | ingress absent; P15 owns values |
| P13-G17 | MEDIUM | Database pools | Pool maxima are fixed 10/5/5 and worker 2 | Environment-configurable provider-compatible budgets proven by load | YES | NO | YES | YES | P13/P15 | `postgres.ts`, `worker-main.ts` |
| P13-G18 | HIGH | Environment | No isolated staging environment or parity evidence | Separate staging DB, identity, secrets, storage, scanner, network and telemetry | NO | NO | YES | YES | P17 | config correctly rejects missing staging identity |
| P13-G19 | HIGH | Security evidence | Strong tests; no Production red-team/platform test | P14 attack review against deployment candidate | NO | NO | NO | YES | P14 | roadmap |
| P13-G20 | MEDIUM | Capacity evidence | Correctness/concurrency tests, no Production load profile | P15 workload model, saturation/pool/backlog evidence | NO | NO | NO | YES | P15 | roadmap |
| P13-G21 | HIGH | Finance acceptance | Synthetic UAT only | Finance stakeholder UAT with approved staging authority/data | NO | NO | NO | YES | P16 | UAT suite |
| P13-G22 | HIGH | Release rehearsal | No staging-to-Production deployment/rollback/DR rehearsal | Immutable RC promotion and controlled rehearsal evidence | NO | NO | YES | YES | P17/P18 | roadmap |
| P13-G23 | HIGH | Go-live governance | No approved access/change/on-call/RPO/RTO/retention decisions | Signed Production-readiness and go-live approvals | NO | NO | NO | YES | P19/P20 | decision register |
| P13-G24 | LOW | API security headers | Basic headers exist; CSP/HSTS ownership unresolved | Approved edge/application header policy without duplicate conflict | MAYBE | NO | YES | YES | P13/P14 | `main.ts` |
| P13-G25 | HIGH | Application / Protected environments | Protection is fragmented across executable paths and `NODE_ENV`/`AIMS_ENVIRONMENT`; worker has partial Production checks, construction is local-bound, and recovery CLI can select local storage outside the main validator | Every staging/Production API, worker, recovery and provider-constructing entry point rejects local/fake/test adapters unless explicitly approved | YES | NO | YES | YES | P13 | `production-config.ts`, `worker-config.ts`, `worker-main.ts`, `recovery-check-main.ts`, local storage/scanner constructors |

## Risk totals

- Critical: 0
- High: 15
- Medium: 9
- Low: 1
- Informational: provider-specific numeric sizing and implementation details remain
  intentionally open.

These are blockers or work items for future deployment, not regressions in the
frozen financial workflow. No architectural blocker was found.

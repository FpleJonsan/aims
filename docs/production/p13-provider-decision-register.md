# AIMS P13 Provider and Company Decision Register

No row records a Company decision unless it is already frozen. Recommendations
are provider-neutral and do not authorize procurement or configuration.

## Provider decisions

| ID | Decision | Options | Recommendation | Owner | Blocking phase | Application can proceed first? |
| --- | --- | --- | --- | --- | --- | --- |
| P13-D01 | Hosting/deployment platform | Company managed app platform, containers on managed compute, controlled VMs | Use the simplest Company-standard supervised platform supporting private networking, immutable artifacts and separate web/API/worker/job units; do not introduce Kubernetes without evidence | Platform / IT | P13/P17 | Provider-neutral packaging can proceed |
| P13-D02 | PostgreSQL service | Approved managed service or operated cluster | Prefer managed HA PostgreSQL if P6 role/function/trigger/TLS requirements pass compatibility proof | DBA / Platform | P13/P17 | Compatibility harness/docs can proceed |
| P13-D03 | Production and staging object storage | AWS is the primary Company platform; Amazon S3 is the current target candidate | TARGET / PENDING IMPLEMENTATION. Credentials, account, bucket, region, IAM, KMS, private networking, audit, retention and recovery configuration are unavailable or unapproved; no adapter is implemented | Platform / Security / Finance data owner | P13/P17 | Local development continues through the provider-neutral contract; protected environments remain fail closed |
| P13-D04 | Production and staging malware scanner | Managed scanning API, isolated approved engine, Company service; staging equivalent remains Company-dependent | UNDECIDED. Select only after privacy, verdict, timeout, throughput and operational ownership approval | Security / Platform | P13/P17 | Fail-closed construction can proceed before selection |
| P13-D05 | Secret backend | Platform-native secret store or approved Vault | Runtime identity retrieval/injection with audit and rotation; no Production `.env` on disk | Security / Platform | P13/P17 | Config contract can proceed |
| P13-D06 | Identity provider | Corporate OIDC/approved identity-aware edge | P13.2 provider-neutral initiation, verification, exact mapping and opaque-session boundary is implemented; external claims never grant Finance authority. Provider/tenant/registration remain undecided | Company IT / Security | P13/P17 | Foundation complete; staging remains fail closed until approved integration |
| P13-D07 | Observability stack | Company log/metric platform and collector | Reuse Company platform; keep P10 dimensions and P11 catalogue provider-neutral | SRE / Security | P13/P17 | Export/metadata hardening can proceed |
| P13-D08 | Alert evaluator/routing | Company incident platform, email, chat or paging service | Company on-call tooling; evaluator must implement P11 grouping/no-data/disabled semantics | SRE / Operations | P13/P17 | Specification stays usable |
| P13-D09 | Edge/DNS/TLS | Company ingress/CDN/load balancer | Prefer one HTTPS product origin and private API/management routes | Platform / Security | P13/P17 | Host/proxy config hardening can proceed |
| P13-D10 | Backup/PITR implementation | PostgreSQL-native managed backup/WAL plus object version recovery | Use provider mechanisms that produce P12-bound recovery evidence and isolated restore access | DBA / SRE / Security | P13/P18 | Runbook/evidence integration can proceed |

## P13.3 deferred Production gates

| ID | Status | Blocking fact | Development effect |
| --- | --- | --- | --- |
| P13-STORAGE-AWS | OPEN — PRODUCTION BLOCKER | Amazon S3 is the target candidate, but credentials and approved Company account/bucket/region configuration are not available; the Production adapter is not implemented | Does not block local/test use of the provider-neutral version-aware adapter |
| P13-STORAGE-INFRA | OPEN — PRODUCTION BLOCKER | Bucket versioning, encryption/KMS, IAM, private networking, audit, retention/legal hold and exact-version recovery remain unconfigured and unapproved | Does not weaken Migration 061 or protected-environment rejection |
| P13-SCANNER | OPEN — PRODUCTION BLOCKER | Production malware-scanner provider, privacy/residency position and configuration remain undecided | Development/test may use the deterministic scanner only through the canonical P7 worker |

## Company decisions

| ID | Decision | Required owner | Blocking phase |
| --- | --- | --- | --- |
| P13-C01 | Approved regions and data residency for database, objects, backups and future AI | Legal / Privacy / Security / Finance data owner | P13 provider selection |
| P13-C02 | RPO and RTO by business workflow | Finance owner / Business continuity / SRE | P18/P19 |
| P13-C03 | Retention/legal hold for financial records, documents, audit, logs, backups and security events | Legal / Finance data owner / Privacy | P17-P19 |
| P13-C04 | Production v1 zero-downtime requirement | Product / SRE / Finance Operations | P13/P15/P18 |
| P13-C05 | Deployment, migration, rollback and emergency approvers | Engineering / DBA / Security / Finance | P17-P20 |
| P13-C06 | Production access and break-glass ownership | Security / Platform / DBA / Finance | P13/P19 |
| P13-C07 | On-call coverage, response objectives and notification channel | Operations / SRE / Security / Finance | P17/P19 |
| P13-C08 | Capacity forecast and peak workload | Finance product owner / Operations | P15 |
| P13-C09 | Production bootstrap/historical data source and reconciliation | Finance systems owner / Data owner | P16-P18 |
| P13-C10 | Whether AI may ever be enabled and what data may leave AIMS | AI Governance / Legal / Privacy / Finance | Future enablement; not launch blocker |
| P13-C11 | Whether Telegram may ever be enabled | Finance product owner / Security / Privacy | Future enablement; not launch blocker |
| P13-C12 | Security-header/CSP policy and rate-limit ownership | Application Security / Platform | P13/P14/P15 |

## Frozen decisions

- Preserve the modular monolith and PostgreSQL financial authority.
- Deploy API and PostgreSQL-backed worker as independently supervised processes.
- Redis, a scheduler, microservices and Kubernetes are not required for v1.
- AI and Telegram remain OFF for initial Production.
- Local identity, local storage, deterministic scanning and fake/test providers
  are rejected in staging and Production. P13.1/P13.2 enforce this boundary;
  approved real providers and deployment evidence remain external gates.
- The same immutable release artifact is promoted from staging to Production.

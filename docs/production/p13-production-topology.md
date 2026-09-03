# AIMS P13 Provider-Neutral Production Topology

This is a decision model, not deployed infrastructure. Provider names, domains,
regions, replicas and numeric capacity are intentionally unresolved.

## Request and API path

```mermaid
flowchart LR
  U[External user] -->|HTTPS| I[TLS ingress / reverse proxy]
  I --> W[Vinext web process]
  W -->|private HTTP or same-origin routed API| A[NestJS API process]
  I -. approved API route .-> A
  A -->|TLS verify-full / aims_app| P[(Private PostgreSQL)]
  A -->|TLS verify-full / Finance runtime| P
  A -->|TLS verify-full / Payment runtime| P
  A -->|private TLS| O[Private object storage]
```

Only ingress is public. Prefer a same-origin product surface; use a distinct API
hostname only if the chosen platform requires it and cookie/Origin/CORS policy is
explicitly verified. Health and metrics are management surfaces, not public
product endpoints.

## Worker and document path

```mermaid
flowchart LR
  A[API upload] -->|QUARANTINED object| O[Private versioned storage]
  A -->|UNVERIFIED metadata| P[(PostgreSQL)]
  K[Supervised worker] -->|TLS / document-worker runtime| P
  K -->|bounded read| O
  K -->|bounded private TLS| S[Approved malware scanner]
  K -->|verdict through DB function| P
  P -->|CLEAN only| E[Trusted evidence boundary]
  K -. only when enabled .-> T[Telegram API]
```

The worker may scale horizontally because database leases serialize claims.
Redis and a scheduler are not required. Transfer or scanner success alone never
grants trust; PostgreSQL remains authoritative.

## Database trust and deployment path

```mermaid
flowchart TB
  D[Approved deployer] --> J[One-shot migration job]
  V[Secret backend] -->|migrator credential| J
  J -->|TLS as aims_migrator| P[(PostgreSQL)]
  J -->|controlled SET ROLE| O[aims_owner]
  O --> M[Forward-only migrations]
  M --> H[P6 hardening + privilege manifest proof]
  H --> A[Start/replace API]
  H --> K[Start/replace worker]
  A --> R[Readiness and smoke evidence]
  K --> R
  R --> G[Human traffic-enable decision]
```

`aims_owner` and executor roles remain NOLOGIN. Runtime roles cannot perform
migrations. Infrastructure administrators receive no AIMS Finance authority.

## Network trust zones

| Zone | Inbound | Outbound | Public? |
| --- | --- | --- | --- |
| Public ingress | 443; 80 redirect only | Web/API private endpoints | Yes |
| Web/application | Ingress only | API, telemetry | No |
| API | Ingress/web only | PostgreSQL, storage, scanner, IdP, telemetry; AI/Telegram only when enabled | No |
| Worker | Supervisor/management only | PostgreSQL, storage, scanner, telemetry; Telegram only when enabled | No |
| Database | API, worker and migration network identities | Backup/monitoring service | No |
| Management/deployment | Approved CI/deploy/DBA operators | platform, migration, evidence stores | No |

Use deny-by-default network and egress policy where supported. Exact addresses,
firewall products and ports beyond HTTPS/PostgreSQL are provider decisions.

## Observability path

```mermaid
flowchart LR
  A[API stdout / metrics / health] --> C[Private collector]
  W[Worker stdout / metrics / health] --> C
  P[(PostgreSQL service metrics)] --> C
  O[Storage/scanner service metrics] --> C
  C --> E[P11 evaluator]
  E --> R[Approved routing provider]
  R --> H[Human responders]
```

Telemetry is non-authoritative and must contain no secrets, bank references,
document content or unbounded identifiers. Alerts request human attention and
cannot mutate AIMS.

## Disaster-recovery path

```mermaid
flowchart LR
  PB[Protected PostgreSQL backup + WAL] --> IDB[(Isolated restored DB)]
  OB[Versioned object recovery] --> IOS[Isolated restored objects]
  IDB --> F[Keep all services and outbound integrations frozen]
  IOS --> F
  F --> G[Privileged recovery-generation advancement]
  G --> V[Verify current recovery generation]
  RM[Manifest bound to current generation] --> C[P12 read-only checker]
  V --> C
  C --> X[External-payment reconciliation]
  C --> A[Current identity and authority reconciliation]
  X --> H[Finance / Security / SRE human approval]
  A --> H
  H --> R[Ordered service resume]
```

The database and object recovery points must be mutually reconcilable. Latest
object version alone is insufficient. Restored generation G1 can contain stale
sessions, Approval/Telegram authority and worker/outbox claims, so an authorized
operator advances to G2 and verifies it while every service remains frozen. The
read-only checker neither advances generation nor repairs state. External
payment reality and current organizational authority are reconciled manually
after technical verification; only Finance/Security/SRE human approval permits
ordered resume. P12 recovery is not deployment rollback.

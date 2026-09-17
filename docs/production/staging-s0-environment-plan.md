# AIMS Staging S0 — Environment Plan

Status: **PLAN / TEMPLATE ONLY — NO INFRASTRUCTURE CREATED, NO DEPLOYMENT PERFORMED.**
Overall Production ready remains **NO**. This document does not authorize
provisioning, migration, or spend; see "Approval gate" at the end.

This is the first artifact of the ad hoc "Staging S0" effort. The repository
does not define an official S0 phase (see `docs/PROJECT-PROGRESS.md` Section 1
and `docs/production/production-gap-register.md` PG-030), so this plan is
scoped narrowly: environment topology, provider choice, network isolation,
credential injection, a concrete resource list, and a cost estimate — matching
the P13 provider-neutral contracts already in code. It does not implement the
three blocking adapters (identity, storage, scanner); that is separately
scoped future work (see "Relationship to code" below).

## 0. Decisions already made (by the user, this session)

| Area | Decision |
| --- | --- |
| Hosting | AWS |
| Database | Independent AWS RDS for PostgreSQL |
| Object storage | Independent AWS S3 bucket |
| Identity | Self-hosted Keycloak (dedicated `aims-staging` realm + OIDC client) |
| Malware scanning | Self-hosted ClamAV (real scan service, not deterministic/local) |
| Isolation | Fully separated from Production: data, secrets, identity, network |
| AI / Telegram | OFF at Staging bring-up |

Open (explicitly deferred by the user, do not block this document on them):
AWS region/data-residency, staging domain, and budget approval. These are
called out as "Open items" below with a placeholder used only for costing.

## 1. Relationship to existing code contracts

Staging cannot start today. `production-config.ts`
(`apps/api/src/infrastructure/configuration/production-config.ts`)
unconditionally throws for `AIMS_ENVIRONMENT=staging`:
*"Staging authentication is not configured; an approved test IdP adapter is
required"* — regardless of any other setting, because no
`CorporateIdentityProvider` implementation exists beyond
`UnavailableCorporateIdentityProvider` (hard-wired in `app.module.ts`, not
even environment-selected). Similarly `STORAGE_DRIVER=object` and
`MALWARE_SCANNER_DRIVER=provider` both currently throw
`APPROVED_OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED` /
`APPROVED_MALWARE_SCANNER_PROVIDER_NOT_IMPLEMENTED` from
`provider-boundary.ts` — no S3 or ClamAV adapter class exists yet.

This plan is deliberately written so the infrastructure it describes is a
correct target for those three adapters once written (a separate, later
change), rather than infrastructure that would need to be redesigned:

- **Identity** — Keycloak issues standard OIDC; a future
  `KeycloakIdentityProvider implements CorporateIdentityProvider`
  (`apps/api/src/application/auth/corporate-identity.provider.ts`) talks to
  the `authorizationEndpoint` / token endpoint this plan stands up, over the
  private network path below. No `OIDC_*` env vars exist in the repo today;
  §5 proposes names.
- **Storage** — the `DocumentStorage` interface
  (`apps/api/src/infrastructure/storage/document-storage.ts`) already models
  a provider-neutral `backendId/key/objectVersion/sha256` identity, so an S3
  adapter maps directly onto S3's bucket/key/`VersionId`/ETag-independent
  SHA-256. No `S3_*`/`AWS_*` env vars exist today; §5 proposes names.
- **Scanner** — the `DocumentMalwareScanner` interface
  (`apps/api/src/application/documents/document-quarantine-service.ts`)
  returns `CLEAN | INFECTED | ERROR`; the worker
  (`apps/api/src/worker/document-scan-worker.ts`) already maps those to
  `CLEAN / REJECTED / SCAN_FAILED` with bounded storage/scanner timeouts. A
  ClamAV adapter (`clamdscan`/INSTREAM over TCP) fits this without changing
  the interface. No `CLAMAV_*`/`SCANNER_*` env vars exist today; §5 proposes
  names.

Writing the three adapter classes and the DI/env wiring for them (including
relaxing `production-config.ts`'s unconditional staging throw into a
conditional check against a real, `available: true` adapter) is **Step 3**
of the user's plan and is **out of scope for this document** — it is
application code, not infrastructure, and needs its own review.

## 2. Recommended topology

```mermaid
flowchart TB
  subgraph Public subnets (2 AZs)
    ALB[Application Load Balancer<br/>TLS terminates here]
    NAT[NAT Gateway]
  end

  subgraph Private subnets (2 AZs)
    WEB[ECS Fargate: web]
    API[ECS Fargate: api]
    WRK[ECS Fargate: worker]
    KC[ECS Fargate: keycloak]
    CAV[ECS Fargate: clamav + freshclam]
    RDSA[(RDS PostgreSQL<br/>aims-staging)]
    RDSK[(RDS PostgreSQL<br/>keycloak-staging)]
    EFS[(EFS: ClamAV virus DB)]
  end

  Internet -->|HTTPS 443| ALB
  ALB -->|host: app.staging.*| WEB
  ALB -->|host: api.staging.*| API
  ALB -->|host: auth.staging.*| KC
  WEB -->|private HTTP| API
  API -->|verify-full TLS, 3 distinct roles| RDSA
  WRK -->|verify-full TLS, document-worker role| RDSA
  API -->|OIDC| KC
  KC -->|verify-full TLS| RDSK
  WRK -->|private TCP, INSTREAM| CAV
  CAV -.freshclam updates.-> NAT --> Internet
  API -->|IAM role, no static keys| S3[(S3: aims-staging-documents)]
  WRK -->|IAM role, no static keys| S3
  API -.secrets.-> SM[Secrets Manager]
  WRK -.secrets.-> SM
  KC -.secrets.-> SM
```

Five ECS services, all stateless containers: `web`, `api`, `worker`,
`keycloak`, `clamav`. Two RDS instances (`aims-staging` for the AIMS schema,
`keycloak-staging` for Keycloak's own realm data — kept separate so a
Keycloak compromise or misconfiguration cannot touch financial data or reuse
its credentials; see §4). One S3 bucket. One small EFS volume so ClamAV
does not re-download its full virus-definition database on every task
restart.

This matches `docs/production/p13-production-topology.md`'s network-trust-zone
table (public ingress only at the ALB; API/worker/web/Keycloak/ClamAV/DB all
private) and preserves `docs/production/p13-production-topology.md`'s
requirement that `aims_owner` and executor roles stay `NOLOGIN` and that
infrastructure administrators receive no AIMS Finance authority — nothing
here changes database roles or grants.

## 3. ECS vs EC2

**Recommendation: ECS on Fargate for all five services. No EC2 instances.**

This follows the existing recommendation in
`docs/production/p13-provider-decision-register.md` (P13-D01): *"use the
simplest Company-standard supervised platform... do not introduce Kubernetes
without evidence."* Fargate is the simplest option that still satisfies
`docs/production/p13-deployment-infrastructure-audit.md`'s requirement for
"separate supervised process[es]" for web/API/worker with independent health
checks and graceful shutdown (the API and worker already implement Nest
SIGTERM/SIGINT shutdown hooks per P13.1 — Fargate's task-stop lifecycle is a
direct match).

| | ECS Fargate (recommended) | EC2 (self-managed or ECS-on-EC2) |
| --- | --- | --- |
| OS patching / AMI lifecycle | None — AWS-managed | Required, ongoing |
| Matches "immutable artifact" promotion model (§ deployment runbook) | Yes — task definition pins an image digest | Yes, but needs extra AMI/instance lifecycle tooling |
| Persistent local disk (ClamAV virus DB) | Needs an EFS mount (small extra cost) | Native instance disk |
| Cost at sustained low utilization (staging) | Higher per-vCPU-hour, no idle infrastructure | Lower per-vCPU-hour with Reserved/Savings Plans, but pays for capacity even when scaled to zero tasks |
| Ops burden | Low | Meaningful (patching, hardening, instance-level security groups) |
| Fits a documentation-first, security-conscious repo with no existing infra code | Yes — least new surface area to audit | No — adds a new OS/host attack surface P14 would have to review |

EC2 only wins on steady-state cost at scale, which does not apply to a
staging environment that should be capable of scaling to zero outside test
windows. Given the explicit decision to also self-host Keycloak and ClamAV
(rather than use managed equivalents), Fargate keeps all five services on one
operational model instead of splitting "managed containers" from "instances I
patch." If cost becomes the deciding factor after the estimate in §6, the
first lever is scheduling tasks to zero outside business hours (see §6), not
moving to EC2.

## 4. Network isolation

- **Dedicated VPC** for Staging only — no peering or shared routing to any
  future Production VPC. Matches PG-030 ("implement isolated staging
  identity, data, secrets, DNS/TLS").
- 2 Availability Zones for ALB/subnet redundancy. **1 NAT Gateway** (single
  AZ) — an accepted staging-only cost/resilience tradeoff; Production would
  use one NAT per AZ.
- **Public subnets** (2): ALB only. Nothing else gets a public IP.
- **Private subnets** (4, 2 per AZ): all five ECS services and both RDS
  instances. No direct inbound from the internet; egress via the NAT Gateway
  (only ClamAV's `freshclam` genuinely needs general internet egress — see
  optimization note below).
- **S3 Gateway VPC Endpoint** (free) so API/worker ↔ S3 traffic never
  transits the NAT Gateway.
- **Security groups**, reference-based (no `0.0.0.0/0` ingress anywhere
  except the ALB's 443):
  - `alb-sg`: inbound 443 from internet; outbound to `web-sg`/`api-sg`/`keycloak-sg` only.
  - `web-sg`: inbound from `alb-sg` only; outbound to `api-sg`.
  - `api-sg`: inbound from `alb-sg` and `web-sg`; outbound to `rds-aims-sg`, `keycloak-sg`, `clamav-sg`, S3 endpoint, Secrets Manager.
  - `worker-sg`: inbound none; outbound to `rds-aims-sg`, `clamav-sg`, S3 endpoint, Secrets Manager.
  - `keycloak-sg`: inbound from `alb-sg` and `api-sg`; outbound to `rds-keycloak-sg`.
  - `clamav-sg`: inbound from `api-sg`/`worker-sg` on the clamd port only; outbound to NAT (virus-definition mirrors) only.
  - `rds-aims-sg` / `rds-keycloak-sg`: inbound 5432 from their respective app security groups only.
- **RDS**: `publicly_accessible = false` on both instances; parameter group
  forces `rds.force_ssl = 1`; application connection strings use
  `sslmode=verify-full` against the AWS RDS CA bundle, matching
  `production-config.ts`'s existing validation (it already rejects any
  `DATABASE_URL`/`FINANCE_DATABASE_URL`/`PAYMENT_DATABASE_URL` missing
  `sslmode=verify-full`, a local host, or a non-distinct identity).
- **`AIMS_EXPECTED_DATABASE`**: set to a Staging-specific name (e.g.
  `aims_staging`) — `production-config.ts` already rejects `aims`,
  `aims_competition`, `postgres`, `template0/1` as the expected database name
  in protected environments.

## 5. Credential injection

Per `docs/production/secrets-and-credentials.md`: no Production/Staging
`.env` file, server-side runtime injection only, `process.env` remains the
transport (not the system of record).

- **AWS Secrets Manager** holds every credential; **AWS IAM roles** replace
  static access keys wherever AWS itself is the resource being accessed (S3,
  Secrets Manager, ECR, CloudWatch Logs) — no long-lived IAM access keys are
  created at all.
- Each ECS task definition gets its **own task role** (least privilege) and
  shares one **task execution role** (pull image, write logs, read only the
  secrets that task needs):
  - `api-task-role`: read `DATABASE_URL`, `FINANCE_DATABASE_URL`,
    `PAYMENT_DATABASE_URL`, OIDC client secret; S3 `PutObject`/`GetObject` on
    the quarantine prefix only.
  - `worker-task-role`: read `DOCUMENT_WORKER_DATABASE_URL`; S3 read/promote
    actions on the bucket; no Finance/Payment secret access.
  - `web-task-role`: no secrets (public config only, per
    `NEXT_PUBLIC_AIMS_API_URL`/`NEXT_PUBLIC_AIMS_LOGOUT_URL`).
  - `keycloak-task-role`: read its own RDS credential and admin bootstrap
    credential only.
  - `clamav-task-role`: no secrets required.
- Secrets are attached via each task definition's `secrets` block
  (Secrets-Manager-ARN → env var), populated at container start — never
  baked into an image, build argument, or written to disk, matching the
  existing `secret-boundary.ts` boundary.
- **Proposed new Secrets Manager entries** (none exist in code yet; naming
  follows the existing `*_DATABASE_URL` convention in
  `apps/api/src/infrastructure/configuration/secret-boundary.ts`):

  | Secret | Consumer | Notes |
  | --- | --- | --- |
  | `DATABASE_URL`, `FINANCE_DATABASE_URL`, `PAYMENT_DATABASE_URL`, `DOCUMENT_WORKER_DATABASE_URL` | api, worker | Already-named per `secret-boundary.ts`; four distinct RDS logins, `sslmode=verify-full` |
  | `OIDC_CLIENT_SECRET` (proposed) | api | Keycloak `aims-staging` realm, `aims-app` client, confidential |
  | `KEYCLOAK_DB_URL` (proposed) | keycloak | Separate `keycloak-staging` RDS instance |
  | `KEYCLOAK_ADMIN_PASSWORD` (proposed) | keycloak (bootstrap only) | Rotated after first login per the existing rotation runbook |

  **Proposed new plain (non-secret) config**, following the `STORAGE_DRIVER`/
  `MALWARE_SCANNER_DRIVER` pattern already in `provider-boundary.ts`:

  | Variable | Value in Staging | Notes |
  | --- | --- | --- |
  | `STORAGE_DRIVER` | `object` | Already an accepted value; adapter not yet implemented |
  | `MALWARE_SCANNER_DRIVER` | `provider` | Already an accepted value; adapter not yet implemented |
  | `S3_BUCKET` (proposed) | `aims-staging-documents` | Consumed by the future S3 adapter |
  | `S3_REGION` (proposed) | *(open — see §7)* | |
  | `CLAMAV_HOST` / `CLAMAV_PORT` (proposed) | `clamav.internal`, `3310` | Private service-discovery name, not public DNS |
  | `OIDC_ISSUER_URL` (proposed) | `https://auth.staging.<domain>/realms/aims-staging` | |
  | `OIDC_CLIENT_ID` (proposed) | `aims-app` | |

  These four `*_URL`/`*_DRIVER`-style names are **proposals for the Step 3
  code change**, not yet wired into `provider-boundary.ts` or
  `corporate-identity.provider.ts` — listed here only so the infrastructure
  this plan builds exposes them under predictable names.

## 6. Resource list and cost estimate

**Region used for costing: `ap-southeast-1` (Singapore)** — chosen only as a
placeholder because `.env.example`'s `BUSINESS_TIMEZONE=Asia/Kuala_Lumpur`
suggests the business is Malaysia-based, so this is the nearest AWS region;
it is **not** an approved data-residency decision (that is P13-C01, an open
Company/Legal input — see §7). All figures below are planning-grade
estimates from public on-demand list pricing, not a quote; validate with the
AWS Pricing Calculator once region and sizing are confirmed.

Assumptions: on-demand pricing (no Reserved/Savings Plans yet — staging
usage is presumed intermittent), single-AZ RDS (no Multi-AZ), 1 NAT Gateway,
low traffic (<50 GB/month egress, <10 GB/month NAT-processed), tasks running
24/7 (see the scale-to-zero note below for how to cut this materially).

| Resource | Configuration | Est. monthly cost (USD) |
| --- | --- | --- |
| ECS Fargate — `api` | 0.5 vCPU / 1 GB, 1 task | ~$21 |
| ECS Fargate — `worker` | 0.5 vCPU / 1 GB, 1 task | ~$21 |
| ECS Fargate — `web` | 0.25 vCPU / 0.5 GB, 1 task | ~$10 |
| ECS Fargate — `keycloak` | 1 vCPU / 2 GB, 1 task | ~$41 |
| ECS Fargate — `clamav` | 1 vCPU / 2 GB, 1 task | ~$41 |
| RDS PostgreSQL — `aims-staging` | db.t4g.micro, single-AZ, 20 GB gp3, 7-day automated backups | ~$17 |
| RDS PostgreSQL — `keycloak-staging` | db.t4g.micro, single-AZ, 20 GB gp3 | ~$17 |
| Application Load Balancer | 1 ALB, ~2 LCU average | ~$28 |
| NAT Gateway | 1, low data volume | ~$44 |
| S3 | ~20–40 GB incl. versioning, SSE-KMS | ~$3 |
| EFS | ClamAV virus-DB volume, <5 GB | ~$2 |
| Secrets Manager | ~9 secrets | ~$4 |
| CloudWatch Logs | 5 log groups, ~5 GB/month ingestion, few alarms | ~$5 |
| Route 53 hosted zone | 1 (if DNS delegated to AWS) | ~$1 |
| ECR | 3–4 repositories, small images | ~$1 |
| Misc data transfer | | ~$2 |
| **Total (24/7)** | | **~$255/month** |

**Cost-reduction options, in order of impact** (not applied by default; ask
before adopting):
1. Stop all ECS services outside agreed test windows (e.g. business hours
   only, ~50% of hours) — cuts the ~$134/month Fargate line roughly in half;
   RDS can also be stopped for up to 7 days at a time (auto-restarts after),
   which helps for a staging environment not tested daily.
2. Collapse `keycloak-staging` onto the `aims-staging` RDS instance as a
   second database (saves ~$17/month) at the cost of shared blast radius
   between identity and financial data infrastructure — **not recommended**
   given the explicit isolation decision in §0, but noted as a lever if
   budget is the binding constraint.
3. Drop to a single public+private subnet (no true Multi-AZ) if ALB
   redundancy is not required for staging — marginal savings, not
   recommended (ALB Multi-AZ is effectively free; the constrained resource is
   the single NAT Gateway, already the cheapest option).

## 7. Open items — need your input before any resource is created

These are placeholders in the Terraform templates (`infra/staging/`,
described below) and must be filled in before `terraform plan`/`apply` is
run by anyone:

1. **AWS account** — a dedicated Staging account/sub-account (recommended,
   for blast-radius isolation from a future Production account) or an
   isolated VPC inside an existing account? Who holds the credentials that
   run Terraform — you/your ops team, or should I be given scoped
   deploy credentials? (I do not currently have any AWS access from this
   environment.)
2. **Region / data residency** — `ap-southeast-1` was assumed for costing
   only; this is P13-C01 in `docs/production/p13-provider-decision-register.md`
   and needs Legal/Security/Finance-data-owner sign-off, not an engineering
   default.
3. **Domain** — a staging domain/subdomain (e.g. `staging.aims.<company
   domain>`) and whether Route 53 manages its DNS or an existing provider
   does (needed for the ACM certificate and ALB host-based routing rules
   assumed in §2).
4. **Budget approval** — ~$255/month at 24/7 (see §6 for reduction levers)
   needs sign-off before creation.
5. **Test personas** — Keycloak's `aims-staging` realm needs test accounts
   for the 8 business personas in the locked workflow
   (`docs/PROJECT-PROGRESS.md` Section 2); names/emails are needed once the
   realm is actually created (Step 2/3, not this document).

## 8. What this document does NOT do

- No AWS resource, IAM role, secret, or DNS record has been created.
- No database migration has been run or planned to run here.
- No frozen business rule, approval authority, Finance Control gate, or
  payment-recording behavior is touched.
- No adapter code (identity/storage/scanner) is implemented here — see §1.
- `docs/PROJECT-PROGRESS.md` is updated (below) to record only that this
  plan exists; it explicitly still states Staging is not deployed and
  Overall Production ready remains NO.

## 9. Approval gate

Before proceeding to Step 2 (environment isolation — actually creating the
VPC/RDS/S3/Keycloak/ClamAV resources) or Step 3 (writing the three adapter
classes), this document and the Terraform templates in `infra/staging/`
need your review, specifically:
- sign-off on the topology/ECS-vs-EC2 choice in §2–3,
- a decision on the open items in §7 (or explicit permission to proceed with
  the `ap-southeast-1` placeholder and a provisional budget cap),
- confirmation of who will actually run `terraform apply` and hold AWS
  credentials, since that is not something this session can do on your
  behalf.

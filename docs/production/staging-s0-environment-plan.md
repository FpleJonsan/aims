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
  - `clamav-sg`: inbound from `api-sg`/`worker-sg` on the clamd port only; outbound to NAT on 443 (virus-definition mirrors) and 53 tcp/udp (DNS resolution for the mirror hostnames).
  - `rds-aims-sg` / `rds-keycloak-sg`: inbound 5432 from their respective app security groups only; no egress rule (neither instance uses a feature that needs one — see the read-only review for why this is a deliberate choice, not an oversight).

  Implementation note (from the read-only Terraform review,
  `docs/production/staging-s0-review-findings.md` §1): these groups
  reference each other bidirectionally (e.g. `alb-sg` ↔ `web-sg`), which
  cannot be expressed as inline `ingress`/`egress` blocks on
  `aws_security_group` — Terraform's own dependency graph rejects that with
  a literal `Error: Cycle`, confirmed by actually running
  `terraform validate` against the first draft. `infra/staging/security-groups.tf`
  now declares each group as a bare shell plus one
  `aws_vpc_security_group_ingress_rule` / `..._egress_rule` resource per
  rule, which resolves the cycle while keeping the same effective access.
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
suggests the business is Malaysia-based, so this is the nearest AWS region.
This is a timezone, **not** a data-residency decision — it is not evidence
about where data is legally allowed to live, and does not substitute for
P13-C01 (Legal/Security/Finance-data-owner sign-off, still open — see §7).

**Pricing sources**: AWS does not publish region-specific rate tables as
static, machine-readable text on its pricing pages (they render
interactively), so exact `ap-southeast-1` figures could not be pulled
automatically this session. What follows instead cites the **confirmed
current US East (N. Virginia) on-demand list rate** for each line (fetched
this session from `aws.amazon.com/fargate/pricing`,
`aws.amazon.com/vpc/pricing`, and `aws.amazon.com/elasticloadbalancing/pricing`)
and applies a **+15% Singapore-region estimate** — within the commonly-cited
10–30% Asia-Pacific premium range for these services, but not itself an
AWS-published `ap-southeast-1` figure. **Every `ap-southeast-1` number below,
and the ~$252/month total, is therefore a rough estimate under an assumed
regional multiplier — not a quote, and not a substitute for a real
`ap-southeast-1` price. Budget approval must not be based on this table
alone: obtain the actual `ap-southeast-1` on-demand price (AWS Pricing
Calculator, or an account-specific quote) before sign-off.**

Assumptions: on-demand pricing (no Reserved/Savings Plans — staging usage is
presumed intermittent), single-AZ RDS (no Multi-AZ), 1 NAT Gateway, low
traffic (<50 GB/month egress, <10 GB/month NAT-processed), tasks running
24/7 (see the stop/start table below for what that actually buys you).

| Resource | Configuration | US East confirmed rate | Est. `ap-southeast-1` (+15%) |
| --- | --- | --- | --- |
| ECS Fargate — `api` | 0.5 vCPU / 1 GB, 1 task, 24/7 | $0.04048/vCPU-hr + $0.004445/GB-hr → $18.02/mo | ~$21 |
| ECS Fargate — `worker` | 0.5 vCPU / 1 GB, 1 task, 24/7 | same as above | ~$21 |
| ECS Fargate — `web` | 0.25 vCPU / 0.5 GB, 1 task, 24/7 | → $9.01/mo | ~$10 |
| ECS Fargate — `keycloak` | 1 vCPU / 2 GB, 1 task, 24/7 | → $36.04/mo | ~$41 |
| ECS Fargate — `clamav` | 1 vCPU / 2 GB, 1 task, 24/7 | → $36.04/mo | ~$41 |
| RDS PostgreSQL — `aims-staging` | db.t4g.micro, single-AZ, 20 GB gp3, 7-day backups | $0.016/hr instance ($11.68/mo) + ~$2.30 storage + ~$1 backup | ~$17 |
| RDS PostgreSQL — `keycloak-staging` | db.t4g.micro, single-AZ, 20 GB gp3 | same as above | ~$17 |
| Application Load Balancer | 1 ALB, ~2 LCU average | $0.0225/hr + $0.008/LCU-hr → $28.11/mo | ~$32 |
| NAT Gateway | 1, low data volume | $0.045/hr + $0.045/GB → $33.30/mo | ~$38 |
| S3 | ~20–40 GB incl. versioning, SSE-KMS | not independently re-confirmed this session; general published rate ~$0.023/GB-mo | ~$3 |
| EFS | ClamAV virus-DB volume, <5 GB | general published Standard rate ~$0.30/GB-mo | ~$2 |
| Secrets Manager | 9 secrets (7 app-level + 2 RDS-auto-created master passwords) | $0.40/secret/mo (stable, not region-multiplied here) | ~$4 |
| CloudWatch Logs | 5 log groups, ~5 GB/month ingestion, no alarms configured yet | general published rate ~$0.50/GB ingestion | ~$3 |
| Route 53 hosted zone | 1 (if DNS delegated to AWS) | $0.50/mo flat, global pricing | ~$1 |
| ECR | 3 repositories, small images | negligible | ~$1 |
| Misc data transfer | | | ~$2 |
| **Total (24/7)** | | | **~$252/month** |

Rows marked "not independently re-confirmed this session" use figures that
match what this session already had before searching (i.e. unchanged from
the original draft), not numbers freshly pulled from an AWS pricing page —
called out explicitly so you know which lines to double-check hardest before
relying on the total.

### Stop/start cost applicability — what actually stops accruing cost

| Resource | Cost while stopped/idle | Why |
| --- | --- | --- |
| ECS Fargate tasks (all 5 services) | **$0** when the service's `desired_count` is set to 0 | Fargate bills running task vCPU/GB-hours only; the largest single lever (~$135/mo of the ~$252 total) |
| RDS **compute** (both instances) | **$0**, but only temporarily | Confirmed against AWS's own RDS stop/start documentation (`docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_StopInstance.html`): stopping a DB instance halts instance-hour billing, but AWS **automatically restarts it after 7 consecutive days** if nobody manually starts it first — so this is a repeating "stop again every week" chore, not a set-and-forget savings, unless a scheduled automation (e.g. Lambda/EventBridge) re-stops it. |
| RDS **storage + backups** (both instances) | **Continues even while stopped** | Per the same AWS documentation: provisioned storage and backup/snapshot storage (within the retention window) are billed regardless of whether the instance is running or stopped — stopping an instance reduces, but does not eliminate, its cost. No new automated backups are taken while stopped. |
| Application Load Balancer | **Continues** (hourly + LCU) | No "stop" state exists; only deletion removes the charge, which also drops the DNS/ACM setup and needs re-validation on recreation |
| NAT Gateway | **Continues** (hourly) | Same — no stop/start, only delete/recreate |
| EFS | **Continues** (storage, small) | Independent of ECS task state |
| S3 | **Continues** (storage) | Independent |
| Secrets Manager | **Continues** (flat per-secret fee) | Independent of usage |
| CloudWatch Logs | Ingestion drops to ~0 if nothing is running; existing log storage cost continues (small) | |
| ECR / Route 53 | **Continues** (both small, flat) | Independent |

**Practical read**: stopping ECS services + RDS overnight/weekends realistically saves the Fargate line (~$135/mo) plus most of the RDS compute line (~$26/mo of the ~$34 RDS total — storage/backup cost persists regardless), roughly half the total — but the RDS side needs a weekly re-stop (or scheduled automation) because of the 7-day auto-restart, not a single toggle. ALB + NAT Gateway (~$70/mo combined) keep billing regardless of any stop/start action, since neither has a "stop" state — only deleting them removes the charge, which is a bigger operational step (ACM re-validation, DNS re-pointing) and only worth it if Staging truly sits idle for extended periods rather than nights/weekends.

**Cost-reduction options, in order of impact** (not applied by default; ask
before adopting):
1. Stop all ECS services outside agreed test windows and stop both RDS
   instances alongside them (see table above) — the only levers with no
   architectural downside.
2. Collapse `keycloak-staging` onto the `aims-staging` RDS instance as a
   second database (saves ~$17/month) at the cost of shared blast radius
   between identity and financial data infrastructure — **not recommended**
   given the explicit isolation decision in §0, but noted as a lever if
   budget is the binding constraint.
3. Tear down the whole environment (`terraform destroy`) between extended
   idle periods to also stop ALB/NAT billing — only worth the ACM/DNS churn
   if Staging is idle for weeks at a time, not nightly.

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

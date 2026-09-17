# AIMS Staging S0 — Review and Fixes (Terraform), and Adapter Implementation Plan

Status: **REVIEW AND FIXES APPLIED TO THE TEMPLATES THEMSELVES — NO AWS
RESOURCE CREATED, NO MIGRATION RUN, NO ADAPTER CODE WRITTEN, NOTHING
DEPLOYED OR APPLIED.** This is not a read-only review: the Terraform files
under `infra/staging/` were directly edited to fix real defects found this
pass (§1). What stayed untouched is everything outside those template
files — no AWS account was accessed, no `terraform apply`/`push` was run,
and the three adapters are planned (§5) but not implemented. Overall
Production ready remains **NO**; Staging remains undeployed.

Scope, per the request that produced this document: (1) verify the Terraform
actually validates and is complete for the five services' images/startup/
health-checks/internal networking; (2) check IAM/Secrets Manager/S3/database/
security-group least privilege and that secret shells are marked as
prerequisites; (3) check Keycloak/ClamAV persistence, virus-definition
updates, resource sizing, and failure handling; (4) refresh the cost
estimate against current AWS pricing with assumptions cited (done in
`staging-s0-environment-plan.md` §6, not duplicated here); (5) map which
resources stop accruing cost when stopped (same §6); (6) list findings,
fixes, deployment prerequisites, and the three adapters' implementation and
acceptance scope.

## 0. How this was actually verified — and what that does and doesn't prove

No `terraform` binary was available in this environment initially. Rather
than reviewing the HCL by eye only, a real Terraform binary
(`v1.9.8`, official HashiCorp release, used read-only, never given AWS
credentials) was downloaded to a scratch directory and run against a copy of
`infra/staging/`:

- `terraform fmt -check -recursive` — found formatting-only differences,
  applied to the actual templates (no logic change).
- `terraform validate` — found one real structural bug (below) and one
  provider deprecation warning; both fixed, then **re-validated clean** (zero
  errors, zero warnings) against the final templates. **What this proves:**
  the configuration is syntactically valid HCL, internally consistent
  (references resolve, no dependency cycle, required arguments present) —
  a **static** check that never contacts AWS. **What this does NOT prove:**
  that a real `terraform apply` against an actual AWS account would
  succeed — AWS-side validation (attribute value limits, region/service
  availability, account quotas, IAM policy semantics, whether the specific
  API calls the provider makes are actually accepted) only happens when
  real credentials reach `terraform plan`/`apply`, which did not happen here.
- `terraform plan` with placeholder variables and dummy (non-functional) AWS
  credentials — confirmed the dependency graph resolves completely, and the
  plan run reached and failed at the AWS authentication step
  (`InvalidClientTokenId`) rather than failing earlier on a reference or
  type error. **What this proves:** every resource reference, `for_each`,
  and cross-file dependency is well-formed enough for Terraform to attempt
  a plan. **What this does NOT prove:** a complete, executable deployment
  plan — Terraform never got far enough (no valid credentials) to actually
  read real AWS state or generate the real resource-by-resource plan, so
  **the full deployment has not been verified end-to-end**; that only
  happens with real credentials in a real (even if disposable/sandbox)
  account, which is explicitly out of scope for this pass.
- The security-group cycle bug (finding F1) was independently reproduced in
  isolation: a minimal two-security-group file with the original
  bidirectional inline-rule pattern was fed to `terraform validate`, which
  returned `Error: Cycle: aws_security_group.web, aws_security_group.alb` —
  confirming this was a real defect, not a theoretical concern.

## 1. Terraform findings and fixes (all applied to `infra/staging/`)

| # | Severity | File | Finding | Fix applied |
| --- | --- | --- | --- | --- |
| F1 | **HIGH — would have blocked `terraform plan`/`apply` entirely** | `security-groups.tf` | `alb`/`web`/`api`/`keycloak` security groups referenced each other bidirectionally using inline `ingress`/`egress` blocks (e.g. `alb` → `web` and `web` → `alb`). Terraform's own dependency graph rejects this with `Error: Cycle` — empirically confirmed (§0). This was not a style issue; the templates could not have been applied at all. | Rewrote every security group as a bare shell plus one `aws_vpc_security_group_ingress_rule` / `..._egress_rule` resource per rule. These reference `security_group_id` and `referenced_security_group_id` independently, so Terraform can create all shells first with no inter-dependency, then attach cross-referencing rules. Re-validated with zero errors. |
| F2 | MEDIUM | `security-groups.tf` | `alb`/`api`/`worker` egress rules used `0.0.0.0/0` or full `0–65535` port ranges "to the VPC CIDR" instead of the exact destination and port — broader than least privilege even though still private-network-only. | Replaced with per-destination, per-port rules referencing the destination security group directly (e.g. `api → rds_aims:5432`, `api → keycloak:8080`, `api → clamav:3310`), keeping only the genuinely-needed `443` egress to `0.0.0.0/0` for AWS service endpoints/OIDC. |
| F3 | MEDIUM | `security-groups.tf` | `clamav`'s security group only opened port 443 egress. `freshclam` needs to resolve `database.clamav.net`-style hostnames first, which needs DNS (port 53) — the VPC's default resolver traffic is itself subject to security groups. Without this, DNS resolution (and therefore every definition update) would fail. | Added explicit TCP+UDP 53 egress scoped to the VPC CIDR. |
| F4 | MEDIUM | `iam.tf` | A single shared ECS task-execution role's Secrets Manager policy granted `secretsmanager:GetSecretValue` on **all 7** secrets to every one of the 5 services — e.g. the `web` and `clamav` execution roles could read the Keycloak admin password and every database URL even though neither task references any secret. | Replaced with 5 distinct execution roles (`aims-staging-<service>-execution`), each scoped only to the secrets its own task definition's `secrets` block actually references (`web` and `clamav` get none). |
| F5 | **HIGH — would have failed at task startup** | `iam.tf` / `efs.tf` | `efs.tf`'s ClamAV volume config sets `authorization_config.iam = "ENABLED"`, which requires the **task role** (not the execution role) to hold `elasticfilesystem:ClientMount`/`ClientWrite` on that specific file system + access point. No such policy existed anywhere — the ClamAV task would have failed to mount its virus-definition volume on every start. | Added a scoped `clamav_task` inline policy granting exactly those two actions, conditioned on the specific access-point ARN. |
| F6 | **HIGH — would have failed at task startup** | `ecs-services.tf` | Keycloak's command was `["start", "--optimized"]`. That flag assumes a prior `kc.sh build` step baked into a custom image; the stock upstream image referenced by `keycloak_image` has not been built that way, so `--optimized` fails fast on every start. | Changed to `["start"]` (runs an implicit build first); noted that `--optimized` can be reinstated later against a custom-built image if cold-start time becomes a problem. |
| F7 | **HIGH — health check would never pass** | `ecs-services.tf` / `alb.tf` | Keycloak 24+ moved `/health/ready` and `/metrics` to a separate management listener (default port 9000), off by default. The ALB target group health-checked `/health/ready` on port 8080 (the main traffic port) with `KC_HEALTH_ENABLED` never set — the endpoint would 404/refuse forever and the service would never register healthy, permanently blocking traffic. | Set `KC_HEALTH_ENABLED=true` / `KC_METRICS_ENABLED=true`, exposed port 9000 in the task definition, opened ALB → Keycloak port 9000 in the security groups, and pointed the target group's `health_check.port` at `"9000"`. |
| F8 | LOW | `ecs-services.tf` | ClamAV's `CLAMAV_NO_MILTERD` was never set, so the (unused, since the worker talks to clamd directly over INSTREAM) milter listener would start anyway, wasting memory and opening an unused port. | Added `CLAMAV_NO_MILTERD=true`. |
| F9 | LOW / verify-before-deploy | `ecs-services.tf` | The ClamAV health check assumes `clamdcheck.sh` exists at that path in whatever `clamav_image` tag is actually pinned — this has moved/changed across upstream image revisions and can't be confirmed without pulling the image. | Left as-is with an explicit comment to verify against the chosen tag before first deploy (listed again in §4 prerequisites). |
| F10 | LOW / verify-before-deploy | `efs.tf` | The ClamAV EFS access point's `posix_user { uid = 100, gid = 101 }` is a guess ("a common `clamav` system-account convention"), not verified against the actual image's runtime user. A mismatch causes permission-denied errors on mount, not a Terraform-time failure. | Left as a variable-adjacent value with an explicit comment; verification step added to §4 prerequisites. |
| F11 | LOW | `ecs-services.tf` | ClamAV health-check `startPeriod` was 120s — too short for a cold EFS volume's first full `freshclam` sync (can take several minutes). | Raised to 300s. |
| F12 | INFO (deprecation) | `s3.tf` | `terraform validate` itself flagged: the lifecycle rule with only `abort_incomplete_multipart_upload` needs an explicit `filter {}`/`prefix` under a current provider version, or it will become a hard error in a future one. | Added `filter {}` (applies to every object, matching the original intent). |
| F13 | INFO / verify-before-deploy, not a template bug | `rds.tf` | RDS PostgreSQL's master user is a member of `rds_superuser`, a restricted role — not literal OS-level superuser. P6's role-provisioning process (creating `aims_owner`, `aims_migrator`, executor roles, `SET ROLE`, `ALTER DEFAULT PRIVILEGES`, `SECURITY DEFINER` functions) is believed compatible with `rds_superuser`, but this has not been verified against the exact P6 provisioning scripts on an actual RDS instance. | Not a template change; added to §4 as a pre-migration verification item. |
| F14 | INFO, inherent to the design (not a bug) | `alb.tf` | When `route53_zone_id` is left `null` (domain managed elsewhere), the ACM certificate cannot auto-validate, and `aws_lb_listener.https` references it directly — an ALB HTTPS listener requires an `ISSUED` certificate, so a first apply with an external DNS provider needs a manual two-phase sequence (create the cert, add the validation CNAME with the external provider, wait for issuance, then apply the rest). | Documented as an explicit prerequisite/sequencing step in §4, not changed in code (there is no single-phase fix when DNS lives outside Route 53). |

All of F1–F12 are now fixed in `infra/staging/`; `terraform fmt -check` and
`terraform validate` both pass cleanly against the current templates. F13/F14
are verification/sequencing items for whoever actually deploys, not template
defects.

## 2. IAM / Secrets Manager / S3 / database / security-group least privilege — post-fix assessment

- **IAM**: 5 distinct task-execution roles (F4 fix) + 5 distinct task roles,
  each scoped to only what that one service needs. `api_task` can only
  `PutObject`/`GetObject` under `quarantine/*` (it never promotes to
  `active/`, matching that the API has no promote authority in
  `document-storage.ts`). `worker_task` can read `quarantine/*` and
  read/write/copy `active/*` (only the worker promotes). `web_task` and
  `keycloak_task` carry no inline AWS policy at all — correctly, since
  neither calls an AWS API directly. `clamav_task` now carries exactly the
  two EFS actions it needs (F5 fix), scoped to one access point.
- **Secrets Manager**: all 9 entries (7 declared shells + 2 RDS-auto-created
  master-user secrets via `manage_master_user_password`) are explicitly
  **empty shells** — `secrets.tf`'s comment block and
  `infra/staging/README.md` both state no value is ever set by Terraform,
  and `outputs.tf` surfaces the ARNs specifically so whoever deploys
  populates them out-of-band. This satisfies "credential shells must be
  marked as a deployment prerequisite" directly.
- **S3**: `block_public_acls`/`block_public_policy`/`ignore_public_acls`/
  `restrict_public_buckets` all `true`; default SSE-KMS with a dedicated CMK;
  versioning on; an explicit bucket policy denies any non-TLS request
  regardless of IAM. Combined with the IAM prefix scoping above, this is
  private-by-default at both the bucket-policy and IAM layers.
- **Database**: both RDS instances are `publicly_accessible = false`, force
  TLS via parameter group (`rds.force_ssl = 1`), and are reachable only from
  their one respective application security group on 5432 — nothing else,
  including each other's security group. `AIMS_EXPECTED_DATABASE` is set to
  a Staging-specific name so `production-config.ts`'s existing rejection of
  `aims`/`aims_competition`/`postgres`/`template0`/`template1` is satisfied
  without code changes.
- **Security groups**: after F1–F3, every rule is either (a) the ALB's
  public 443 listener, (b) a reference to a specific peer security group on
  an exact port, or (c) a narrowly-scoped `0.0.0.0/0` egress for HTTPS (API/
  worker → AWS endpoints/OIDC/definition mirrors) or DNS (ClamAV). No SG
  allows a broad port range to a CIDR block anymore. `rds_aims`/
  `rds_keycloak`/the EFS mount-target SG intentionally carry **no** egress
  rule at all — confirmed correct against
  `docs/production/p13-production-topology.md`'s network-zone table (the
  Database zone's only permitted outbound is backup/monitoring traffic that
  does not traverse the instance's own ENI/SG), not an oversight.

## 3. Keycloak and ClamAV — persistence, updates, sizing, failure handling

**Keycloak**
- **Persistence**: realm/client/user data lives entirely in the dedicated
  `keycloak-staging` RDS instance (not on the container's own disk), so the
  ECS task itself is stateless and replaceable at any time without data
  loss — restarts, deployments, and AZ failure all just reconnect to the
  same database.
- **Failure handling**: if the Keycloak task is down, **new logins fail**,
  but per the existing application design in
  `docs/production/p13-2-corporate-auth-transactions.md`, a successful login
  already produces "a fresh opaque AIMS session through the existing cookie,
  recovery-generation, revocation and current-authority architecture" —
  i.e. already-authenticated users' ongoing requests are validated against
  AIMS's own session store, not re-checked against Keycloak per request. A
  Keycloak outage blocks new sign-ins, not already-signed-in users. (This is
  existing application behavior confirmed by reading the doc, not something
  this Terraform template changes.) At the infrastructure level, ECS
  automatically relaunches a failed/unhealthy Keycloak task under the
  `aims-staging` cluster; there is only one task (`desired_count = 1`), so
  there is a brief gap during replacement, not instant failover — acceptable
  for S0, and something to revisit if Staging needs higher availability.
- **Resource sizing**: 1 vCPU / 2 GB was chosen because Keycloak's JVM has
  meaningful baseline memory overhead even at low request volume; this is a
  planning default, not measured — treat it as a starting point to adjust
  once real login-flow load is observed.
- **Startup**: fixed in F6 (plain `start`, not `--optimized`) and F7
  (health endpoint now reachable). First boot will be slower than a
  production-optimized image; acceptable for S0.

**ClamAV**
- **Persistence**: the virus-definition database lives on a dedicated EFS
  volume mounted at `/var/lib/clamav` (ClamAV's actual default
  `DatabaseDirectory` for both `clamd` and `freshclam`), so a task
  restart does not require re-downloading the full definition set from
  scratch — only incremental `freshclam` updates run afterward.
- **Updates**: `CLAMAV_NO_FRESHCLAMD=false` keeps the built-in `freshclam`
  daemon running inside the same task, which periodically re-pulls
  definition updates over the internet path already opened in F3 (443 +
  DNS). No separate update mechanism/schedule needs to be built.
- **Resource sizing**: 1 vCPU / 2 GB — ClamAV's in-memory signature
  database for a full definition set is commonly cited in the few-hundred-MB
  to ~1GB range once loaded; 2 GB gives headroom. Also a planning default,
  not measured.
- **Failure handling**: the health check (fixed in F9/F11) gates ECS
  replacement of an unhealthy task. More importantly, **the application
  already fails closed independent of any infrastructure behavior here**:
  `document-scan-worker.ts`'s bounded `deadline()` wrapper treats a
  ClamAV connection failure or timeout as `SCANNER_TIMEOUT`/
  `SCANNER_OR_STORAGE_FAILURE`, which the worker maps to `SCAN_FAILED` with
  `RETRYABLE` or `TERMINAL` disposition depending on attempt count — a
  document never becomes `CLEAN` just because the scanner was unreachable.
  This existing worker contract is exactly why the plan's network design
  (§4 of the main plan) routes the worker to ClamAV over a private,
  narrowly-scoped path rather than assuming scanner availability.
- **Verify before deploying** (not fixable at the template level, see F9/F10):
  confirm `clamdcheck.sh`'s exact path and the image's actual runtime
  uid/gid against whichever `clamav_image` tag is finally pinned.

## 4. Deployment prerequisites (consolidated)

Beyond the open items already listed in the main plan's §7 (AWS account,
region, domain, budget, test personas), this review surfaces additional
concrete prerequisites before any real `terraform apply`:

1. **Remote Terraform state backend** — `versions.tf` currently has no
   backend configured (local state only), which is unsafe for anything
   beyond a single person's throwaway experiment. Configure an S3 backend +
   DynamoDB (or S3-native) lock **before** the first real apply, and review
   that configuration on its own.
2. **Container images and a build pipeline** — `api_image`/`worker_image`/
   `web_image` have no real value and nothing in this repository builds or
   pushes them yet (P13-G04/PG-023 — no CI/CD exists). This blocks Step 5
   (deploy), not Step 2/3, but should be sequenced before anyone tries to
   actually run `terraform apply` expecting working services.
3. **RDS `rds_superuser` compatibility** (F13) — verify P6's role-
   provisioning scripts run cleanly against RDS's restricted superuser-like
   role on an actual (even disposable/test) RDS instance before relying on
   it for the real Staging database.
4. **ACM/DNS sequencing** (F14) — if `route53_zone_id` stays `null`, plan
   for a manual two-phase apply (certificate first, external DNS validation
   record, wait, then the rest).
5. **ClamAV image verification** (F9/F10) — confirm the health-check script
   path and the runtime uid/gid against the exact `clamav_image` tag chosen.
6. **Secrets Manager population** — all 9 secret shells need real values
   written out-of-band (never via Terraform/committed files) after the RDS
   instances and Keycloak realm exist; `outputs.tf` lists every ARN to make
   this a checklist rather than a search.
7. **Keycloak realm/client/test-user setup** — `aims-staging` realm,
   `aims-app` confidential client (secret → `OIDC_CLIENT_SECRET`), and the
   test accounts for the 8 business personas (plan §7 item 5) still need to
   be created inside Keycloak once it is running — this is realm
   configuration, not something Terraform manages.

## 5. Adapter implementation plans (planning only — no code written yet)

All three follow the same shape: implement the interface already defined in
the repo, wire it into the existing (or, for identity, a new)
environment-driven factory, and relax the corresponding hard rejection in
`production-config.ts` from an unconditional throw to a check against a
real, `available: true` adapter — never removing the fail-closed default.

### 5.1 Identity — `KeycloakIdentityProvider`

**Files to add**
- `apps/api/src/infrastructure/identity/keycloak-identity.provider.ts` —
  implements `CorporateIdentityProvider`
  (`apps/api/src/application/auth/corporate-identity.provider.ts`):
  `adapterId = "keycloak"`, `expectedIssuer`/`authorizationEndpoint` derived
  from `OIDC_ISSUER_URL` (`.../realms/aims-staging`), `available` reflects
  whether required config/JWKS fetch succeeded at construction.
  `buildAuthorizationRequest` builds the PKCE S256 `/protocol/openid-connect/auth`
  URL (same shape as the existing `TestCorporateIdentityProvider`, so
  `CorporateAuthService`'s `assertTrustedAuthorizationUrl` needs no change).
  `exchangeAndVerify` calls the token endpoint, verifies the ID token
  against Keycloak's JWKS (`/protocol/openid-connect/certs`, cached with
  rotation), and checks `iss`/`aud`/`exp`/`nbf`/PKCE/nonce exactly as the
  test adapter does today, returning only `{ issuer, subject }` — no token
  material is persisted or propagated, matching the existing trust boundary
  in `docs/production/p13-2-corporate-auth-transactions.md`.

**Files to modify**
- A new `createCorporateIdentityProvider(environment)` factory (new file or
  added to `apps/api/src/infrastructure/configuration/provider-boundary.ts`
  for consistency with the storage/scanner pattern already there), gated by
  a new `IDENTITY_PROVIDER_DRIVER` env var (`"unconfigured"` |
  `"keycloak"`), mirroring `createDocumentStorage`/`createDocumentScanner`'s
  shape. This is a genuinely new piece — today `app.module.ts` hard-wires
  `UnavailableCorporateIdentityProvider` with **no** environment-driven
  selection at all (unlike storage/scanner, which already have the
  driver-selection pattern, just no real adapter behind it).
- `apps/api/src/app.module.ts` — replace the hardcoded
  `useFactory: () => new UnavailableCorporateIdentityProvider()` with
  `useFactory: () => createCorporateIdentityProvider(process.env)`.
- `apps/api/src/infrastructure/configuration/production-config.ts` — replace
  the current unconditional `throw` for `staging`/`production` ("Staging
  authentication is not configured...") with a check that the constructed
  provider's `available === true` and `adapterId !== "unconfigured"`,
  matching the existing `STORAGE_DRIVER`/`MALWARE_SCANNER_DRIVER` pattern.
  Must still fail closed if Keycloak is unreachable at boot or misconfigured
  — no weakening of the existing rejection, only replacing a hardcoded
  string with a real check.
- Pre-provisioned `(adapter, issuer, subject) → AIMS user` mapping: per
  `p13-2-corporate-auth-transactions.md`, only an exact pre-existing mapping
  may create a session — confirm whether this mapping table already exists
  from migration 060 (application-side, no new migration expected) or
  whether an operational process to populate it needs to be defined; this
  is data/process, not new schema, and is explicitly out of scope for a
  migration.

**Acceptance scope**
- Unit tests: PKCE/nonce/issuer/audience mismatch rejection (mirroring the
  existing `TestCorporateIdentityProvider` test suite), JWKS fetch failure
  and rotation, malformed token handling, `available=false` when Keycloak is
  unreachable at construction.
- Integration test: full authorize → callback → session flow against a real
  (disposable, test-only) Keycloak instance — can reuse the Terraform
  templates here for a throwaway test Keycloak, not the actual Staging one.
- Regression: `production-config.ts`'s staging/production startup rejection
  test suite must still fail closed when `IDENTITY_PROVIDER_DRIVER` is unset
  or the adapter reports `available=false` — this is the single most
  important test, since it is the fail-closed boundary the whole design
  depends on.
- Explicitly not weakened: `TestCorporateIdentityProvider`'s existing
  protected-environment rejection stays untouched.

### 5.2 Storage — `S3DocumentStorage`

**Files to add**
- `apps/api/src/infrastructure/storage/s3-document-storage.ts` — implements
  `DocumentStorage`
  (`apps/api/src/infrastructure/storage/document-storage.ts`) against AWS
  SDK v3 (`@aws-sdk/client-s3`), using the `S3_BUCKET`/`S3_REGION` env vars
  proposed in the main plan. Design decisions to make explicit at
  implementation time (not decided here):
  - `backendId` constant (e.g. `"aws-s3"`), distinct from `LocalDocumentStorage`'s
    `"local-development"`, so the existing provider-neutral identity model
    (`backendId`/`key`/`objectVersion`) stays meaningful.
  - `objectVersion` = the S3 `VersionId` returned on `PutObject` (bucket
    versioning is already enabled in `s3.tf`), not a synthetic value.
  - SHA-256 verification: S3's `ETag` is not reliably a content hash for
    multipart uploads, so the interface's caller-supplied/verified
    `expectedSha256` should be checked against either (a) S3's native
    additional-checksum feature (`ChecksumSHA256` on `PutObject`/
    `HeadObject`), or (b) a hash computed while streaming and stored as
    object metadata — pick one and document why during implementation, not
    here.
  - `promoteQuarantined` maps to a conditional S3 `CopyObject` from
    `quarantine/<key>` to `active/<trustedKey>`, verified against the exact
    `objectVersion`/hash/size before and after, matching
    `docs/production/p13-3-1-storage-object-version-binding.md`'s
    requirement that "equal bytes at a different non-empty key do not
    satisfy object identity."
  - `listPage` maps to paginated `ListObjectsV2` with the cursor as S3's
    continuation token.

**Files to modify**
- `apps/api/src/infrastructure/configuration/provider-boundary.ts` —
  `createDocumentStorage`'s `driver === "object"` branch currently `throw`s
  `APPROVED_OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED`; replace with
  `new S3DocumentStorage(...)` constructed from `S3_BUCKET`/`S3_REGION` (and
  any additional config the implementation needs), still gated by
  `classifyAimsEnvironment` so an unconfigured bucket still fails closed
  rather than silently falling back.
- IAM: no Terraform change needed — `api_task`/`worker_task` roles already
  grant exactly the S3 actions each needs (§2), scoped to `quarantine/*`/
  `active/*`.

**Acceptance scope**
- Unit tests against a local S3-compatible mock (e.g. an in-memory fake or
  a containerized MinIO/LocalStack instance in CI, not real AWS) covering:
  store → read round-trip with hash verification, version-mismatch
  rejection, promote success and promote-with-mismatched-hash/size
  rejection, missing-object and expired-lease-adjacent error paths, and
  `listPage` pagination.
- Integration smoke test against the actual Staging bucket (put → get →
  promote → delete a disposable test object), run manually or in a
  Staging-only CI job — never against Production, never in local/dev
  suites.
- Regression: `production-config.ts`'s existing rejection of
  `STORAGE_DRIVER` values other than `"object"` in protected environments
  must still hold; `LocalDocumentStorage`'s existing protected-environment
  rejection stays untouched.

### 5.3 Scanner — `ClamAvMalwareScanner`

**Files to add**
- `apps/api/src/infrastructure/security/clamav-malware-scanner.ts` —
  implements `DocumentMalwareScanner`
  (`apps/api/src/application/documents/document-quarantine-service.ts`):
  `scan(request)` opens a TCP connection to `CLAMAV_HOST`/`CLAMAV_PORT`,
  speaks clamd's `INSTREAM` protocol (send `zINSTREAM\0`, chunked
  length-prefixed body, terminate with a zero-length chunk), and maps the
  response: `"stream: OK"` → `CLEAN`, `"stream: <signature> FOUND"` →
  `INFECTED` (with `reference` = the signature name), anything else
  (protocol error, connection refused, malformed response) → `ERROR`. Must
  honor `request.signal` (`AbortSignal`) for cancellation, since the worker's
  existing `deadline()` wrapper (`document-scan-worker.ts`) already races
  this call against a timeout and expects prompt abort, not a dangling
  socket.

**Files to modify**
- `apps/api/src/infrastructure/configuration/provider-boundary.ts` —
  `createDocumentScanner`'s `driver === "provider"` branch currently
  `throw`s `APPROVED_MALWARE_SCANNER_PROVIDER_NOT_IMPLEMENTED`; replace with
  `new ClamAvMalwareScanner(environment)`, still gated by
  `classifyAimsEnvironment` so a missing `CLAMAV_HOST`/`CLAMAV_PORT` fails
  closed.

**Acceptance scope**
- Unit tests mocking the TCP/INSTREAM protocol: clean response, infected
  response (verify `reference` carries the signature), malformed/truncated
  response, connection refused, and `AbortSignal`-triggered cancellation
  mid-stream (must resolve/reject promptly, not hang until a TCP-level
  timeout).
- Integration test against the real Staging ClamAV service using the
  industry-standard EICAR test file for the `INFECTED` path (safe,
  purpose-built for exactly this kind of test — not a real virus) and a
  benign PDF/JPEG fixture for the `CLEAN` path.
- Failure-injection test: stop/pause the ClamAV ECS task and confirm the
  existing worker behavior — `SCAN_FAILED` with `RETRYABLE`/`TERMINAL`
  disposition per attempt count, no `CLEAN` promotion — holds without any
  worker code change, only the new adapter being exercised end-to-end.
- Regression: `production-config.ts`'s existing rejection of
  `MALWARE_SCANNER_DRIVER` values other than `"provider"` in protected
  environments must still hold; `DeterministicLocalMalwareScanner`'s
  existing protected-environment rejection stays untouched.

## 6. What this document does NOT do

- No AWS resource, IAM role, secret, or DNS record has been created.
- No database migration has been run, planned, or authorized.
- No adapter code (identity/storage/scanner) has been written — §5 is a
  plan, not a diff.
- No frozen business rule, Approval authority, Finance Control gate, or
  payment-recording behavior is touched.
- The Terraform fixes in §1 are template corrections only — nothing was
  applied to any AWS account.

## 7. Suggested next step

This review found and fixed real, concrete defects (F1, F5, F6, F7 would
each have blocked `apply` or first boot) — the templates are materially
more trustworthy now than before this pass, and `terraform validate` proves
it structurally. The three adapter plans in §5 are scoped enough to become
their own separately-reviewed implementation tasks. Recommended sequencing,
pending your decision: pick one adapter to implement first (Storage and
Scanner are more mechanical and less security-sensitive than Identity;
Identity is the one every login depends on), review that single change on
its own, then proceed to the next — rather than writing all three at once.

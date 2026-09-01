# AIMS P12 Backup, Restore and Disaster-Recovery Decision

Status: DECISION AUDIT COMPLETE / APPLICATION-DOCUMENTATION HARDENING PENDING.

Decision: **B — P12 APPLICATION/DOCUMENTATION HARDENING REQUIRED; NO PROVIDER
SELECTION REQUIRED YET.**

Baseline: `main` at `a9c19ce`, clean worktree, schema 58,
`058_p10_observability_claim_recovery_and_outbox_index`, no migration 059+, P6
through P11 PASS/FROZEN, Production AI OFF, Production Telegram OFF, and no
Redis or scheduler.

## Authority and recovery principles

Backup is not recovery; recovery is not business correction; DR is not an
authority bypass. PostgreSQL remains the sole AIMS financial and business-state
authority. Object storage holds evidence bytes whose trust is valid only when
the corresponding PostgreSQL version, object key, SHA-256 and security state
remain consistent. Infrastructure recovery must preserve all triggers,
constraints, protected functions, ownership and least-privilege roles.

No recovery procedure may directly mark a request `PAID`, insert or change a
ledger entry, consume/release a commitment, force Finance Control `PASS`, insert
Approval history, grant document `CLEAN`, disable segregation of duties, edit a
historical migration or fabricate a Payment. AIMS records externally performed
payments; it cannot infer bank reality from a restored database.

## Persistent-data classification

| Dataset | Classification | Authoritative | Rebuildable | Backup required | Restore criticality | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Payments, payment requests/history and request revisions | AUTHORITATIVE_FINANCIAL / BUSINESS | Yes | No | Yes | Critical | `PAID` and Payment identity must reconcile to external Finance evidence after any historical restore. |
| Financial ledger, budgets, versions, fiscal periods and commitments | AUTHORITATIVE_FINANCIAL | Yes | No | Yes | Critical | Available-budget equation, one ledger effect and commitment state must survive. |
| Finance Context snapshots and financial risk analyses | AUTHORITATIVE_BUSINESS | Yes | No safely | Yes | High | Immutable/current lineage is evidence for downstream decisions. |
| Policy sets, versions, rules, decisions and exceptions | AUTHORITATIVE_BUSINESS | Yes | No safely | Yes | High | Effective rules and deterministic decision history must be preserved. |
| Approval authorities, cases, steps, actions and clarifications | AUTHORITATIVE_BUSINESS / AUDIT | Yes | No | Yes | Critical | Current authority must be reconciled after historical restore. |
| Finance Control authorities, runs, checks, confirmations and exceptions | AUTHORITATIVE_FINANCIAL / AUDIT | Yes | No | Yes | Critical | Cannot be recreated by operational inference. |
| Audit and authentication audit events | AUTHORITATIVE_AUDIT / SECURITY | Yes | No | Yes | Critical | Append-only history must remain visible; recovery gets separate incident evidence. |
| Document metadata, versions, SHA-256, object keys and trust/scan state | AUTHORITATIVE_SECURITY / BUSINESS | Yes | No | Yes | Critical | Metadata alone is insufficient without matching object bytes. |
| Document and Payment-evidence objects | AUTHORITATIVE_BUSINESS / SECURITY | Yes | No | Yes | Critical | Versioned, encrypted object protection and integrity proof required. |
| Users, departments, roles, external identities and operational authorities | AUTHORITATIVE_SECURITY / BUSINESS | Yes | No safely | Yes | Critical | External identity/lifecycle truth must be reconciled after PITR. |
| Server sessions | TRANSIENT / SECURITY | No | Yes | Not required for continuity | Low | Prefer global invalidation and reauthentication after DR rather than reviving old sessions. |
| Approval action tokens, one-time challenges and pending Telegram interactions | TRANSIENT / SECURITY | No | Yes | Database-consistent copy only | High security | Restored tokens must not automatically regain current authority. |
| Telegram bindings, webhook history and notification outbox | OPTIONAL_INTEGRATION_STATE / AUDIT | Partly | Partly | Yes with DB | Medium | Telegram is non-authoritative; duplicate notifications cannot create authority. |
| AI configuration, usage and intelligence run history | OPTIONAL_INTEGRATION_STATE / AUDIT | Usage/history only | Results may be regenerated, history should not be rewritten | Yes with DB | Medium | AI output is advisory; Production AI remains OFF. |
| Worker claims, leases, retries and terminal state | TRANSIENT plus AUTHORITATIVE_SECURITY workflow state | Mixed | Claims are recoverable; terminal history matters | Yes with DB | High | Old workers/tokens must not retain authority against the restored environment. |
| Validation runs/findings/evidence, extractions and clarifications | AUTHORITATIVE_BUSINESS / AUDIT | Yes | No safely | Yes | High | Only current CLEAN evidence lineage can support workflow. |
| Finance Intelligence/Ask runs and reporting projections | DERIVED_REBUILDABLE / OPTIONAL_INTEGRATION_STATE | No financial authority | Yes | Should back up for audit; may rebuild analytics | Low/Medium | Never substitute for PostgreSQL financial truth. |
| Operational metrics/logs | TRANSIENT / OPERATIONAL | No | Yes | Provider policy | Low | P10 telemetry is non-authoritative; separate retention decision applies. |

## PostgreSQL recovery requirements

**PITR: REQUIRED for Production capability.** It addresses accidental deletion,
logical corruption and late discovery better than snapshots alone, but it is
not sufficient DR because object versions and external payment reality must be
coordinated and reconciled. An approved recoverable point and measured window
are required before Go-Live; no numeric RPO is currently approved.

Logical `pg_dump`/`pg_restore` is useful for portable validation, migration
safety, smaller isolated restore tests and forensic extraction. It is not the
sole Production DR mechanism. Production requires provider-neutral capability
for encrypted physical/managed backups, continuous WAL/PITR, integrity
verification, isolated restores and protection from deletion or administrative
compromise. HA/replication improves availability but is not backup; backup is
not HA; PITR alone is not full DR.

Restore validation must prove schema version, migration identity, protected
functions/triggers, ownership, default privileges and runtime-role denial of
DDL/role switching. Restore with the matching application release; a mismatched
schema fails readiness. Forward migrations run only through the controlled
migrator. Historical migrations remain immutable.

## Database and object consistency contract

The recovery unit must bind a PostgreSQL restore point to the corresponding
object snapshot/version set, application release, schema version, configuration
version, timestamp and integrity metadata. A provider-neutral recovery manifest
is therefore required.

- DB metadata plus missing object: evidence unavailable and untrusted; stop the
  affected workflow and reconcile. Never silently preserve `CLEAN` usability.
- Object plus missing DB row: orphan only; never auto-attach or promote it.
- Hash, size or object-version mismatch: fail closed; no evidence access or AI
  use until an authorized reconciliation path proves integrity.
- Object point newer than DB: treat additional objects as orphans pending
  reconciliation.
- Object point older than DB: metadata references may be unresolved; fail
  closed and restore the correct version or escalate.
- Restored `CLEAN` evidence: verify exact object version and SHA-256. Conditional
  rescan policy remains a Security/provider decision based on elapsed time,
  signature evolution, immutability evidence and incident type. Restore never
  grants `CLEAN`.

Production object storage must provide private access, encryption, versioning,
integrity metadata, retention/immutability controls, audit logs, isolated restore
and exportability. Cross-region copy is conditional on approved RTO/RPO,
residency and threat model; it is not assumed now.

## Financial restore invariants and external payment reality

Every restore must deterministically confirm:

- each Payment maps to exactly one request, approved case, Finance Control run,
  consumed commitment and ledger entry;
- `PAID` exists only with its immutable Payment, and no duplicate Payment,
  ledger effect, command identity or scoped bank reference exists;
- commitment consumption/release remains consistent;
- the available equation remains valid from authoritative budget version,
  actual ledger and active commitments;
- Approval and Finance Control history/current lineage remain present;
- audit history is readable and append-only.

A historical restore can predate an externally executed bank payment or a
revocation/authority change. AIMS must not infer missing Payment history or
auto-mark `PAID`. Finance Operations must reconcile the restored point against
verified external payment evidence and current authority/lifecycle sources.
Existing Payment idempotency and authorization remain mandatory. A future
controlled recovery/reconciliation workflow may be necessary; direct database
repair is forbidden. This is a P12 application-hardening gap, not permission to
implement a bank API or reversal/refund feature.

## RPO, RTO and recovery tiers

Approved numeric RPO: **NO**. Approved numeric RTO: **NO**. Numeric targets must
not be inferred from provider defaults.

| Tier | Data/service | RPO source | RTO source | Requirement |
| --- | --- | --- | --- | --- |
| 1 | Payment, ledger, commitments, `PAID`, Approval/Finance Control and audit | Finance control, business, compliance; deterministic consistency at a chosen restore point | Business continuity / Finance / SRE | Highest integrity; external reality reconciliation mandatory. |
| 2 | Documents/evidence and security/identity history | Security, compliance and Finance policy | Business / Security / provider evidence | Coordinated object/DB recovery; fail closed on mismatch. |
| 3 | Request workflow, policy, validation and operational configuration | Business decision | Company standard / infrastructure evidence | Restore complete lineage and current state. |
| 4 | Sessions, tokens, outbox and optional integrations | Security/company policy | Operational decision | May invalidate/rebuild; must prevent replay or stale authority. |
| 5 | Derived analytics and operational telemetry | Company retention policy | Operational decision | Rebuild where safe; never replace authoritative data. |

Zero-loss cannot currently be claimed. For externally completed financial acts,
the safe requirement is deterministic consistency at the selected recovery
point plus post-restore reconciliation with external Finance reality. Achieving
a business-approved near-zero window would require proven synchronous durable
commit, continuous WAL durability, protected coordinated object versions and
tested failover—not an unverified statement in application documentation.

## Recovery scenarios

| Class / scenario | Backup | PITR | Object restore | Reconciliation | Owner | Current readiness |
| --- | --- | --- | --- | --- | --- | --- |
| R1 single-row/application mistake | Often no; use normal workflow | Only for proven corruption, into isolation first | No unless evidence affected | Business/financial if authoritative | Backend + Finance | Workflow correction exists; no generic recovery workflow. |
| R2 accidental DB deletion/corruption | Yes | Yes | If cross-store consistency affected | Full invariants | DBA + Incident Commander | Not implemented/rehearsed. |
| R3 database instance loss | Yes | Yes | Verify coordinated point | Full invariants | DBA/SRE | Provider capability absent. |
| R4 object loss/corruption | Object backup/versioning | DB PITR usually no | Yes | Hash/trust/object manifest | Security + SRE | Production store absent. |
| R5 DB/object inconsistency | Both | Possibly | Yes | Mandatory, fail closed | DBA + Security + Backend | Checker/manifest absent. |
| R6 deployment failure | Immutable artifact/manifest | Only if data corruption occurred | Usually no | Schema/config/readiness | SRE + DBA | P13/P17/P18. |
| R7 secrets/credential loss | Secret-manager recovery, not DB dump | No | No | Revoke/rotate/rebind | Security + Platform | Provider unselected. |
| R8 worker/process failure | Durable DB state | No | Verify dependencies | Claims/leases/outbox | SRE + Backend | P7 recovery foundation exists; supervision is P13. |
| R9 zone/site failure | HA plus backup | Yes | Provider failover/restore | Full | Incident Commander + SRE | Architecture decision open. |
| R10 regional/provider outage | Isolated/cross-region copy if approved | Yes | Cross-region if approved | Full | Incident Commander | RTO/RPO/residency decision open. |
| R11 ransomware/malicious admin | Immutable isolated copies | Yes, from trusted point | Yes, immutable clean point | Security/forensic/full | Security + Incident Commander | Isolation/immutability absent. |
| R12 delayed logical corruption | Long-enough protected history | Yes | Coordinated historical versions | Full and external reality | DBA + Finance + Security | Retention and PITR window undecided. |

## Backup security and administrative separation

Backups require TLS in transit, strong encryption at rest, separate key access,
audited break-glass restore access and proof that restore keys remain recoverable.
Losing encryption keys can make every backup unusable, so key recovery must be
tested independently without placing plaintext keys in backups.

The application runtime, Finance/Payment/document executors and migrator must
not receive backup administration. Conceptual duties are separated among backup
operator, restore operator, DBA/SRE, Security and an Incident Commander, with
Finance Operations approval for financial recovery. No new database role is
justified during this audit. Backup copies should be deletion-protected and
isolated from the application/primary administrative trust domain; immutable
copies or equivalent provider controls are required against ransomware and
malicious administration.

Production backup restore into non-Production is prohibited by default because
it exposes real financial, identity and document data. Validation requires an
isolated, access-controlled restore environment approved by Security/data owner.
Masking may support non-DR testing only when it does not invalidate the proof
being exercised.

## Secrets, sessions, tokens and optional integrations

Secrets are recovered from the approved secret manager and rotated/reissued
after compromise; they do not belong in PostgreSQL/object backups or reports.
Restore environments use non-Production secrets and endpoints.

Active sessions should be globally invalidated after DR and users reauthenticate
unless a separately approved security policy proves safe continuity. Restored
action tokens, Telegram challenges, claim tokens and nonces must not regain
authority merely because their historical database state says active. Current
identity/authority and environment generation must be revalidated; a repository
design for global post-restore invalidation is required.

AI and Telegram remain OFF during restore validation. Restored Telegram outbox
rows can cause duplicate notification attempts, but Approval actions still need
current authority and valid tokens. Outbox/worker claims require safe expiry or
generation invalidation before workers resume. Optional provider history has
audit value but no financial authority.

## Restore-safe startup and validation

Restore-safe startup is required conceptually:

1. Declare incident, authorize recovery and freeze traffic/mutations.
2. Preserve compromised state for forensics when Security requires it.
3. Select a trusted recovery manifest, matching application artifact and clean
   credentials.
4. Restore PostgreSQL and the bound object versions into an isolated target.
5. Keep AI, Telegram, outbound alerts and workers disabled; use only isolated
   object storage, IdP and secrets.
6. Verify schema 58 (or the manifest version), migration identity, protected
   functions/triggers, ownership/default privileges and runtime-role denials.
7. Run a non-mutating restore checker for financial, audit, authority,
   token/lease/outbox and document/object invariants.
8. Reconcile the recovery point with current external identity and Finance
   payment reality.
9. Start API in controlled maintenance/read-only posture where available.
10. Invalidate unsafe sessions/tokens/claims, verify object/scanner readiness,
    then start workers under a new environment generation.
11. Obtain DBA, Security, Finance Operations and Incident Commander approval;
    resume traffic and record separate recovery incident evidence.

The current repository has strong deterministic integration queries, schema
readiness and P6 role/trigger proofs, but no single provider-neutral restore
checker, manifest verifier or read-only reconciliation report. These are
**REQUIRED** P12 application/documentation hardening outputs. They must remain
read-only and non-sensitive and must never repair data.

## Backup and restore observability

Future infrastructure must expose backup success/failure, age/last successful
point, WAL/PITR continuity, object-version/replication failure, immutable-copy
health, restore-test result and integrity-verification failure. These are
provider/infrastructure-owned inputs for P13 deployment using the frozen P11
contract model. Their absence does not reopen P10 or authorize a P11 runtime
change.

## Retention, privacy and forensics

No numeric retention is approved or invented. Financial, Payment, ledger,
audit, document/evidence, AI/Telegram history, operational logs and backup
retention require separate Finance, Legal/Compliance, Security and company
standards. Retention must permit discovery of delayed corruption while meeting
privacy, deletion/legal-hold and residency obligations. Security decides when
compromised state must be preserved for forensics before recovery.

## Required pre-Production evidence

Before Go-Live, AIMS requires an actual protected backup, isolated database and
object restore, matching application boot, privilege/trigger verification,
financial and document reconciliation, worker/token/outbox recovery proof,
runbook exercise, measured restore duration and measured recoverable data-loss
window. P17 provides a Production-like RC target; P18 owns the timed full
recovery/rollback rehearsal; P19 reviews evidence; P20 remains blocked without
acceptance.

## P12 hardening scope and phase boundaries

P12 may next be separately authorized to create only provider-neutral:

- a typed recovery-manifest specification and validation;
- a strictly read-only, non-sensitive restore checker/reconciliation report;
- restore-safe startup and global token/session/claim invalidation design;
- backup/restore/DR runbooks, invariant queries and tests using disposable
  environments;
- governance and evidence templates.

P13 owns actual managed backup/PITR, object versioning/replication, network/TLS,
secret-provider integration, collection/evaluation/routing and deployment. P15
owns runtime capacity, while measured restore duration is P12/P18 evidence. P16
owns Finance acceptance criteria; P17 owns staging RC; P18 owns the timed DR
rehearsal. No provider selection is required to begin the scoped P12 hardening,
but RPO/RTO, retention, residency, platform, cost and named ownership decisions
block Production completion.

## Risk classification and decision

- **Current application defects:** none proven by this read-only audit.
- **P12 implementation gaps — Critical for Go-Live:** no coordinated protected
  backup/restore proof; no application-specific restore checker/manifest and no
  external-payment reconciliation procedure.
- **P12 implementation gaps — High:** no restore-safe startup/token-generation
  contract; no complete role-based runbook; no DB/object consistency proof.
- **Production external gates — Critical/High:** Production PostgreSQL/object
  providers, PITR/versioning/immutability, isolated restore environment and
  rehearsal are absent.
- **Company decisions:** numeric RPO/RTO, retention/legal hold, residency,
  cross-region model, restore authorization, on-call ownership and cost tolerance.
- **Medium:** optional-integration/outbox replay and conditional rescan policy
  require final company/provider evidence.
- **Low:** local filesystem/Docker persistence is development convenience only
  and provides no Production recovery evidence.

Decision B is selected because meaningful provider-neutral repository hardening
can proceed safely without choosing a vendor or inventing RPO/RTO. Decision A is
unsupported because restore verification tooling and runbooks are absent.
Decision C is too restrictive because external decisions block Production but
not the scoped checker/manifest/runbook work. Decision D is unsupported because
the current PostgreSQL authority, immutable financial controls and fail-closed
document trust model are fundamentally recoverable when the identified gaps are
closed.

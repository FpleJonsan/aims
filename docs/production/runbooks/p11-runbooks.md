# AIMS P11 Provider-Neutral Operational Runbooks

Status: IMPLEMENTED / FROZEN REVIEW PENDING.

These runbooks are safe first-response contracts, not provider routing or
authorization to alter AIMS state. Use bounded operational signals and the
authoritative audit trail. Never place credentials, tokens, raw SQL/errors,
business identifiers, payee/purpose, amounts, bank references, documents or
filenames into incident systems.

## Universal prohibited actions

Never directly update request status, mark PAID, insert ledger entries, consume
commitments, create Approval, force Finance Control PASS, disable segregation
of duties/triggers, grant an executor role to the application, change document
trust, bypass Payment idempotency or edit a historical migration. Financial
correction requires a separately approved future reversal/correction workflow.

## API availability and readiness

- **Purpose/signal:** API target/liveness, required readiness, HTTP error and
  latency signals.
- **Impact:** users may be unable to access AIMS or a required dependency may
  be unavailable.
- **Safe verification:** check target/liveness/readiness, bounded component,
  deployment/version and safe recent operational categories.
- **Likely classes:** process/deployment failure, DB/provider readiness,
  resource pressure or schema mismatch.
- **First response:** determine target absence versus dependency degradation;
  correlate with the current deployment and component runbook.
- **Recovery:** target and all required readiness components are healthy;
  evidence-based error/latency conditions clear.
- **Escalation:** SRE, then Backend/component owner.
- **References:** P10 metrics catalogue; P13 deployment/rollback procedure when
  available.
- **Prohibited:** do not bypass readiness or alter business state.

## Schema mismatch

- **Purpose/signal:** schema readiness differs from expected version 58.
- **Impact:** runtime/database contract is incompatible.
- **Safe verification:** read the bounded readiness result and approved
  deployment/migration record; verify environment identity.
- **Likely classes:** incomplete promotion, wrong database or unexpected
  migration.
- **First response:** stop promotion and involve DBA/SRE. Follow the approved
  migration/forward-fix process only after environment and authorization checks.
- **Recovery:** runtime observes schema 58.
- **Escalation:** DBA + SRE.
- **References:** migration inventory and future P13/P17 deployment runbook.
- **Prohibited:** never auto-run, edit or manually simulate migrations.

## Database unavailable or degraded

- **Purpose/signal:** DB readiness, pool waiting, timeout/lock or executor
  failure signals.
- **Impact:** AIMS may be unavailable; Finance Control or Payment may be unable
  to execute.
- **Safe verification:** use bounded pool/component/failure categories and the
  managed-service/platform health surface; do not capture SQL or parameters.
- **Likely classes:** connectivity, capacity, lock contention, credentials/TLS,
  managed-service failure or executor privilege drift.
- **First response:** distinguish full outage, pool pressure and executor-only
  failure; preserve transaction integrity and involve the DBA.
- **Recovery:** connectivity/readiness/executors succeed and degraded metrics
  return to their approved range.
- **Escalation:** DBA + SRE; add Backend and Finance Operations for Finance
  Control/Payment impact.
- **References:** P6 runtime-role contract and future hosting/rollback runbook.
- **Prohibited:** no privilege grants, role switching, raw SQL repair or direct
  financial mutation.

## Worker unavailable and backlog

- **Purpose/signal:** worker target/readiness, backlog/age, terminal work and
  authoritative lease-recovery rate.
- **Impact:** documents or enabled optional delivery work may be delayed.
- **Safe verification:** distinguish target loss, idle/zero backlog, aging work,
  terminal work and provider failure.
- **Likely classes:** process crash, provider stall, capacity, poison work or
  deployment/configuration failure.
- **First response:** restore supervised worker capability; inspect only bounded
  workload categories; reconcile terminal work through approved procedures.
- **Recovery:** worker is ready and age/growth/terminal conditions clear.
- **Escalation:** SRE + Backend; Security for document terminal failure.
- **References:** P7 worker contract and P10 metrics catalogue.
- **Prohibited:** do not steal claims, forge tokens or directly change trust.

## Document terminal processing and scanner storage

- **Purpose/signal:** terminal scan backlog and scanner/storage readiness or
  bounded failure categories.
- **Impact:** evidence remains unavailable and the workflow fails closed.
- **Safe verification:** confirm provider readiness, queue state and integrity
  categories without accessing document content/filenames.
- **Likely classes:** storage outage/integrity failure, scanner timeout/outage or
  exhausted processing attempts. Normal REJECTED is not infrastructure failure.
- **First response:** contain provider failure, preserve quarantine and restore
  approved processing capability.
- **Recovery:** provider and worker are healthy; terminal work is reconciled;
  only properly scanned CLEAN evidence is trusted.
- **Escalation:** Security + Backend + SRE.
- **References:** P3/P4 document trust and P7 worker contracts.
- **Prohibited:** never promote trust directly or bypass CLEAN verification.

## Authentication and security patterns

- **Purpose/signal:** approved patterns of auth, CSRF/origin, webhook/action,
  forbidden-authority or Payment-mismatch outcomes.
- **Impact:** integration defect, abuse or attempted authority bypass.
- **Safe verification:** use bounded categories and environment/service only;
  coordinate with Security before interpreting user mistakes as attacks.
- **Likely classes:** client defect, stale integration, malicious automation,
  configuration or identity lifecycle failure.
- **First response:** contain the source through approved edge/session controls,
  preserve audit evidence and assess affected authority.
- **Recovery:** pattern stops and Security confirms containment.
- **Escalation:** Security + SRE + Backend.
- **References:** P1/P5/P9 security boundaries and future incident policy.
- **Prohibited:** never expose tokens/identities or weaken authorization.

## Finance Control infrastructure failure

- **Purpose/signal:** technical domain/executor failure. Deterministic FAIL or
  HOLD is explicitly not an incident.
- **Impact:** approved work cannot reach Payment readiness.
- **Safe verification:** distinguish legitimate control result from DB,
  executor, concurrency or configuration failure.
- **Likely classes:** DB/executor outage, stale runtime deployment or repeated
  internal technical failure.
- **First response:** preserve the control result and commitment; involve
  Backend/DBA without bypassing the gate.
- **Recovery:** current authorized Finance Control execution succeeds and
  invariants remain valid.
- **Escalation:** Backend + DBA + Finance Operations.
- **References:** Finance Control trust-boundary documentation.
- **Prohibited:** never force PASS or readiness.

## Payment infrastructure and integrity

- **Purpose/signal:** technical Payment/executor/rollback failure, approved
  payload-mismatch pattern or abnormal replay rate.
- **Impact:** payment recording may be unavailable or integrity may need
  reconciliation. A valid replay remains successful recovery.
- **Safe verification:** use bounded outcomes only; reconcile Payment, ledger,
  commitment and PAID invariants through authorized read paths.
- **Likely classes:** DB/executor outage, transaction rollback, client response
  loss, stale integration or security-sensitive mismatch pattern.
- **First response:** stop unsafe retries when integrity is uncertain; involve
  Finance Operations/DBA/Backend; use the original idempotency command for
  legitimate response-loss replay.
- **Recovery:** technical path is healthy and authoritative records reconcile.
- **Escalation:** Backend + DBA + Finance Operations; Security for mismatch
  patterns.
- **References:** Payment trust, idempotency and financial stop-the-line rules.
- **Prohibited:** no manual Payment/ledger/commitment/PAID mutation and no
  idempotency bypass.

## Optional Telegram and AI provider degradation

- **Purpose/signal:** enabled-only provider outcomes, delivery backlog/age or AI
  timeout/schema failure.
- **Impact:** Telegram convenience or AI assistance degrades; core Web Approval
  and deterministic/manual workflows remain available.
- **Safe verification:** first verify the feature is enabled. OFF means no
  provider incident. Use only bounded provider/failure categories.
- **Likely classes:** provider outage/rate limit, credentials/configuration,
  network timeout or malformed response.
- **First response:** direct users to Web/manual workflow and investigate the
  separately approved provider.
- **Recovery:** enabled provider success and backlog/response behavior recover.
- **Escalation:** relevant integration owner + Backend/SRE.
- **References:** P8 AI and P9 Telegram governance.
- **Prohibited:** do not enable a feature, expose provider payloads or elevate
  optional failure into financial authority.

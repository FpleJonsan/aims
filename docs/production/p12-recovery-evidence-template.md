# AIMS Provider-Neutral Recovery Evidence

Do not record credentials, tokens, connection strings, payee, purpose, financial amounts, bank references, filenames, document bytes, raw SQL, provider payloads or session/action secrets.

## Identification

- Test/incident identifier:
- Environment classification:
- Recovery authorization reference:
- Incident Commander:
- Evidence recorder:
- Manifest reference and version:
- Application release:
- Started at / completed at:

## Restore evidence

- Database recovery reference (provider attestation required):
- Selected database recovery point:
- Latest recoverable point observed:
- Object recovery reference (provider attestation required):
- Manifest integrity/attestation reference:
- Observed data-loss-window evidence:
- Externally approved RPO target, if supplied:
- Actual restore duration:
- Externally approved RTO target, if supplied:

## Schema and recovery generation

- Schema version / latest migration:
- Generation before advancement:
- Privileged advancement authorization/correlation reference:
- Generation after advancement:
- Append-only generation-history result:
- Ordinary runtime/executor advance denial result:

## Read-only checker

- Invocation/evidence reference:
- Overall status:
- Resume recommendation:
- Schema/P6 privilege checks:
- Read-only before/after proof:
- Bounded/truncated findings:
- Tool execution safety deadline/cancellation result (not RTO):
- Database acquisition / remaining-deadline statement-timeout result:
- CLEAN coverage — eligible / processed / failed / unverified / complete:
- Object enumeration — processed / orphan count / coverage complete:
- Complete-key lexical ordering / cursor monotonicity / prefix-collision proof:
- Incremental `opendir` / maximum retained candidate / abort cleanup proof:
- Restored database and object dataset freeze evidence:
- Pagination/cursor anomaly result:
- Zero outbound proof:

## Reconciliation

- Payment/ledger/commitment/PAID result:
- Reverse PAYMENT ledger → exact Payment result:
- Reverse consumed commitment → exact Payment result:
- CONSUMED commitment with null/missing Payment-link count:
- Orphan/extra financial-effect count:
- Approval/Finance Control lineage result:
- Budget/Available/currency result:
- Active-budget scopes / scopes with exactly one active version / incomplete scopes:
- Deterministic Payment command version/fingerprint result:
- Scoped normalized bank-reference uniqueness result (never record raw value):
- Consumed-commitment/double-reduction result:
- External payment reconciliation owner/status/evidence reference:
- CLEAN document hash/size/object result:
- Orphan enumeration result or NOT_VERIFIABLE reason:
- Identity/current-authority reconciliation:
- Sessions/action credentials/Telegram pending state:
- Document claims/leases/retries:
- Outbox status and duplicate-notification review:

## Restored P6 trust boundary

- Role attributes and exact memberships:
- Database owner and CONNECT ACL:
- Schema owner, USAGE and CREATE ACL:
- Relation/function owners:
- PUBLIC table, sequence and function ACLs:
- Finance/Payment/document-worker exact function allowlists:
- Missing required / unexpected effective executor-function counts:
- Recovery-generation advance authority:
- SECURITY DEFINER owner, search path and ACL:
- `aims_owner` exact default privileges (owner/schema/class/grantee/privilege/grant option):
- Restored P6 manifest result:

## Resume approval

- Remaining exceptions and owners:
- Finance Operations approval:
- Security approval:
- SRE/DBA approval:
- Human recovery approval:
- API start evidence:
- Worker start evidence:
- Outbound integration decision (AI and Telegram remain OFF unless separately approved):
- Traffic resume evidence:

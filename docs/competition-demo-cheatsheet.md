# AIMS Competition Demo Cheat Sheet

## Personas

| Demo role | Identity | Local subject | Use |
| --- | --- | --- | --- |
| Requester | Ethan Teo | `competition.requester.technology` | Clarification `PAY-2026-000003` |
| Finance Analyst | Daniel Lim | `demo.finance` | Context, risk, policy |
| Manager Approver | Sarah Lee | `competition.manager` | First approval step |
| Director Approver | Adrian Ng | `competition.director` | Second approval step |
| Finance Controller | Michael Wong | `competition.controller` | Final Finance Control |
| Payment Operator | Nora Ismail | `competition.payment` | Payment Queue |
| Reporting Manager | Grace Chen | `competition.reporting` | Dashboard, Finance Watch, Ask AIMS |
| ADMIN for Q&A | Technical Administrator | `competition.admin` | Prove ADMIN has no operational Finance authority |

## Tickets and numbers

| Ticket | Story | Starting state |
| --- | --- | --- |
| `PAY-2026-000001` | Normal MYR 8,500 request | Pending Approval |
| `PAY-2026-000002` | BrightWave MYR 85,000, Human Final Risk HIGH, Manager → Director | Pending Approval |
| `PAY-2026-000003` | CloudSphere invoice clarification | Needs Clarification |
| `PAY-2026-000004` | Prime Facilities MYR 36,000 | Paid |
| `PAY-2026-000009` | Controlled request with no payment record | Ready for Payment |

Budget **MYR 500,000** − Actual **MYR 180,000** − Commitments **MYR 70,000** = Available **MYR 250,000**. Attention: High/Critical **1**, Pending Approval **2**, Finance Hold **0**, Ready for Payment **1**, Paid records **5**. Top payee: Prime Facilities **MYR 65,000**.

## Pre-demo reset

```bash
AIMS_ENVIRONMENT=competition npm run reset:competition
AIMS_ENVIRONMENT=competition npm run seed:competition
AIMS_ENVIRONMENT=competition npm run verify:competition-data
AIMS_ENVIRONMENT=competition npm run dev:competition:api
npm run dev
```

Use one window and one tab. Default to deterministic AI mode. Prepared Ask AIMS question: **Which department needs the most financial attention?**

## 15–30 minute pre-flight

- [ ] PostgreSQL and Redis running
- [ ] Competition reset, seed and verification PASS
- [ ] API readiness healthy; frontend loads without console errors
- [ ] Requester, Finance, Approver, Controller and Payment Operator logins work
- [ ] Tickets `000002`, `000003`, `000004`, `000009` open correctly
- [ ] Financial totals and attention counts match this sheet
- [ ] AI mode and network status known; no live call required
- [ ] Browser zoom/scale correct; developer tools hidden
- [ ] Notifications and screen-sharing distractions disabled
- [ ] Demo script and this sheet available off-screen

If any required ticket or number differs, stop and reset—do not repair data manually.

## Emergency fallbacks

- Identity switch fails → sign out, reload once, select the same named identity.
- Queue is slow/empty → use the known ticket from another authorized in-product list.
- Live AI fails → show the safe unavailable state and deterministic dashboard evidence.
- Approval mutation fails → do not debug; use preseeded `000009` and `000004` downstream states.
- Controller/Payment view fails → show the corresponding request history from Finance.
- Network/provider unavailable → run deterministic mode; the controlled workflow remains the demo.
- Timing exceeds 10 minutes → skip New Request, Manager persona switch and live Ask AIMS submission.

## Authority vocabulary

**SYSTEM CALCULATED** financial truth · **AI ADVISORY / INTERPRETATION** · **HUMAN DECISION** · **POLICY DECISION** · **APPROVER DECISION** · **FINANCE CONTROL** · **PAYMENT RECORD**.

Never say AIMS pays suppliers, AI approves, AI calculates budget, ADMIN can do everything, or Ready for Payment means a transfer happened.

## Judge Q&A — 15 seconds / 45 seconds

**Why AI?** 15s: “Rules enforce known controls; AI helps interpret documents, patterns, risk context and management questions.” 45s: “AIMS separates interpretation from authority. AI finds and explains evidence; deterministic calculations, human final risk, Policy, Approval and Finance Control remain authoritative.”

**What if AI is wrong or off?** 15s: “AI is advisory; the entire controlled workflow continues without it.” 45s: “Financial calculations remain deterministic, Finance owns final risk, Policy owns routing, humans approve, and Finance Control gates readiness. AI improves speed, not correctness or authority.”

**Can AI approve or pay?** 15s: “No. Humans approve; external banking executes payment; AIMS records the controlled evidence.” 45s: “AI cannot change workflow state. Approval requires scoped business authority, Finance Control is a separate final gate, and a Payment Operator records an externally executed transfer.”

**How do you prevent duplicate payment?** 15s: “Finance Control checks duplicates and payment recording is transactional and idempotent.” 45s: “AIMS rechecks duplicate evidence at the final gate, binds payment to a current authorized request, and uses replay-safe database operations so retries cannot create a second payment or ledger posting.”

**How do you prevent unauthorized approval?** 15s: “Every approval is checked against active role, scope, amount and sequence.” 45s: “Technical roles alone grant nothing. Backend and database checks enforce department or organization scope, amount bounds, active authority, current evidence and the active sequential step.”

**Why PostgreSQL?** 15s: “It is the authoritative transactional boundary for workflow, audit and financial consistency.” 45s: “Application services express the business flow, while PostgreSQL transactions, constraints, restricted executor roles and terminal-state guards protect payment, commitments, ledger and concurrency invariants.”

**How is Available calculated?** 15s: “Approved budget minus actual ledger minus active commitments.” 45s: “AIMS uses integer minor units and authoritative records: MYR 500,000 minus MYR 180,000 actual minus MYR 70,000 active commitments equals MYR 250,000 available.”

**What happens after payment?** 15s: “AIMS records evidence, posts actual, consumes the commitment and marks the request Paid atomically.” 45s: “The bank is the execution channel. The authorized Payment Operator records the external result; one transaction creates the immutable payment and ledger link, consumes the reservation and completes request history.”

**Can departments see each other?** 15s: “Only where explicit reporting or operational scope permits it.” 45s: “Requester projections are owner-scoped. Approval, control, payment and reporting each use independent department or organization authorities, preventing technical-role access from becoming business access.”

**Can ADMIN bypass controls?** 15s: “No. ADMIN manages technical configuration; it does not imply Finance authority.” 45s: “The demo ADMIN has no Approval, Finance Control, Payment or Reporting authority. Operational authority is explicit and database-protected.”

**How is audit maintained?** 15s: “Every material action produces append-only history with actor and correlation context.” 45s: “Requests retain validation, context, risk, policy, approval, control and payment history. Append-only audit and immutable financial records make decisions traceable without exposing sensitive payment details.”

**How does AIMS learn?** 15s: “It builds governed financial intelligence from authorized evidence and measured outcomes.” 45s: “Finance Watch and Ask AIMS interpret bounded reporting evidence and usage history. Learning does not rewrite authoritative balances, policies or decisions; improvements remain governed and reviewable.”

## Architecture if asked

Frontend → NestJS API → domain/application services → PostgreSQL authoritative state. Optional AI provider interprets controlled evidence. External banking remains the payment execution channel.

## Frozen release notes

Competition release scope: Requester Portal, Finance Command Center, the 12-stage governed workflow, deterministic Finance Context and Policy, advisory AI Financial Risk, accountable human assessment, sequential Approval, Final Finance Control, external payment recording, immutable Payment History, Finance Dashboard, Finance Watch / Ask AIMS, AI OFF continuity, segregation of duties, and the PostgreSQL financial trust boundary.

**Known issue `RT-LOW-001`:** the Work Queue frontend traverses at most 10,000 authorized records per load. Severity is LOW; competition, security, workflow, and financial-integrity impact are none. Scalability work is deferred until after the competition.

**Readiness boundary:** Competition Ready is **YES**. Production Ready is **NO**. Production still requires trusted identity/OIDC, production object storage with malware controls, secrets management, TLS and deployment hardening, backup/restore rehearsal, worker monitoring, and production executor credential provisioning and rotation.

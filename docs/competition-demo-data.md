# AIMS Competition Demo Data

This dataset is an isolated, synthetic competition workspace. It uses the database `aims_competition`; the reset and seed commands refuse production and require `AIMS_DEMO_MODE=true`. It never resets the normal `aims` database.

## Rebuild

PostgreSQL and Redis must already be running. From the repository root:

```bash
AIMS_DEMO_MODE=true npm run reset:competition
AIMS_DEMO_MODE=true npm run seed:competition
AIMS_DEMO_MODE=true npm run verify:competition-data
```

Reset-before-seed is intentional. A second seed without reset is refused, preventing duplicate budgets, payments, ledger entries, commitments, and approvals. Start the guarded competition API with `AIMS_DEMO_MODE=true npm run dev:competition:api`. It reuses credentials from `.env` but forcibly targets `aims_competition`; the normal URLs in `.env` are not modified.

## Demo identities

| Identity | Subject | Responsibility |
| --- | --- | --- |
| Amelia Tan | `demo.requester` | Operations requester |
| Maya Rahman | `competition.requester.marketing` | Marketing requester |
| Ethan Teo | `competition.requester.technology` | Technology requester |
| Daniel Lim | `demo.finance` | Finance analyst and human final-risk authority |
| Sarah Lee | `competition.manager` | Department Manager approver |
| Adrian Ng | `competition.director` | Director approver |
| Michael Wong | `competition.controller` | Final Finance Controller |
| Nora Ismail | `competition.payment` | Payment Operator |
| Grace Chen | `competition.reporting` | Organization reporting user |
| Technical Administrator | `competition.admin` | Policy administration only; ADMIN is not operational Finance authority |

All identities and evidence are fictional. No passwords, bank accounts, real invoices, or secrets are stored.

## Scenario cheat sheet

| Scenario | Ticket | Starting state | Why show it |
| --- | --- | --- | --- |
| A — Normal | `PAY-2026-000001` | Pending Approval | Routine MYR 8,500 Operations request with one Manager step |
| B — High Risk | `PAY-2026-000002` | Pending Approval | MYR 85,000 Marketing request; deterministic AI advisory, human HIGH final risk, Manager then Director route |
| C — Clarification | `PAY-2026-000003` | Needs Clarification | Technology invoice service period needs a corrected document |
| D — Paid | `PAY-2026-000004` | Paid | Complete MYR 36,000 controlled lifecycle and synthetic external payment evidence |
| Ready for Payment | `PAY-2026-000009` | Ready for Payment | Finance Control passed, but no payment has been recorded |

Payment History contains five controlled paid requests (`PAY-2026-000004`–`000008`) across May–August 2026. Each was created through Validation, Finance Context, human risk, deterministic Policy, Approval, Finance Control, and Payment services.

## Financial story

| KPI | MYR |
| --- | ---: |
| Active budget | 500,000.00 |
| Actual ledger | 180,000.00 |
| Active commitments | 70,000.00 |
| Available | 250,000.00 |

Reconciliation: `500,000 − 180,000 − 70,000 = 250,000`. Company-wide position is healthy while the large Marketing request creates a focused pressure story.

## AI ON and OFF

Scenario B stores a deterministic, evidence-backed AI advisory through the existing analysis service. Daniel Lim still supplies the authoritative human final risk; AI never approves or moves workflow state. The other scenarios use the manual path and prove the same workflow remains usable with AI disabled. No live provider call is required by the seed.

Recommended Ask AIMS questions:

- Which department needs the most financial attention?
- What are the highest-risk pending requests?
- How much budget is currently available?
- Which payees received the most spending this period?

Answers must be generated from authorized reporting evidence; no canned answers are seeded.

## Before presenting

1. Rebuild and verify the isolated dataset with the commands above.
2. Start API and frontend with all three database URLs targeting `aims_competition`.
3. Check API readiness.
4. Sign in with the relevant local subject.
5. Confirm the ticket states and financial reconciliation in this guide.

Date assumption: fiscal period and historical reporting data are intentionally fixed to calendar year 2026 for the August 2026 competition snapshot. If the demo is reused in another fiscal year, rebuild the input dataset for that period rather than changing reporting formulas.

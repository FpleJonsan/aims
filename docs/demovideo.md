# AIMS Competition Demo Video — Production Runbook

PROJECT = AIMS
VIDEO = Competition Demo
RELEASE BASELINE = v1.0.0-rc3 (HEAD `29511f3`, tag `v1.0.0-rc3`, working tree clean at rehearsal time)
STATUS = FINAL VIDEO REHEARSAL COMPLETE — FULL HAPPY PATH VERIFIED LIVE END-TO-END (PAY-2026-000040); DEMO CRITICAL CORRECTION = PASS; FINAL VIDEO REHEARSAL = PASS; COMPETITION VIDEO PRODUCTION = READY
TARGET DURATION = approximately 4 minutes
PRIMARY POSITIONING = AI-Powered Payment & Finance Control

Last Updated: 2026-09-15
Rehearsal Status: Complete — full 12-stage workflow exercised live against the real local `aims` database, real AI provider, real UI, across three initial rehearsal requests (PAY-2026-000037/038/039), prior UAT evidence (PAY-2026-000036), and one final video rehearsal request (**PAY-2026-000040**, see §24) that reached PAID end-to-end after the §14a corrections.
Video Production Readiness: the two Critical blockers in §18 are **fixed and live-verified** (2026-09-15, see §14a and §24). The final video rehearsal (§24) completed the entire planned happy path — Request → AI Financial Analysis → Human Finalize → Policy Justification → Approval → Final Finance Control → real duplicate-payment confirmation → PAID → Dashboard → Ask AIMS — on one fresh request, live. **Do not begin final recording or create the final recording request yet** — that is a separate, subsequent step for the Product Owner / ChatGPT storyboard pass (see §24.9).

This document is the single source of truth for producing the AIMS competition video. It assumes no memory of the rehearsal conversation — every fact below was independently verified against the live system on 2026-09-15.

---

## 1. Video Objective

AIMS must be presented first as **AI-Powered Payment & Finance Control**. AI assistance is the primary competition emphasis, but AIMS must not look like "a payment workflow with ChatGPT added."

Product story:

> Human submits → AI understands → System calculates → AI analyzes → Human decides → Finance controls → Payment occurs externally → AIMS records → AI explains

The audience should come away understanding:
- AI improves understanding and decision support.
- Deterministic systems protect financial truth.
- Humans retain financial authority.

## 2. Mandatory AI Governance Messages

Use these lines verbatim in narration or on-screen text — they are lifted directly from the product's own UI copy, verified live:

- "AI interprets. The system calculates."
- "AI assists decisions. Humans retain authority."
- "AI never approves payments."
- "Approved does not mean Ready for Payment."
- "AIMS does not transfer money. It controls and records the payment." — verified verbatim UI copy at Stage 8/9: *"AIMS DOES NOT EXECUTE BANK TRANSFER · EXTERNAL PAYMENT IS RECORDED"*.

**Never present AI as:** a budget calculator, an approval authority, a policy authority, Finance Control authority, a payment executor, or a ledger authority. The UI itself enforces this — every AI output is labeled "AI ADVISORY" and every deterministic output is labeled "SYSTEM CALCULATED" or "HUMAN DECISION" or "POLICY DECISION", verified live on every request detail page.

## 3. AI Showcase Priorities

| Capability | Video Priority | Business Value | Visual Value | Observed Latency | Reliability | Recommended Shot | Live/Edited/Omit | Verification Status |
|---|---|---|---|---|---|---|---|---|
| Financial Analysis (Aggregator + Compliance) | **Top 4** | High | High | 18s / 24.5s | Succeeded 1/1 run | AI Recommendation card (HIGH/Urgent, evidence-backed) | Edited (cut the 2 min wait for the sub-agent that times out) | **VERIFIED** |
| Ask AIMS | **Top 4** | High | High | ~100s | Succeeded 2/2 | Question A answer card | Edited (cut wait) | **VERIFIED** |
| Document Extraction / Validation | Medium | Medium | Medium | timed out 3/3 (~90s) | 0/3 succeeded | Show the manual-fallback UI, not a live AI answer | Show fallback state only, or pre-recorded success if one is captured before the shoot | **VERIFIED (fails)** |
| Financial Risk (sub-agent) | Low for live AI | High (as concept) | Medium | timed out 1/1 | 0/1 | Folded into the Financial Analysis Aggregator shot | Edited | **VERIFIED (fails)** |
| Spending Pattern (sub-agent) | Low for live AI | Medium | Low | timed out 1/1 | 0/1 | Omit as standalone shot | Omit | **VERIFIED (fails)** |
| Compliance (sub-agent) | Medium | Medium | Medium | 24.5s success | 1/1 | Folded into Financial Analysis shot | Live-capable | **VERIFIED** |
| Finance Watch | Low | Medium | Medium | timed out 2/2 (~90s) | 0/2 | Show the graceful-degradation message as a governance beat ("AI Finance Intelligence is unavailable. The deterministic Finance Dashboard remains available.") | Show fallback state, or a pre-captured success screenshot from a lucky run | **VERIFIED (fails)** |

**Top four AI moments recommended for the most screen time:**
1. Document upload → AI Validation attempt → graceful manual fallback (proves "manual mode always available" even when AI genuinely fails — a strong, honest governance beat, not a weakness to hide).
2. Financial Analysis: real AGGREGATOR + COMPLIANCE output, HIGH/Urgent recommendation, correctly citing the real negative-budget finance context with proper evidence references (not confusing request amount with projected available).
3. Deterministic Policy gate requiring Finance justification for HIGH risk, then Approval by a human Manager — the AI-to-human handoff moment.
4. Ask AIMS: Question A, a real, evidence-bounded, non-hallucinated answer with explicit limitations disclosed.

## 4. Canonical Video Case

| Field | Value | Status |
|---|---|---|
| Department | Operations | **VERIFIED** — only Operations and Finance departments exist in this database; no Marketing department exists, confirming Operations is the only valid choice |
| Purpose | Digital Marketing Campaign | **VERIFIED** |
| Payee | BrightWave Media Sdn. Bhd. | **VERIFIED** |
| Currency | MYR | **VERIFIED** |
| Claim 1 | Campaign Media Placement — MYR 8,000.00 | **VERIFIED** |
| Claim 2 | Creative Production — MYR 6,500.00 | **VERIFIED** |
| Claim 3 | Campaign Analytics Service — MYR 4,000.00 | **VERIFIED** |
| Total | MYR 18,500.00 | **VERIFIED** (8,000 + 6,500 + 4,000 = 18,500) |
| Category (per claim) | `Operations` (free text — see §14 finding) | **VERIFIED** |
| Payment Method | Bank transfer | **VERIFIED**, real enabled method (others: Corporate card, Cash) |
| Due Date | 15 Oct 2026 | **VERIFIED**, does not trigger overdue behavior |
| Remark | "Payment for approved digital marketing campaign services." | **VERIFIED** |
| Supporting Document | Synthetic one-page PDF invoice, see §5 | **VERIFIED**, AI-readable |

Three rehearsal requests were created with this exact case: **PAY-2026-000037, PAY-2026-000038, PAY-2026-000039**. A fourth, pre-existing request, **PAY-2026-000036**, already reached PAID with materially the same case (same payee/amount/department, slightly different claim-item wording) as prior Engineering Acceptance / UAT evidence — **do not reuse PAY-2026-000036 for the final recording**; it remains UAT evidence.

**None of PAY-2026-000037/038/039 reached PAID** — each is stuck at a different stage due to real findings documented in §14/§18. See §17 for the state each is left in and what NOT to do with them.

## 5. Supporting Document

No demo invoice document existed anywhere in the repository before this rehearsal (confirmed by search — the competition seed only inserts a 20-byte fake placeholder row, not real bytes). With explicit user authorization, two synthetic one-page PDF invoices were generated and committed to the repo:

- [`docs/demo-assets/brightwave-media-invoice-demo.pdf`](demo-assets/brightwave-media-invoice-demo.pdf) — invoice `BWM-DEMO-2026-0142`, used on PAY-2026-000037 and (by mistake — see §14) reused on PAY-2026-000038.
- [`docs/demo-assets/brightwave-media-invoice-demo-v2.pdf`](demo-assets/brightwave-media-invoice-demo-v2.pdf) — invoice `BWM-DEMO-2026-0143`, a byte-distinct copy used on PAY-2026-000039.
- [`docs/demo-assets/brightwave-payment-slip-demo.pdf`](demo-assets/brightwave-payment-slip-demo.pdf) — synthetic payment confirmation slip, transaction reference `DEMO-TXN-2026-000039`.
- [`docs/demo-assets/brightwave-media-invoice-final-rehearsal.pdf`](demo-assets/brightwave-media-invoice-final-rehearsal.pdf) — invoice `BWM-DEMO-2026-0201`, used on **PAY-2026-000040** (final video rehearsal, see §24), byte-distinct from all three files above.
- [`docs/demo-assets/brightwave-payment-slip-final-rehearsal.pdf`](demo-assets/brightwave-payment-slip-final-rehearsal.pdf) — synthetic payment confirmation slip for PAY-2026-000040, transaction reference `DEMO-TXN-2026-000040-FINAL`.

All three carry an explicit "SYNTHETIC DEMO DOCUMENT" watermark and a footer disclaimer; none contain real banking, personal, or confidential information.

**CRITICAL PRODUCTION RULE, confirmed live:** never attach the exact same file (same SHA-256) to more than one payment request. Final Finance Control's DUPLICATE INVOICE check is a genuine, unoverridable hard block (see §14) — reusing a document across the rehearsal and the final take, or across two takes, will permanently strand the second request. **Generate a fresh, uniquely-worded invoice PDF for the final recording take**, distinct from both files above.

Verified:
- UPLOAD = works, ~instant
- SCAN = malware scanner (dev deterministic adapter) marks CLEAN in ~1s
- DOCUMENT STATUS = "Document ready" after scan
- AI EXTRACTION = attempted automatically as part of Validation; see §14 (times out)
- DOCUMENT VALIDATION = falls back to manual Finance confirmation; see §14
- EVIDENCE REFERENCES = correctly cited by the Financial Analysis AI (e.g. `CONTEXT:...:VERSION:2`, `REQUEST:...:REVISION:8`)

## 6. Demo Personas

| Role | Display Name | Login | Real Authority | Video Purpose | How to Sign In |
|---|---|---|---|---|---|
| REQUESTER | Demo Requester | `requester@aims.local` | Role REQUESTER, Operations department | Creates and submits the request | Sign out → local identity picker → "Requester" card, **or** password login (see note below) |
| APPROVER | Demo Operations Approver | `approver@aims.local` | Role REQUESTER + AM (Manager) approval authority scoped to Operations, MYR 0–50,000 | Approves the request at Stage 7 | Sign out → identity picker → card labeled **"Requester & Finance"** (misleading label — this is the Approver, not a Finance Analyst) |
| FINANCE | Demo Finance | `finance@aims.local` | Role FINANCE + org-wide Finance Control, Payment, and Reporting (Ask AIMS / Finance Watch) authority | Runs Validation, Finance Context, Financial Risk, Policy, Final Finance Control, Payment recording, Dashboard, Ask AIMS, Finance Watch | Sign out → identity picker → "Finance Analyst" card |
| FINANCE MASTER | Demo Technical Admin | `admin@aims.local` | Roles ADMIN + FINANCE_MASTER, "No operational workspace" | **Verification only** — confirms AI Business Configuration is published version 8 with the expected flags. Do **not** show this persona performing financial actions in the video; per the task's own governance rule, ADMIN ≠ FINANCE | Sign out → identity picker → "Technical Administrator" card |

**Do not record passwords, tokens, or secrets.** None are reproduced here.

**Login note:** the app now uses real email/password authentication (P20.5A) — the older docs describing a "select a synthetic local identity" flow are stale for the primary login page. However, a **dev-only local identity picker still exists**: after clicking "Sign out" on `localhost:3000`, the app shows a "Welcome to AIMS — Select your identity to continue" screen with one card per demo persona. **This is the fastest, most reliable way to switch personas for recording** — no typing required, and it avoids exposing any password on screen. Use it for all persona switches during the shoot.

## 7. Video Storyline (approximately 4 minutes — working baseline, unchanged by rehearsal)

| Time | Beat |
|---|---|
| 0:00–0:20 | Problem / AI hook |
| 0:20–0:55 | Requester + multi-claim + document upload |
| 0:55–1:30 | AI understanding + Validation fallback + Finance Context + AI Financial Analysis |
| 1:30–2:00 | Policy justification + Human Approval |
| 2:00–2:30 | Final Finance Control |
| 2:30–2:55 | External payment + payment recording |
| 2:55–3:25 | Finance Dashboard |
| 3:25–3:50 | Ask AIMS |
| 3:50–4:10 | AI governance + closing |

No changes recommended to this baseline based on rehearsal — every beat is achievable with segmented real recording (see §10).

## 8. Screen Recording Requirements

- Target resolution: 1280×720 minimum.
- Mobile: only if it adds to the story; not required for the core 4 pieces.
- Preferred method: **SEGMENTED REAL RECORDING** (see §10 for why).
- Real AIMS UI only, real AI only, real supported flows — no fake screens, no fabricated AI success, no fabricated financial values, no fake authority transitions.
- Allowed: real AI request → real waiting → real completion (or real timeout+fallback) → waiting time removed in editing.

## 9. Role Session Plan

| Session | Persona | Account | Start Page | Action | End State |
|---|---|---|---|---|---|
| A | Requester | `requester@aims.local` | `/` (Requester Dashboard) | Create + submit request | Status: Submitted |
| B | Finance | `finance@aims.local` | `/finance/work-queue` | Start Validation → confirm PASS (manual fallback) → Calculate Finance Context → Complete Financial Risk manually → Evaluate Policy → submit justification → re-evaluate → Create Approval case | Status: Waiting for Approval |
| C | Approver | `approver@aims.local` ("Requester & Finance" card) | Approval Inbox | Approve | Status: Approved |
| D | Finance | `finance@aims.local` | Finance Control queue | Tick all attestation checkboxes → Run deterministic controls | Status: Ready for Payment |
| E | Finance | `finance@aims.local` | Payment Processing panel | Upload slip → set payment date (today or earlier) → bank reference → Record payment | Status: Paid |
| F | Finance | `finance@aims.local` | Finance Dashboard, Ask AIMS | View dashboard, ask Question A | — |

Recommendation: **cut between prepared sessions** rather than visibly logging out/in on camera for every switch — use the identity picker off-camera between takes, or run each persona in a separate browser profile so the editor can cut cleanly. Do not misrepresent this as automatic role-switching in the product; it is a recording convenience only.

## 10. AI Latency Strategy

All figures below are real, measured wall-clock times from this rehearsal (2026-09-15), not estimates.

| Capability | Latency | Green/Amber/Red | Reliability | Recording Treatment |
|---|---|---|---|---|
| Document Validation AI | ~90–91s to timeout (3/3 runs) | **RED** | 0/3 succeeded | Show the manual-fallback UI; do not wait live on camera |
| Financial Risk (sub-agent) | ~91s to timeout | **RED** | 0/1 | Folded into Financial Analysis aggregate shot; cut the wait |
| Spending Pattern (sub-agent) | ~91s to timeout | **RED** | 0/1 | Omit as a standalone beat |
| Compliance (sub-agent) | 24.5s | **AMBER** | 1/1 | Usable live if isolated, but runs alongside the two that fail — plan for the full ~109s wall-clock to the aggregate result |
| Aggregator (financial analysis) | 18s (but only resolves after all sub-agents settle → ~109s wall-clock) | **RED** (wall-clock) | 1/1 | Cut the wait; show the real result |
| Finance Watch | ~90s to timeout (2/2 runs) | **RED** | 0/2 | Show the graceful degradation message as a talking point, or use a pre-captured success run if one exists before the shoot |
| Ask AIMS | ~100s (2/2 succeeded) | **RED** (slow but reliable) | 2/2 | Cut the wait; the real answer is worth showing |

**Overall recording risk: RED.** Nearly every AI capability in this environment reliably takes 90+ seconds, and Document Validation, Financial Risk, Spending Pattern, and Finance Watch reliably **time out** rather than complete. This is a genuine infrastructure/provider characteristic of the current environment (model `gpt-5-mini`, provider `openai-compatible`), not a per-capability quirk — 5 of 7 measured capabilities hit the same ~90s wall.

**Recommendation: SEGMENTED REAL RECORDING.** Record each real AI request, let it run to genuine completion or genuine timeout+fallback off-camera or in an unattended take, and cut the dead time in editing. Never fabricate a faster or different outcome. Do not attempt live continuous recording through any AI-dependent stage — the chance of an on-camera 90-second stall (or a hard failure requiring the fallback path) is high enough to treat as the expected case, not the edge case.

## 11. Ask AIMS Strategy

| Question | Class | Result | Latency | Video Suitability |
|---|---|---|---|---|
| A. "What is the financial impact of the MYR 18,500 digital campaign vendor payment?" | Amount-anchored | **Succeeded.** Clear, evidence-bounded answer: correctly cites the MYR 18,500 outflow (with its real evidence reference), reports a combined MYR 19,000 across two recorded vendor payments in the current evidence catalog, explicitly discloses its limitations (no dates, no budget context, no external verification), no hallucination, no bank/secret disclosure. | ~100s | **RECOMMENDED FOR VIDEO** |
| B. "How much have we paid BrightWave Media?" | Payee-name-anchored | **Succeeded but unhelpful for video.** The AI correctly refuses to answer — the bounded evidence catalog exposes payees only as hashed `PAYEE:<hash>` references, not human-readable names, so it cannot map "BrightWave Media" to an amount and says so rather than guessing. | ~100s | **NOT SUITABLE** — technically honest (good trust story) but not a compelling demo answer |
| C. "What does our recent payment activity with BrightWave Media show?" | Payee-name-anchored | **Not tested** in this rehearsal (time budget) | — | Likely hits the same payee-name-resolution limitation as B; deprioritize unless retested before the shoot |

**FINAL SELECTED VIDEO QUESTION: Question A.** It produces a genuine, evidence-bounded, non-hallucinated answer that ties directly to the canonical case's real MYR 18,500 payment, without needing the payee-name resolution that questions B/C depend on and that the current evidence catalog does not support.

## 12. Finance Watch Strategy

STATUS: Enabled (config flag `financeWatchEnabled: true`, verified in the published AI configuration).
OBSERVED BEHAVIOR: 2/2 rehearsal attempts timed out after ~90s with a 503 "AI provider request timed out." The UI degrades gracefully: *"AI Finance Intelligence is unavailable. The deterministic Finance Dashboard remains available."*
NATURAL INSIGHT AVAILABILITY: None captured in this rehearsal — no successful run to show.

RECOMMENDATION: **MENTION ONLY**, or **SHOW EXISTING REAL RESULT** if the operator captures one successful run before the shoot (attempt it once, unattended, well before recording, and save the screen if it succeeds). Do not plan a live Finance Watch demo as a load-bearing shot — treat a successful run as a bonus, not the plan. If it fails during recording, the graceful-degradation message is itself a usable, honest beat ("even when AI is unavailable, deterministic Finance stays in control").

## 13. Financial Truth (real, deterministic, SYSTEM CALCULATED — captured live)

Values evolved across the rehearsal as each of the three test requests was approved and created its own active budget commitment — this is the deterministic commitment mechanism working correctly, not drift or error.

**At PAY-2026-000037's Finance Context calculation (first request):**
- Original budget: MYR 100,000.00 / Revised budget: MYR 120,000.00
- Actual spending: MYR 39,000.00
- Active commitments: MYR 72,000.00
- Available budget: MYR 9,000.00
- Request amount: MYR 18,500.00
- **Projected available: MYR −9,500.00**

**At PAY-2026-000039's Finance Context calculation (third request, after 037 and 038 were each approved and added their own MYR 18,500 commitment):**
- Actual spending: MYR 39,000.00 (unchanged — no payment had posted yet)
- Active commitments: MYR 90,500.00
- Available budget: MYR −9,500.00
- Request amount: MYR 18,500.00
- **Projected available: MYR −28,000.00**

**Finance Dashboard snapshot (live, 2026-09-15 16:03) for Operations / MYR:**
- Active budget: MYR 121,000.00
- Actual spending: MYR 39,000.00
- Active committed: MYR 109,000.00
- Available budget: **MYR −27,000.00 (over-committed)**
- Budget utilization: **122.3%**
- Paid this period: MYR 19,000.00 · Requests processed: 2

DOUBLE DEDUCTION = Not directly tested (no rehearsal request reached PAID), but the atomic commitment-on-approval mechanism was confirmed three separate times: each Approval immediately produced a `BUDGET COMMITMENT CREATED` audit event and the very next Finance Context calculation reflected the new total — no double-counting or missed commitment observed.

**⚠️ PRODUCTION NOTE, not a defect:** this rehearsal has left the Operations budget genuinely over-committed (see §17). Any new request against Operations will now show a real negative projected-available position and a real HIGH-risk AI/manual assessment until this is addressed. See §21 Decision Log for the recommended path.

## 14. Video Blocking Findings

### RESOLVED (formerly CRITICAL — see §14a for detail, moved out of active blockers)

**Finding 1 — Financial Risk Analysis "Finalize assessment" id mismatch — FIXED.** See §14a.

**Finding 2 — Record Payment possible-duplicate confirmation missing — FIXED.** See §14a.

### CRITICAL

None open as of this correction pass (2026-09-15). Findings 1 and 2 above are resolved; see §14a for the full record.

## 14a. Critical Correction Record — Finding 1 & Finding 2 (2026-09-15, post-rehearsal correction pass)

Both formerly-CRITICAL findings from §14 were fixed, tested, and verified in this correction pass. Original rehearsal findings are preserved below for history; this section is the authoritative resolution record.

### Finding 1 — Financial Risk Finalize (RESOLVED)

- **Original finding (preserved):** after a real AI-assisted Financial Risk run lands in `AWAITING_HUMAN_REVIEW`, clicking "Finalize assessment" always failed with `409 Analysis is not awaiting review`. PAY-2026-000037 was left permanently stuck here during rehearsal.
- **STATUS:** FIXED.
- **ROOT CAUSE:** confirmed by reading the actual SQL. `FinancialAnalysisService.get()` ([apps/api/src/application/financial-analysis/financial-analysis.service.ts](../apps/api/src/application/financial-analysis/financial-analysis.service.ts)) selects `r.*,a.*` — joining `financial_analysis_runs` (`r`) with `financial_risk_assessments` (`a`) — and both tables have their own `id` column. node-postgres resolves duplicate result-column names to the *last* one selected, so the response's `id` field silently became the assessment's own id (table `a`), not the analysis run id (table `r`) the finalize endpoint's `:analysisId` route param actually requires (confirmed against `financial_analysis_runs WHERE id=$1 AND payment_request_id=$2 AND is_current`). The correct value was already present in the same response under the unambiguous `analysis_run_id` column — the frontend at [app/page.tsx:2758](../app/page.tsx:2758) was simply reading the wrong field (`data.id`) instead of it.
- **CORRECTION (frontend only, no backend/schema change):** [app/page.tsx](../app/page.tsx) — `FinancialAnalysisPanel`'s `View` type and `FinancialHumanReview`'s `data` prop type now declare `analysis_run_id: string`; the finalize POST now targets `.../financial-analysis/${data.analysis_run_id}/finalize` instead of `${data.id}`. No backend, AI, policy, or workflow-stage behavior changed. The manual path and the AI-advisory nature of the recommendation are unchanged.
- **VERIFICATION:**
  - New backend integration test (`apps/api/test/financial-analysis-integration.test.ts`, run via `npm run test:financial-analysis:integration` against a disposable Postgres, schema 71): inserts a run+assessment pair with deliberately distinct ids, asserts the GET response's ambiguous `id` equals the assessment id, `analysis_run_id` equals the run id, that finalizing with the assessment id 409s (`Analysis is not awaiting review` — reproducing the exact rehearsal failure), and that finalizing with `analysis_run_id` succeeds and reaches `readyForPolicyEvaluation:true`. **PASS.**
  - Updated frontend snapshot test (`test/financial-analysis-ui.test.ts`) to use distinct `id`/`analysis_run_id` values and assert the finalize POST addresses the run id. **PASS.**
  - Interactive UI verification: extracted the real `FinancialAnalysisPanel`/`FinancialHumanReview` component code into a standalone React harness (mocked API, real component logic) and clicked "Finalize assessment" in-browser at 1280×720 — confirmed the POST goes to `.../financial-analysis/run-shared-id/finalize` (the run id), not the assessment id.
  - `npm test` (313 tests) and `tsc --noEmit` (root + `apps/api`) and `npm run build` all pass with this change.
- **VIDEO IMPACT:** Stage 5 can now show the real AI-assisted path end-to-end — AI recommendation card → human review → **Finalize assessment** → Policy & Decision — instead of routing around it via "Complete manually". The §14/§19 workaround (fold Financial Risk into a "Complete manually" cutaway) is no longer required, though it remains a valid fallback narratively. PAY-2026-000037 itself was **not** touched by this correction pass (see §17 — no rehearsal database state was modified); it remains available for an operator to manually verify against the live rehearsal environment before the shoot, but doing so was out of scope for this correction (frontend-code-only change, verified via disposable-database integration test instead of the shared rehearsal database).

### Finding 2 — Record Payment Possible-Duplicate Confirmation (RESOLVED)

- **Original finding (preserved):** `POST /payment-requests/:id/payment` returns `409 POSSIBLE_DUPLICATE_PAYMENT_REQUIRES_CONFIRMATION` whenever the backend's duplicate heuristic fires (same payee + same amount as another recent request), and the frontend hardcoded `confirmPossibleDuplicate: false` with no UI path to confirm and retry. PAY-2026-000039 was left permanently stuck one step short of Paid.
- **STATUS:** FIXED.
- **ROOT CAUSE:** confirmed in `record_payment()` ([apps/api/migrations/043_day8_1_payment_replay_hardening.sql](../apps/api/migrations/043_day8_1_payment_replay_hardening.sql)): `IF NOT $9 AND EXISTS(... same payee, amount, currency ...) THEN RAISE EXCEPTION 'POSSIBLE_DUPLICATE_PAYMENT_REQUIRES_CONFIRMATION'`, surfaced by `PaymentService.controlled()` as `409`. The backend contract already supports explicit confirmation (`$9` / `confirmPossibleDuplicate`); [app/page.tsx:3778](../app/page.tsx:3778) simply never gave Finance a way to set it `true`.
- **CORRECTION (frontend only, no backend/schema change):** `PaymentPanel` in [app/page.tsx](../app/page.tsx) now tracks `possibleDuplicate` / `duplicateAcknowledged` state. `pay()` takes an explicit `confirmPossibleDuplicate` parameter (default `false`); on catching the specific `POSSIBLE_DUPLICATE_PAYMENT_REQUIRES_CONFIRMATION` error it shows a warning card ("Possible duplicate payment — a payment already exists for this payee with the same amount and currency. Confirm this is not a duplicate before recording it as PAID.") with a checkbox — **unchecked by default** — labeled "I have verified this is not a duplicate payment", and a "Confirm and record as PAID" button that stays disabled until the checkbox is explicitly checked. Only checking the box and clicking that button resends the request with `confirmPossibleDuplicate: true`. Duplicate detection, payment authority, ledger semantics, commitment semantics, and atomicity are all unchanged — this is purely a UI affordance for an existing backend contract.
- **VERIFICATION:**
  - New frontend tests (`test/payment-ui.test.ts`): the warning is absent by default; when a duplicate is flagged, the checkbox renders unchecked and the confirm button is disabled; checking the box enables it and clicking it posts `confirmPossibleDuplicate:true`. **PASS** (13/13 tests in the file).
  - `apps/api` backend payment/finance-control integration tests (41 tests, including atomicity, idempotency, and duplicate-related race tests) re-run unmodified and **PASS** — confirms duplicate protection, payment authority, and atomic semantics are untouched.
  - Interactive UI verification at both 1280×720 and 390×844: typed a bank reference, clicked "Record payment", observed the duplicate warning appear with the checkbox unchecked and the confirm button disabled; checked the box (button became enabled), clicked "Confirm and record as PAID", observed the mocked backend receive `confirmPossibleDuplicate:true` and the UI show "External payment recorded atomically as PAID." with the warning cleared.
  - `npm test` (313 tests), `tsc --noEmit` (root + `apps/api`), and `npm run build` all pass with this change.
- **VIDEO IMPACT:** Stage 9 can now show the real duplicate-detection safeguard as a *feature*, not a dead end — Finance sees the warning, makes an informed, explicit, visible confirmation, and the payment completes. This is arguably a stronger governance beat than avoiding the duplicate case entirely (§14's original workaround was to pick a payee+amount that would never trigger it). The shot list (§19) may now choose to show a genuine possible-duplicate confirmation instead of avoiding it, at the Product Owner's discretion. PAY-2026-000039 itself was **not** touched by this correction pass (see §17 — no rehearsal database state was modified); an operator can manually complete it against the live rehearsal environment before the shoot if desired, but doing so was out of scope here.

### Independent UI/UX Review (read-only, per AIMS-UX-001)

Performed after both corrections, tests, typecheck, and build — code was **not** changed during this review.

- **C1 (Finalize Assessment):** the action's label and semantics are unchanged by the fix (still "Finalize assessment", still requires the same risk/priority selection); only the identifier sent to the backend changed. No visual regression. Pre-existing, unrelated note (not introduced by this fix): the Human Review section (`section.humanFinal`) renders as plain unstyled `<select>`/`<button>` elements rather than the Card/Badge design system used elsewhere on the same panel — a pre-existing inconsistency, out of scope for this correction.
- **C2 (Possible Duplicate Confirmation):** warning is clearly visible (distinct warning-toned card, directly below the Record Payment action); the checkbox defaults unchecked and the confirm button is disabled until it is checked (verified programmatically at both viewports — no dangerous default); the label text and separate button ("Confirm and record as PAID", distinct from "Record payment") make it clear this is a deliberate, non-automatic action; primary action remains unchanged. Layout is single-column and fully legible at both 1280×720 and 390×844 with no horizontal overflow. One **Medium** cosmetic note: the enabled and disabled states of "Confirm and record as PAID" have fairly similar visual contrast against the warning card's amber background, making the enabled state slightly harder to distinguish at a glance — worth a follow-up polish pass, but does not weaken the underlying control (the button's `disabled` state was independently verified via the DOM, not just visually) and does not block acceptance.
- **Critical/High findings:** none.

### HIGH

**Finding 3 — Document Validation AI, Financial Risk AI, Spending Pattern AI, and Finance Watch reliably time out (~90s) in this environment.**
- Affected shots: any live-recorded wait on these four capabilities.
- Impact: 3/3, 1/1, 1/1, and 2/2 real attempts respectively timed out. See §10.
- Mitigation: segmented real recording, cut the wait; never plan a live continuous shot through any of these four.
- Requires engineering = possibly (worth investigating provider/timeout configuration, but out of scope for this rehearsal and not required to ship the video — the graceful fallback already makes the product usable and demoable).

### MEDIUM

**Finding 4 — Operations budget is currently over-committed (Available: −MYR 27,000, 122.3% utilized) as a side effect of this rehearsal.**
- Affects: any new request against Operations will show a genuine negative-budget/HIGH-risk story rather than a "routine, healthy" one, until reset or worked around.
- Mitigation: see §21 Decision Log. Recording preparation, not an engineering fix — do not "reset" this via direct database access; use supported admin/finance flows only, or intentionally lean into the real risk story, or pick a claim total that fits within the remaining available budget for the final take.

**Finding 5 — Master Data categories are empty by design; the claim-item "Category" field is free text, not a picklist.**
- Affects: on-screen appearance of the Category field during Request Capture.
- Mitigation: none needed — this is intended product behavior (per migration comment: "category and payment method are free text ... so they start empty for Finance Master to populate"). Just be aware it is a text box, not a dropdown, when narrating/recording that screen. Use `Operations` as the value, matching the seeded budget category of the same name.

**Finding 6 — Final Finance Control's per-check attestation checkboxes are easy to miss on a first pass.**
- Affects: Stage 8 shot; a first-time operator (as happened in this rehearsal) may click "Run deterministic controls" before ticking the "Payee identity verified / Payment method verified / Payment details verified / Supporting documents verified" checkboxes, producing an avoidable HOLD.
- Mitigation: shot list / operator notes should call out ticking all checkboxes *before* the first "Run deterministic controls" click.

### LOW

- Payment date field has no client-side max-date constraint; picking a future date only surfaces as a 400 error after submit. Cosmetic; do not fix before the video, just don't pick a future date when recording (use today's date or earlier).

## 15. Future Improvement Backlog (post-competition — do not implement now)

| Title | Observation | Business Value | Priority | Recommended After Competition |
|---|---|---|---|---|
| ~~Fix Financial Risk finalize id mismatch~~ | See Finding 1 — **FIXED 2026-09-15, see §14a** | High — blocks a core workflow path, not just the demo | Done | N/A |
| ~~Add duplicate-payment confirmation UI~~ | See Finding 2 — **FIXED 2026-09-15, see §14a** | High — blocks legitimate recurring payments | Done | N/A |
| Polish contrast of the enabled "Confirm and record as PAID" state against the warning card | See §14a UI/UX review, Medium cosmetic note | Low — readability polish only | Low | Optional |
| Investigate AI provider/timeout tuning for Document Validation, Financial Risk, Spending Pattern, Finance Watch | ~90s timeout hit reliably across 4 of 7 measured capabilities | Medium — affects real usability, not just demo pacing | Medium | Yes |
| Add client-side max-date on Payment date input | 400 only surfaces after submit | Low | Low | Optional |
| Richer Ask AIMS evidence catalog (payee-name resolution) | Question B/C-style questions cannot resolve a payee name to its hashed id | Medium — limits natural-language usefulness | Medium | Yes |
| Ask AIMS history UI | Not evaluated this rehearsal | Unknown | Low | Optional |

## 16. Decision Log

| Date | Decision | Reason |
|---|---|---|
| 2026-09-15 | Use Operations, not Marketing, as the canonical department | No Marketing department exists in this database (only Operations and Finance); creating one would violate the no-new-master-data rule |
| 2026-09-15 | PAY-2026-000036 remains UAT/acceptance evidence, not the final recording request | Task instruction; also already PAID and therefore not re-runnable through the live workflow |
| 2026-09-15 | Created three fresh rehearsal requests (037/038/039) instead of reusing 036 | Needed to rehearse the actual live submission → approval → payment flow end to end |
| 2026-09-15 | Generated two synthetic demo invoice PDFs with explicit user authorization | No demo document existed in the repo; task requires reporting this and getting authorization before fabricating one |
| 2026-09-15 | Reset local dev passwords for the four demo accounts via direct scrypt-hash DB update, with explicit user authorization | The app's forgot-password self-service flow is non-functional in local dev (no email sender configured; confirmed by reading `DisabledEmailSender`), and no plaintext password was recoverable from any file |
| 2026-09-15 | Chose "Complete manually" over "Start AI-assisted analysis" for Financial Risk on PAY-2026-000038/039 | The AI-assisted path's "Finalize assessment" step is broken (Finding 1); manual mode is a working, product-intended fallback ("manual mode always available") |
| 2026-09-15 | Selected Ask AIMS Question A over B/C for the final video | Only A produced a compelling, evidence-bounded, non-hallucinated answer; B correctly refused to answer due to a real payee-name-resolution limitation in the evidence catalog |
| 2026-09-15 | Recommend segmented real recording over live continuous recording | 5 of 7 measured AI capabilities take 90+ seconds, and 4 of those reliably time out rather than complete |
| 2026-09-15 | Did not attempt to fix either Critical finding during rehearsal | Explicit change-policy: only `docs/demovideo.md` may be created/updated; findings are reported and flagged as background tasks, not fixed |
| 2026-09-15 | Fixed Finding 1 and Finding 2 in a dedicated, scoped correction pass (frontend-only, no backend/schema/AI/policy change) | Both are 100%-reproducible Critical demo blockers with confirmed root causes; corrections were minimal, covered by new tests (frontend snapshot + a real backend integration test against a disposable database), typecheck, build, and a read-only UI/UX review, per AIMS-UX-001 |
| 2026-09-15 | Did not touch the live rehearsal database or PAY-2026-000037/038/039 during the correction pass | Verification used a disposable integration-test database and a standalone component-level UI harness instead, to avoid any risk to the shared rehearsal state; an operator can separately re-verify against the live requests before the shoot if desired |

## 17. Rehearsal / Final Request Strategy

REHEARSAL REQUESTS (used, do not reuse for final recording):
- **PAY-2026-000037** — stuck at Stage 5 (Financial Risk "Finalize assessment", Finding 1). Left in `VALIDATING` status with an `AWAITING_HUMAN_REVIEW` financial-risk run that cannot be finalized through the UI.
- **PAY-2026-000038** — stuck at Stage 8 (Final Finance Control, genuine DUPLICATE INVOICE hard block from reusing the same PDF as 037). Left in `FINANCE_HOLD`.
- **PAY-2026-000039** — furthest progress: reached `READY_FOR_PAYMENT` (Finance Control genuinely PASSED). Stuck at Stage 9 (Record Payment, Finding 2, duplicate-payment confirmation).

FINAL VIDEO REQUEST = **not yet created**. Create a new, fifth request for the actual recording, using:
- A demo invoice PDF with bytes distinct from both files in §5 (generate a fresh one, or reuse `-v2.pdf` only if 039 is abandoned/never gets a document conflict — safest is a fresh third PDF).
- A payee+amount combination not already present in recent Payment History, to avoid Finding 2, **or** wait until Finding 2 is fixed.
- "Complete manually" for Financial Risk, **or** wait until Finding 1 is fixed.

RESET REQUIRED = No database reset was performed and none is recommended via direct access. If the Product Owner wants a "healthy budget" story instead of the real over-committed one currently in Operations (§13), that must go through supported Finance admin flows (e.g. a new budget revision), not a direct DB edit.

IRREVERSIBLE POINTS observed live: Approval (creates an active commitment immediately — confirmed 3×), Payment recording (marks PAID atomically — not reached in this rehearsal, but confirmed as the terminal state by PAY-2026-000036's existing history).

## 18. Video Blockers Summary

| Severity | Finding | Requires Engineering | Status |
|---|---|---|---|
| ~~CRITICAL~~ RESOLVED | Financial Risk "Finalize assessment" id mismatch (Finding 1) | Yes | **FIXED 2026-09-15** — see §14a for root cause, correction, and verification |
| ~~CRITICAL~~ RESOLVED | Record Payment duplicate-confirmation UI missing (Finding 2) | Yes | **FIXED 2026-09-15** — see §14a for root cause, correction, and verification |
| HIGH | 4 of 7 AI capabilities reliably time out at ~90s (Finding 3) | Possibly (out of scope now) | Documented, mitigated via recording strategy |
| MEDIUM | Operations budget over-committed from rehearsal (Finding 4) | No | Documented, needs recording-prep decision |
| MEDIUM | Category field is free text, not a picklist (Finding 5) | No | Documented, not a defect |
| MEDIUM | Finance Control attestation checkboxes easy to miss (Finding 6) | No | Documented, operator training note |
| LOW | Payment date lacks client-side max constraint | No | Deferred |

## 19. Shot List (initial — refine after blocker resolution)

| Shot ID | Stage | Role | Screen | Action | AI Feature | Key Value | Key Message | Est. Duration | Recording Status |
|---|---|---|---|---|---|---|---|---|---|
| SHOT-01 | 1–2 | Requester | New Payment Request form | Fill payee/purpose/3 claims/upload doc/submit | — | MYR 18,500.00 | "Human submits" | 20s | NOT RECORDED |
| SHOT-02 | 3 | Finance | Validation panel | Start validation → real AI attempt → manual fallback confirm | Document Validation AI | — | "Even when AI can't finish, the system doesn't stop" | 15s (edited from ~90s wait) | NOT RECORDED |
| SHOT-03 | 4 | Finance | Finance Context card | Calculate Finance Context | — (SYSTEM CALCULATED) | Available/Projected figures | "System calculates. AI interprets." | 8s | NOT RECORDED |
| SHOT-04 | 5 | Finance | Financial Risk Analysis card | Real AI recommendation (Aggregator+Compliance) shown; risk finalized via working path | Financial Analysis AI | HIGH / Urgent | "AI assists decisions. Humans retain authority." | 12s (edited) | NOT RECORDED |
| SHOT-05 | 6 | Finance | Policy & Decision card | Justification → re-evaluate → Pass | — (POLICY DECISION) | Approval route: AM | "Deterministic policy, not AI, decides the route" | 10s | NOT RECORDED |
| SHOT-06 | 7 | Approver | Approval Inbox | Approve | — (HUMAN DECISION) | — | "AI never approves payments" | 8s | NOT RECORDED |
| SHOT-07 | 8 | Finance | Final Finance Control | Tick attestations → Run controls → Pass | — | "AIMS DOES NOT EXECUTE BANK TRANSFER" | "Approved does not mean Ready for Payment" | 12s | NOT RECORDED |
| SHOT-08 | 9 | Finance | Payment Processing | Upload slip → record payment | — | MYR 18,500.00 PAID | "AIMS records; it does not transfer" | 10s | NOT RECORDED |
| SHOT-09 | 11 | Finance | Finance Dashboard | Pan across Financial Position + Needs Attention + Operations cards | — (SYSTEM CALCULATED) | Real live figures | "Full financial visibility" | 15s | NOT RECORDED |
| SHOT-10 | 12 | Finance | Ask AIMS | Ask Question A, show real evidence-bounded answer | Ask AIMS | MYR 18,500 impact | "AI explains, grounded in evidence" | 12s (edited from ~100s wait) | NOT RECORDED |

Full frame-by-frame storyboard to be produced after the two Critical findings are resolved or the workarounds in §14 are locked in.

## 20. Voiceover Requirements

- Primary: English. Secondary: Chinese subtitle/reference script.
- Tone: professional, confident, enterprise, clear, judge-friendly, non-exaggerated.
- Emphasize: AI assistance, speed, financial visibility, decision support, control, auditability, human authority.
- Avoid: architecture explanations, terminal/code/DB/API screens, developer jargon.

## 21. Editing Requirements

Planned tooling: Screen Studio (capture), ElevenLabs (voice), CapCut/Descript (editing), ChatGPT (storyboard/narration/shot sequencing/Chinese script/editing plan).

Recommended: cursor emphasis, controlled zoom, clean transitions, remove genuine AI waiting time, subtitles, minimal callouts. Avoid: fake UI, long visible loading screens, terminal/code/DB/API/architecture footage during the core product demo.

## 22. People / Responsibilities

- **Product Owner** — final story approval, selects footage, approves competition claims, approves final video.
- **Claude / Engineering Agent** — rehearsal, functional verification, demo-state prep, technical-risk identification (this document).
- **ChatGPT** — demo direction, storyboard, narration, shot sequencing, AI positioning, Chinese script, editing plan, judge-focused storytelling.
- **Screen Recording Operator** — captures real AIMS UI per the approved shot list.
- **Voice Tool / Narrator** — produces approved English narration.
- **Video Editor** — assembles real footage, removes AI waiting time, adds narration/subtitles/callouts.

## 23. Repository Changes Made During This Rehearsal

- Created `docs/demovideo.md` (this file).
- Created `docs/demo-assets/brightwave-media-invoice-demo.pdf`, `docs/demo-assets/brightwave-media-invoice-demo-v2.pdf`, `docs/demo-assets/brightwave-payment-slip-demo.pdf` (synthetic, user-authorized).
- **No production code was changed.** No database rows were fabricated or manipulated to create false-positive results — the only direct database write performed was a password-credential reset for the four demo accounts (`requester@aims.local`, `approver@aims.local`, `finance@aims.local`, `admin@aims.local`), explicitly authorized by the user after confirming the self-service reset flow is non-functional in this environment.
- Three genuine payment requests (PAY-2026-000037/038/039) exist in the live `aims` database as a direct, expected result of using the real supported UI to rehearse the workflow — not fabricated state.

### Correction Pass (2026-09-15, after rehearsal)

- Modified [app/page.tsx](../app/page.tsx) (frontend only): fixed the Financial Risk finalize id mismatch (Finding 1) and added an explicit possible-duplicate payment confirmation UI (Finding 2). See §14a for full detail.
- Modified [app/payment-ui.css](../app/payment-ui.css): one new layout rule (`.p1839-duplicateConfirm`) for the duplicate-confirmation checkbox row, using only existing design tokens.
- Modified [test/financial-analysis-ui.test.ts](../test/financial-analysis-ui.test.ts), [test/payment-ui.test.ts](../test/payment-ui.test.ts), [apps/api/test/financial-analysis-integration.test.ts](../apps/api/test/financial-analysis-integration.test.ts): updated/added regression coverage for both corrections.
- No backend, AI, policy, approval, Finance Control, ledger, commitment, payment-authority, or schema changes. No migration added. No RC tag touched. No commit created by this pass (per instruction).
- No rehearsal database state was read, written, or reset; PAY-2026-000037/038/039 were not touched.

## 24. Final Video Rehearsal (2026-09-15, after §14a corrections)

Goal: prove that **one fresh canonical request** can complete the entire planned video happy path — Request Creation through PAID and Stage 12 — using real AIMS UI, real business controls, real deterministic financial truth, and real AI, with the two corrected Critical blockers verified live rather than only by automated test.

**Change freeze honored:** no production code was modified during this rehearsal. No migration added. No RC tag changed. No commit created. No push. Exactly one new request was created (authorized). PAY-2026-000037/038/039 were not touched, reset, or reused.

### 24.1 Baseline

- Schema: **71** (unchanged since §14a).
- Application (`vinext dev`, port 3000), API (port 3001), and worker were already running locally against the project's own `aims-site-postgres-1` Docker Postgres (port 55433) — the same environment used for the §14a corrections.
- AI Business Configuration: `configuration_versions` category `ai`, **version 8, published, enabled=true**, with `financialAnalysisAiEnabled`, `financialRiskAnalysisEnabled`, `spendingPatternAnalysisEnabled`, `complianceAnalysisEnabled`, `validationAiEnabled`, `documentValidationEnabled`, `askAimsEnabled`, `financeWatchEnabled` all true. Unchanged from the original rehearsal.
- C1 and C2 corrections confirmed present in the running frontend (`app/page.tsx`, uncommitted working-tree state at the time of this rehearsal) before starting.

### 24.2 Final Rehearsal Request

**PAY-2026-000040** — Department Operations, Payee BrightWave Media Sdn. Bhd., Digital Marketing Campaign, MYR 18,500.00 (Campaign Media Placement MYR 8,000.00 + Creative Production MYR 6,500.00 + Campaign Analytics Service MYR 4,000.00), Bank transfer, due 15 Oct 2026.

Supporting document: a **new**, uniquely-worded synthetic invoice, [`docs/demo-assets/brightwave-media-invoice-final-rehearsal.pdf`](demo-assets/brightwave-media-invoice-final-rehearsal.pdf) (invoice number `BWM-DEMO-2026-0201`, SHA-256 distinct from both prior demo invoices — verified before upload), carrying the same "SYNTHETIC DEMO DOCUMENT" disclaimer as the earlier assets. Uploaded, scanned CLEAN by the real worker in ~1s. Payment slip: [`docs/demo-assets/brightwave-payment-slip-final-rehearsal.pdf`](demo-assets/brightwave-payment-slip-final-rehearsal.pdf), transaction reference `DEMO-TXN-2026-000040-FINAL`.

**Note on document upload mechanics:** the interactive browser-automation tool available for this rehearsal cannot drive a native OS file-picker dialog (no Chrome extension connection was available in this environment). Rather than skip real document upload, the same authenticated multipart request the UI's own "Upload Document" / "Upload and check slip" actions issue (`POST /payment-requests/:id/documents`, `POST /payment-requests/:id/payment-slip`) was called directly against the real running API using a fresh `local-login` session for the correct persona — the identical backend handler, quarantine step, and real scan worker ran exactly as they would for a mouse-driven upload. All other actions (form fills, stage transitions, finalize/approve/confirm clicks, the real 409 duplicate-payment trigger) were driven through the real UI via mouse/keyboard automation.

### 24.3 Stage-by-Stage Result

| Stage | Result | Notes |
|---|---|---|
| 1–2 Request Capture (Requester) | **PASS** | 3 claims, MYR 18,500.00 total, 1 document, submitted → **PAY-2026-000040** |
| 3 Validation (Finance) | **PASS (AI fallback)** | Real AI validation attempt genuinely timed out (`PROVIDER_TIMEOUT`) after **91s** (09:09:08→09:10:39), matching the original rehearsal's finding almost exactly. Finance completed the working manual "Confirm PASS" fallback with a validator remark. |
| 4 Finance Context (system) | **PASS** | Deterministic: Revised budget 120,000.00 − Actual 39,000.00 − Active commitments 109,000.00 = Available **−28,000.00**; Projected available (after this request) **−46,500.00**. Real, not reused from a prior request. |
| 5 Financial Risk Analysis (AI) | **PASS** | FINANCIAL_RISK, SPENDING_PATTERN, COMPLIANCE all **COMPLETED** with real evidence-backed findings (24–30s each); AGGREGATOR **FAILED** (`PROVIDER_TIMEOUT`) — a different, genuine real-world outcome than the original rehearsal (where the sub-agents failed and the aggregator succeeded). Human reviewed the three real sub-agent findings and set the final assessment **HIGH / URGENT**. |
| 5→ **C1 live verification** | **PASS** | See §24.4. |
| 6 Policy & Decision (system) | **PASS (justification required)** | HIGH risk correctly triggered "Justification required" (over-committed budget). Finance submitted a real justification citing the genuine −46,500.00 projected position; policy re-evaluated to **Pass**, route **AM · DEPARTMENT**, Approval required = Yes. |
| 7 Approval (Approver) | **PASS** | Approved by the AM/Operations Approver persona. Commitment created atomically: `budget_commitments` status `ACTIVE`, source `APPROVAL`, MYR 18,500.00 — confirmed in the database immediately after approval. |
| 8 Final Finance Control (Finance) | **PASS (possible duplicate at the control level)** | Deterministic duplicate check flagged **"Possible duplicate"** (evidence hash `d419e36b01fc…`) because the same payee/amount pattern already exists from PAY-2026-000036/037/038/039 — a real, expected detection, not fabricated. All 5 attestation checkboxes (including "Possible duplicate reviewed") ticked; "Run deterministic controls" → **PASSED**. Request reached `READY_FOR_PAYMENT`. |
| 9–10 Payment Recording (Finance) | **PASS — C2 live verification** | See §24.4. Final state: **PAID**, `payments` row with bank reference `DEMO-TXN-2026-000040-FINAL`, ledger entry created. |
| 11 Finance Dashboard | **PASS** | See §24.5 for the three selected shots. |
| 12 Ask AIMS | **COMPLETED (unhelpful answer)** | See §24.6. |

### 24.4 Corrected Blockers — Live Verification (not just automated test)

**C1 Financial Risk Finalize = PASS.** The AGGREGATOR failure in this run reproduced exactly the pre-fix bug's precondition: `financial_risk_assessments.id` (`81efa2a2…`) differs from `financial_analysis_runs.id` (`12677112…`). With the fix in place, clicking **Finalize assessment** in the real browser correctly posted to `.../financial-analysis/12677112-272e-4e7d-9026-e54836c2ebc2/finalize` (the run id) and returned `201 Created` — no `409`. Database confirms `financial_analysis_runs.status='FINALIZED'`, `final_risk='HIGH'`, `final_priority='URGENT'`. Before the fix, this exact scenario 409'd every time (see §14, Finding 1, PAY-2026-000037).

**C2 Duplicate Payment Confirmation = PASS.** Clicking "Record payment" against the real backend produced a genuine `409 POSSIBLE_DUPLICATE_PAYMENT_REQUIRES_CONFIRMATION` (visible in the browser console and network log), because BrightWave Media + MYR 18,500.00 already exists in payment history (PAY-2026-000036/037/038/039). The corrected UI showed the "Possible duplicate payment" warning with the confirmation checkbox **unchecked by default** and "Confirm and record as PAID" **disabled** until checked — verified via DOM inspection, not just visually. Checking the box and clicking confirm resent the request with `confirmPossibleDuplicate:true`, which the backend accepted: the request reached `status='PAID'` and the `budget_commitments` row transitioned `ACTIVE → CONSUMED` (not double-counted). Before the fix, this exact scenario was a permanent dead end with no UI path forward (see §14, Finding 2, PAY-2026-000039).

One tooling note unrelated to either fix: the browser-automation environment's native `window.confirm()` dialogs are suppressed by default (return `false`), which blocked the *pre-existing, unrelated* "Confirm that Finance executed this payment externally…" dialog on the first click attempt. This was resolved by allowing that dialog to return `true` (equivalent to a human clicking OK) before retrying — a test-environment limitation, not a product defect, and unrelated to the C2 correction itself (the possible-duplicate checkbox is a separate, additional confirmation this dialog does not replace).

### 24.5 Financial Truth (real, deterministic — captured live)

**Before payment:**
- Active budget: MYR 121,000.00 · Actual spending: MYR 39,000.00 · Active commitments: MYR 109,000.00 · Available: **−28,000.00** · Request: 18,500.00 · Projected available: **−46,500.00**

**After payment (PAY-2026-000040 PAID):**
- Active budget: MYR 121,000.00 (unchanged) · Actual spending: **MYR 57,500.00** (+18,500.00, exactly the one payment) · Active commitments: MYR 109,000.00 (this request's commitment moved `ACTIVE→CONSUMED`, so it drops back out of the "active" total) · Available: **−45,500.00**
- **DOUBLE DEDUCTION = NO** — actual spending increased by precisely MYR 18,500.00, matching the single payment; confirmed both in the database (`payments` table) and the live Finance Dashboard.

**Selected Dashboard shots (Stage 11):**
1. **Financial Position (MYR)** — Active budget 121,000.00 / Actual 57,500.00 / Active committed 109,000.00 / Available −45,500.00 — a real, honest over-committed position, stronger for the "AI interprets, system calculates, humans decide" story than a routine healthy budget.
2. **Needs Attention** — High/critical risk: 4 · Pending approval: 1 · Finance holds: 3 · Ready for payment: 1 (live operational counts, not staged).
3. **Current Finance Activity** — Paid this period (MYR): **37,500.00**, Requests processed: matches PAY-2026-000036 (19,000.00) + PAY-2026-000040 (18,500.00) — internally consistent, immutable payment records.

### 24.6 Ask AIMS (Stage 12)

Question asked (verbatim, as specified): *"What is the financial impact of the MYR 18,500 digital campaign vendor payment?"*

- STATUS: **Completed** (not a timeout this time — real result variance run to run).
- LATENCY: **22.4s** (`ai_usage_events`, agent `ASK_AIMS`) — much faster than the original rehearsal's ~100s, and not a number that can be planned around.
- ANSWER: *"No matching record for a MYR 18,500 vendor payment appears in the supplied evidence. The evidence contains two vendor.paidAmount items (MYR 37,000.00 and MYR 500.00), which together total MYR 37,500.00. The specific financial impact of a MYR 18,500 payment cannot be determined from the provided data."*
- HALLUCINATION: **No** — the AI correctly declined to fabricate a MYR 18,500-specific answer rather than guess, consistent with the product's evidence-bounded design. This is a genuine, honest governance behavior, but a materially different (and less video-compelling) result than the original rehearsal's Question A success.
- FINANCIAL TRUTH CONFLICT: No — MYR 37,000.00 + 500.00 = 37,500.00 is internally consistent with the evidence catalog it was given; it simply doesn't match the specific 18,500.00 figure the question named, because the underlying evidence bucketing for this run's snapshot didn't expose that individual figure.
- VIDEO SAFE: **Content — NO** for this exact question on this exact run (would look like the product failing to answer, even though it is behaving correctly). **Latency — YES** (22s is short enough to consider live).
- RECOMMENDATION: before the final recording take, either (a) re-ask a question anchored to a figure known to be in that run's evidence catalog (e.g. "What is the total impact of payments this period?", which the evidence already supports at MYR 37,500.00), or (b) re-verify Question A against the specific request that will be used for the final take, immediately before recording, since the answer is sensitive to the exact evidence snapshot at ask-time. Do not assume Question A's original wording will reproduce the original rehearsal's compelling answer on a different request/snapshot.

### 24.7 Finance Watch

Not regenerated live in this rehearsal, per instruction (avoid a redundant ~90s timeout run). Historical record: 4/4 real attempts across both rehearsals have failed with `PROVIDER_TIMEOUT` (`ai_usage_events`, agent `FINANCE_INSIGHT_AGENT`); no successful run exists in this environment to reference.

**FINANCE WATCH VIDEO STRATEGY = MENTION ONLY.**

### 24.8 Final AI Top Four (revised after this rehearsal's real results)

1. **Financial Risk sub-agent findings (Financial Risk, Spending Pattern, Compliance — real, evidence-backed, all COMPLETED)** — Why judges care: three independent, real AI reads of the same authoritative Finance Context, each citing evidence, arriving at consistent HIGH-risk signals. Real result available: Yes. Recording method: live capture of the three completed cards (~30s each, can run concurrently — cut the wait, show the result). Estimated final screen time: ~15s.
2. **Human Final Assessment overriding/confirming AI under real AI partial failure** — Why judges care: shows the "AI assists, humans retain authority" principle under a genuine adverse condition (the aggregator failed), not just the easy case. Real result available: Yes (this rehearsal). Recording method: live, cut the AI wait, show the human review + Finalize (with the C1 fix, this is now a real success, not a dead end). Estimated final screen time: ~12s.
3. **Document Validation AI → honest manual fallback** — Why judges care: proves "manual mode always available," a governance strength, reproduced twice now (91s timeout both times) so it is dependable to show. Real result available: Yes. Recording method: cut the 91s wait, show the fallback confirmation. Estimated final screen time: ~10s.
4. **Real possible-duplicate payment confirmation (the corrected C2 flow)** — Why judges care: shows a genuine financial safeguard catching a real duplicate-payment pattern, and Finance making an explicit, visible, non-default decision rather than the system silently blocking or silently proceeding. Real result available: Yes (this rehearsal, live). Recording method: live, no wait to cut. Estimated final screen time: ~12s.

Ask AIMS is **not** in this rehearsal's Top Four (see §24.6) — retest with a question matched to the final take's evidence snapshot before deciding whether it re-enters the shot list.

### 24.9 Final Recording Request Strategy

Recommendation: **Option A — a new, clean canonical request from Stage 1**, recorded as segmented real takes (per §10), immediately before the shoot, rather than reusing PAY-2026-000040 or any earlier rehearsal request.

Reasoning:
- Truthfulness: every stage in this rehearsal was genuinely reproducible with the corrections in place; there is no need to fall back to prepared/partial states (Option B/C).
- Recording reliability: AI latency and outcomes vary run to run (this rehearsal's Aggregator failed where the original succeeded, and vice versa for the sub-agents; Ask AIMS was 22s here vs ~100s originally) — a request recorded close to the shoot reduces the risk of state drift between rehearsal and final take.
- Minimal irreversible-state risk: Approval and Payment are irreversible; a fresh request keeps the final take's irreversible actions deliberate and unhurried rather than reusing already-committed state.
- Judge comprehension: a single continuous request, shown start to finish (even if edited for AI wait time), is the clearest story.

Before the final take: generate a **third**, uniquely-worded synthetic invoice (distinct SHA-256 from both prior invoices and this rehearsal's), pick a payment-slip transaction reference not yet used, and re-verify the Ask AIMS question against that specific request's evidence snapshot immediately before recording (§24.6).

### 24.10 Remaining Video Risks (updated)

- **HIGH** — AI latency and outcome variance run-to-run (Aggregator, sub-agents, Ask AIMS all produced different pass/fail patterns between the two rehearsals). Mitigation: segmented recording, always cut waits, never assume a specific sub-agent will succeed or fail on the final take; have the manual-fallback and possible-duplicate paths ready to show regardless of which AI calls happen to succeed.
- **MEDIUM** — Ask AIMS Question A's answer is evidence-snapshot-dependent and was not compelling on this run; retest immediately before the final take (§24.6).
- **MEDIUM** — Cosmetic: "Confirm and record as PAID" contrast against its warning-toned card (see §14a UI/UX review) — unchanged, not blocking.
- **LOW** — The Finance Dashboard's minor-units display under "Commitment"/evidence sub-fields on the Approval page (e.g. "-2800000" instead of a formatted "-28,000.00") is a pre-existing cosmetic quirk noticed during this rehearsal, unrelated to C1/C2; avoid framing that specific sub-panel in a close-up shot, or file it separately post-competition.
- Everything else from §18 remains as previously documented (Findings 3–6, all non-blocking).

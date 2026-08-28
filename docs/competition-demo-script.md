# AIMS Competition Demo Script

Target: 10–11 minutes. Hard stop: 12 minutes. Use one browser window and one AIMS tab. Sign out and select the next competition identity when changing persona. Do not mutate competition state during the judged run; all important states are preseeded.

## Story arc

> AIMS is an intelligent Finance control platform that turns a payment request into a governed, auditable financial decision. AI helps interpret. Humans and deterministic controls remain accountable.

| Time | Screen | Operator action | What to say | Key message | Fallback |
| --- | --- | --- | --- | --- | --- |
| 0:00–0:50 | Login | Keep the login page visible. | “Most companies can submit payment requests. The difficult part is maintaining control from request to payment: is it complete, affordable and safe; what policy applies; who must approve; is it genuinely ready; and does the final position reconcile? AIMS connects those controls into one governed workflow.” | Problem and positioning in under one minute. | If the identity catalogue is still loading, deliver the opening before selecting a persona. |
| 0:50–1:10 | Login | Select **Ethan Teo — Technology**. | “For this demo I can switch between business personas while their authorities remain separate.” | Persona separation. | Reload once. If unavailable, open the known requester session after confirming the API is ready. |
| 1:10–2:05 | Requester Dashboard | Open `PAY-2026-000003` from **Needs My Attention**. | “AIMS does not blindly move incomplete requests forward. Ethan sees exactly what Finance needs, the next owner and next action, without seeing Finance-only analysis.” | Immediate requester value. | Use **My Requests**, then open `PAY-2026-000003`. |
| 2:05–2:20 | New Request | Optional: open **New Request**, point to Payment Details, Payment Method, Documents, Review & Submit, then return. | “The requester experience stays simple. The control complexity begins behind the scenes.” | Simple capture, governed downstream process. | Skip this section if running over time. |
| 2:20–2:40 | Login | Sign out; select **Daniel Lim — Finance**. | “The same workflow looks different for Finance, because Finance needs control context rather than requester guidance.” | Capability-specific workspace. | Reload login catalogue once. |
| 2:40–3:00 | Finance Dashboard | Point to Financial Position, Needs Attention, Operations and AI Intelligence. | “This command center is organized around what Finance needs to control—not around technical modules.” | Finance control orientation. | Continue directly to Work Queue. |
| 3:00–3:20 | High-risk dashboard drill-down | Open **High / Critical Risk** and point to `PAY-2026-000002`. | “Finance immediately sees the material Marketing request requiring attention.” | Attention is visible without granting approval authority. | Keep the dashboard card visible and state the known ticket. |
| 3:20–3:45 | Login / Approval Inbox | Sign out; select **Sarah Lee**, then open `PAY-2026-000002`. | “Sarah sees only decisions within her active authority.” | Scoped business authority. | Reload the identity catalogue once. |
| 3:45–4:30 | Approval detail — Finance Context | Show **FINANCE CONTEXT · DETERMINISTIC**, available and projected position. | “Budget, actual, commitments, available and projected available are calculated deterministically from authoritative records. AI may interpret these numbers, but it cannot change them.” | Deterministic financial truth. | Use the Finance Dashboard totals as the deterministic proof. |
| 4:30–5:05 | Approval detail — risk | Show **AI ANALYSIS · ADVISORY**, then **HUMAN FINAL ASSESSMENT · ACCOUNTABLE — HIGH**. | “AI flags the material request and grounds concern in evidence. The accountable Finance decision remains human.” | AI advisory, human authority. | Show the stored AI completion events and Human Final Risk; do not call a provider. |
| 5:05–5:35 | Approval detail — policy | Show **SYSTEM POLICY · DETERMINISTIC** and Manager → Director. | “After the human risk decision, company policy determines the route. AI does not choose who approves.” | Policy is separate from AI. | Use the visible sequential approval route. |
| 5:35–6:10 | Approval detail | Do not approve in the judged run. | “Approval records an authorized business decision; it does not pay the supplier. The approver does not gain Finance Control or Payment authority.” | Authorized approval and segregation of duties. | Continue to the preseeded downstream scenarios. |
| 6:10–6:55 | Finance Control | Sign out; select **Michael Wong**. Open Finance Control and `PAY-2026-000009`. | “Approval is still not enough. Finance Control verifies approval, evidence, financial checks, payment details and duplicate protection. This is the final gate between approval and payment readiness.” | Finance Control is distinct from Approval. | Show the completed Finance Control result from request detail. |
| 6:55–7:25 | Payment Queue | Sign out; select **Nora Ismail**. Open `PAY-2026-000009`. | “Ready for Payment does not mean Paid. It means approvals and Finance controls are complete. AIMS does not execute the bank transfer.” | Readiness is not payment. | Use the Finance dashboard Ready for Payment card. |
| 7:25–8:00 | Payment History | Open `PAY-2026-000004`. | “Finance pays through the approved external banking process. When evidence is recorded, AIMS atomically records the payment, posts the actual, consumes the commitment and marks the request Paid.” | Accurate payment-recording story. | Open the known ticket from Payment History. |
| 8:00–9:00 | Finance Dashboard | Sign out; select **Grace Chen** or Daniel Lim. Show Budget 500,000; Actual 180,000; Commitments 70,000; Available 250,000; attention cards and top payee. | “The position reconciles: 500,000 minus 180,000 actual minus 70,000 commitments equals 250,000 available. Finance sees both financial truth and operational attention.” | Concrete trust anchor. | Read the verified figures from the operator cheat sheet; never improvise different totals. |
| 9:00–9:45 | Finance Watch | Open Finance Watch. Do not require a live call. | “The evidence remains deterministic. AI interpretation helps management surface patterns, but it does not calculate dashboard truth.” | Management-level AI value. | Show the controlled empty/unavailable state and continue. |
| 9:45–10:20 | Ask AIMS | Show the question: “Which department needs the most financial attention?” Do not submit unless live mode was preflighted. | “Ask AIMS is read-only, scope-authorized and grounded in controlled evidence. It is not a general chatbot and cannot run arbitrary SQL.” | Governed natural-language analysis. | Use deterministic dashboard evidence instead of submitting. |
| 10:20–10:50 | Dashboard / AI state | Point to the working dashboard while AI feature flags remain disabled. | “AI is optional. Finance Context, Policy, Approval, Finance Control, Payment and Dashboard continue when AI is disabled. AI improves interpretation and productivity—not authority or financial correctness.” | Mandatory AI OFF proof. | State the verified mode and show dashboard data. |
| 10:50–11:20 | Dashboard | Stop navigating and close. | “AIMS turns disconnected payment steps into one controlled financial workflow—from request, to decision, to payment, to visibility. AI helps Finance understand faster, but authority remains where it belongs.” | Memorable business close. | If time is short, use the final sentence only. |

## Exact navigation path

Login → Ethan Teo → Requester Dashboard → `PAY-2026-000003` → Sign out → Daniel Lim → Dashboard → High / Critical Risk → Sign out → Sarah Lee → Approval Inbox → `PAY-2026-000002` → Sign out → Michael Wong → Finance Control → `PAY-2026-000009` → Sign out → Nora Ismail → Payment Queue → `PAY-2026-000009` → Payment History → `PAY-2026-000004` → Sign out → Grace Chen → Dashboard → Finance Watch & Ask AIMS.

## Live mutation strategy

The judged run is navigation-only. Do not approve, respond to clarification, record payment, or submit an AI question. These actions are valid but add avoidable state and external-provider risk. If judges explicitly request a mutation, use Manager approval only, explain that Director becomes the next step, and reset the competition database before the next run.

## AI operating modes

- **Mode A — live provider:** use only after a bounded preflight succeeds. Submit one prepared Ask AIMS question.
- **Mode B — deterministic competition mode (default):** show stored evidence, AI advisory history, the controlled Finance Watch/Ask AIMS shell, and AI OFF continuity. Never imply that a prepared result is live.

## Rehearsal log

Record each run without pausing:

| Round | Total | Mistakes / confusion | Slowest transition | Empty/unexpected state | Decision |
| --- | ---: | --- | --- | --- | --- |
| 1 | 11:20 paced / 2:42 automated navigation | Work Queue is intentionally pre-approval only; moved high-risk evidence to authorized Approval detail. | Payment Operator switch, 10.1s | None | Correct click path only. |
| 2 | 11:20 paced / 0:55 automated navigation | None after click-path correction | Cold workspace loads, about 3.3s | None | PASS; dataset remained unchanged. |
| 3 | 11:20 paced / 1:00 automated navigation | None | Requester cold login, 6.3s; other cold loads about 3.3s | None | PASS; final judging mode, no mutation or debugging. |

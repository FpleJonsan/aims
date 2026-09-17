# AIMS Competition Deck — Speaker Notes

These notes match the notes embedded in `AIMS-Competition-Deck-v1.pptx` (View → Notes in PowerPoint/Keynote/Google Slides). Target: ~60–90 seconds per main slide, ~30–45 seconds per appendix slide if used.

---

## 1 — AIMS (Title)

AIMS — AImazing Intelligent Management System. AI-powered payment and finance control. This is not a concept deck: AIMS is a working, end-to-end product that has gone through engineering acceptance and a real recorded workflow. Everything in this deck reflects the actual implemented system. Tagline: From Request, to Control, to Financial Intelligence.

## 2 — The Problem

A payment request looks simple, but the financial reality behind it isn't. Every request carries budget pressure, historical spending, existing commitments, financial risk, compliance considerations, approval authority, payment readiness, and the need for an audit trail. Today most of that stays invisible until something goes wrong — a duplicate payment, an over-committed budget, an approval that skipped a step. AIMS exists to make that hidden complexity visible and controlled at every step.

## 3 — The AIMS Idea

Traditionally, a payment request scatters across emails, chats, and spreadsheets, gets checked manually, approved in a fragmented way, and ends with limited visibility into what actually happened. AIMS turns this into one controlled journey: the same request flows through AI understanding, financial truth, AI analysis, a human decision, finance control, a payment record, and finally intelligence. Notice the pattern — AI steps and system/human steps alternate deliberately. AI never stands alone at a decision point.

## 4 — How AIMS Works

AIMS keeps the full 12-stage payment request lifecycle intact — nothing skipped, nothing shortcut. We group it into five phases for clarity: Request (stages 1–3) captures and validates the ask. Understand & Analyze (4–5) builds financial context and runs risk analysis. Decide (6–7) applies policy and gets human approval. Control & Record (8–10) is where Final Finance Control, payment processing, and the payment record happen. Visibility & Intelligence (11–12) is the Finance Dashboard and AI Finance Intelligence. Authentication and user administration are platform capabilities — deliberately outside this lifecycle.

## 5 — AI + Financial Truth

This is the core idea of AIMS. AI interprets — it reads documents, flags financial risk signals, spots spending patterns, checks compliance indicators, and explains its reasoning in plain language. But AI never calculates the authoritative financial position. That's the system's job, deterministically: active budget, actual ledger, active commitments, available position, and the ledger impact of a payment. The equation is fixed and code-level, verified directly in AIMS's finance-context calculation: **Available = Active Budget − Actual Ledger − Active Commitments**. AI is never the source of truth for a balance.

## 6 — Multi-Agent Financial Analysis

Financial Risk Analysis runs as multiple focused AI agents — Financial Risk, Spending Pattern, and Compliance — each looking at the request from a different angle. Their outputs are combined by an Aggregator into one evidence-backed assessment. Critically, that assessment is not the decision. It feeds a Human Final Assessment, where a person makes the actual call. Multiple perspectives, one evidence-backed summary, human authority stays final. Worth noting honestly: in our own rehearsal environment, some of these AI sub-agents hit provider timeouts under a smaller reasoning model — the design point is that the human review step never depended on them succeeding.

## 7 — Human Governance

This is the governance backbone. A request moves from Requester through Policy to an Approver — but approval is not the end. Final Finance Control is a separate, deterministic gate performed by Finance after approval, checking approval completeness, evidence, amount and payee integrity, budget reservation, and duplicate-payment protection. Only after that does an external payment happen, which AIMS then records. Two statements we want judges to remember: **Approved does not equal Ready for Payment**, and **AI never approves payments** — full stop. Segregation of duties is enforced by role: Requester, Approver, Finance, Finance Master, and Technical Admin are distinct, and a Technical Admin's system access is explicitly not financial authority.

## 8 — Real End-to-End Case

This is a genuine request from our own environment, not a mockup: PAY-2026-000041, BrightWave Media Sdn. Bhd., Operations department, Digital Marketing Campaign, MYR 18,500 total across three claims — Campaign Media Placement, Creative Production, and Campaign Analytics Service. We pulled this directly from the live system: it was submitted, AI-validated, financially analyzed, approved by a human, controlled by Finance, had its payment recorded, and shows PAID today. This is the same lifecycle from slide 4, walked end to end on a real case.

## 9 — Financial Visibility

These are the real, live figures on our Finance Dashboard immediately after PAY-2026-000041 was paid — not illustrative numbers. Active Budget MYR 121,000, Actual Spending MYR 76,000, Active Commitments MYR 109,000, which nets to an Available position of **negative MYR 64,000**. Paid This Period is MYR 56,000 across 4 processed requests. Every one of these is system-calculated, not AI-generated. The point of this slide is the negative Available figure: AIMS shows it in red, on the live dashboard, rather than hiding budget pressure. That is what real financial visibility looks like.

## 10 — Ask AIMS

We asked Ask AIMS, in our live environment: *"What is the total financial impact of payments made this period?"* It answered: *"Total financial impact (sum of provided paid amounts) for the selected period is MYR 56000.00."* That is the exact figure the deterministic Finance Dashboard already showed as Paid This Period. This is the point of evidence-bounded AI: Ask AIMS only reasons over authorized evidence it's given — it doesn't run arbitrary queries, and in other real runs in our environment it has explicitly refused to answer when the evidence didn't support a claim, rather than guessing. Financial truth first, AI explanation second.

## 11 — Why AIMS Matters (Closing)

AIMS's strength isn't maximum automation — it's intelligent control. Five things it delivers: **Control**, financial truth established before any payment; **Efficiency**, one workflow instead of fragmented manual checking; **Intelligence**, AI turning evidence into decision support rather than decisions themselves; **Governance**, humans and Finance keeping authority end to end; and **Visibility**, every payment updating the real financial picture. These map naturally to our company principles — Integrity in financial truth and governance, Efficiency in one unified workflow, Continuous Learning in AI-driven financial intelligence, Teamwork across Requester, Approver, and Finance, and Customer First in faster, clearer payment handling. From Request, to Control, to Financial Intelligence. That's AIMS.

---

## Appendix A1 — Architecture

For technical judges: the frontend is Next.js/React, the API is NestJS with strict DTO validation, and the database is PostgreSQL with append-only history and lifecycle triggers. The background worker is PostgreSQL-backed, not Redis/BullMQ — that was an early plan the team deliberately revised during implementation, a documented and reasoned trade-off. AI runs through an OpenAI-compatible provider with Zod-schema-validated structured outputs. Document storage today is a local adapter for development and demo; production-grade object storage is a stated prerequisite, not simulated. Notifications flow through web domain commands with an optional Telegram adapter that never owns approval logic.

## Appendix A2 — AI Governance

AI in AIMS is fully optional. There's a master switch plus independent per-capability flags for Document Validation, Financial Risk, Spending Pattern, Compliance, Finance Watch, and Ask AIMS. Three operating modes exist: AI-Assisted, Manual, and AI-Unavailable Fallback — the deterministic Finance Dashboard always remains available regardless of AI state. Every AI result is schema-validated, human assessment is always preserved alongside it, and each result is source-tagged AI, MANUAL, or RULE_BASED. We're transparent that in our own rehearsal environment, several AI sub-agents hit provider-side timeouts — the product is built to fail safely, not to hide that.

## Appendix A3 — Enterprise Controls

A quick rundown of the enterprise controls that make AIMS auditable: a database-backed Role/Permission Matrix across every major module; a configurable Approval Matrix with delegation support; Final Finance Control as a separate deterministic gate after Approval; an append-only, immutable audit trail with lifecycle triggers; payment idempotency that blocks silent duplicate execution; and database-enforced trust boundaries, meaning authorization is never taken on faith from the frontend alone.

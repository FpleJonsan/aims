# AIMS Competition Deck — README

## Files in this folder

| File | What it is |
| --- | --- |
| `AIMS-Competition-Deck-v1.pptx` | Editable PowerPoint deck (11 main slides + 3 appendix slides) |
| `AIMS-Competition-Deck-v1.pdf` | PDF export of the same deck, for sharing/printing |
| `AIMS-Competition-Deck-Speaker-Notes.md` | Slide-by-slide presenter script (matches the notes embedded in the .pptx itself — View → Notes) |
| `generate-deck.js` | The `pptxgenjs` script that generated the .pptx (run with `node generate-deck.js` after `npm install pptxgenjs` in this folder) |
| `README.md` | This file |

## Deck structure

11 main slides following the arc: Title → The Problem → The AIMS Idea → How AIMS Works (12-stage lifecycle) → AI + Financial Truth → Multi-Agent Financial Analysis → Human Governance → Real End-to-End Case (PAY-2026-000041) → Financial Visibility → Ask AIMS → Why AIMS Matters (closing).

3 appendix slides for technical judges: A1 Architecture, A2 AI Governance, A3 Enterprise Controls.

## How every fact in the deck was verified

Every specific claim, figure, and workflow name in this deck was checked against the actual repository and the live running system — not taken on faith from the brief that requested this deck. In particular:

- **The 12-stage lifecycle names** were cross-checked against `docs/PROJECT-RULES.md`, `README.md`, `docs/PROJECT-PROGRESS.md`, and the live frontend source (`app/page.tsx`'s `stages` array). All four agree.
- **The financial truth formula** (`Available = Active Budget − Actual Ledger − Active Commitments`) is quoted from the actual calculation code in `apps/api/src/domain/finance-context.ts`, not from documentation.
- **PAY-2026-000041 and its financial figures were not found in `docs/demovideo.md`** on first pass — that document's rehearsal narrative only goes up to PAY-2026-000040. Rather than treat this as a fabricated case (as the initial repo-only research suggested), we connected directly to the project's local PostgreSQL container (`aims-site-postgres-1`) and queried it read-only. This confirmed PAY-2026-000041 is a real, `PAID` request created after `docs/demovideo.md` was last saved — i.e. a genuine "final recording" pass that simply hadn't been written back into the docs yet. Every figure in the deck (claim items, MYR 121,000 / 76,000 / 109,000 / −64,000 / 56,000 / 4 requests) and the exact Ask AIMS answer text were confirmed against live database rows (`payment_requests`, `claim_items`, `finance_context_snapshots`, `budgets`, `budget_versions`, `financial_ledger_entries`, `budget_commitments`, `payments`, `finance_ask_runs`), and the MYR 121,000/76,000/109,000/−64,000 dashboard figures were additionally confirmed visually on the live running Finance Dashboard (`localhost:3000`), which labels every one of these figures "SYSTEM CALCULATED."
- Where the task brief's assumptions conflicted with the repository (e.g. the original "locked" tech stack in `docs/PROJECT-RULES.md` — Nuxt/Vue, Prisma, Redis+BullMQ), the deck follows what is **actually implemented** (Next.js/React, raw `pg`, a PostgreSQL-backed worker), and Appendix A1 notes this as a deliberate, documented engineering pivot rather than an inconsistency to hide.

## Visual design

The palette is pulled directly from AIMS's own live, adopted design system (`app/design-system/tokens.css`, imported via `app/components/ui/ui.css` and used across the real product UI):

- Deep finance green `#173F2E` (primary/authority)
- AI advisory violet `#6D51A8` (used only for AI-labeled content, matching the product's own rule that violet marks "advisory, never authority")
- Warm neutral background `#F5F6F3`, white cards
- Semantic success/warning/danger colors for status

**One deliberate deviation from the brief:** the brief asked for "restrained lime accents." We found a lime value (`#c8ff65`) in the repo, but it lives in `app/globals.css`, which is dead CSS from an earlier, discontinued marketing-page concept — it is not rendered by anything reachable in the current product. Since the brief also says "match the actual AIMS visual language," we followed the real, live design system instead of resurrecting an unused color, and used the violet AI-accent already used throughout the shipped UI in its place.

Fonts are Cambria (headers) and Calibri (body) — both ship with Office and render true-to-width, so the deck's text fit is reliable in PowerPoint, not just in our preview renderer.

## Screenshot sources — none embedded, and why

**No screenshots of the running AIMS UI are embedded in this deck.** This was a deliberate choice, not an oversight:

- The repository has **no existing screenshot images** anywhere — `docs/demo-assets/` contains only 7 synthetic invoice/payment-slip PDFs (fake demo documents for the video shoot), not UI captures.
- The AIMS dev server was running locally, and we did view the live Finance Dashboard in a browser to **verify** the real figures used on slide 9 — but capturing that view as a reusable image file for the deck would have required either (a) a fresh, unauthenticated browser session, which hits AIMS's real password login and we had no credentials for, or (b) extracting/bypassing authentication, which we won't do.
- Per the brief's own fallback instruction ("if screenshots are not available or cannot be safely captured, use clean diagrammatic representations instead"), every slide that would otherwise show a screenshot instead uses a clean, custom diagram or stat-card layout built in the verified brand palette, with labels lifted verbatim from real UI copy where we could confirm it (e.g. "SYSTEM CALCULATED" badges, which are the actual label used on the live dashboard).

If a real screenshot pass is wanted later, the fastest safe path is: someone with valid AIMS credentials logs in once in a real browser, and screenshots are captured from that authenticated session directly (or Playwright is given real test credentials to automate it).

## Claims intentionally excluded or caveated

- **No ROI, cost-savings, or time-saved percentages.** The repository contains no measured production metrics to support any such number, and the brief explicitly says not to invent them. The closing slide uses qualitative value statements only.
- **No "production-ready" or "battle-tested" framing.** `docs/PROJECT-PROGRESS.md` states outright: *"Overall Production ready: NO"* (current phase is release hardening / final sign-off, explicitly marked pending re-review). The deck's language ("working, end-to-end product... completed engineering acceptance") matches what the brief specified without overstating deployment status.
- **Finance Watch is not showcased as a live-reliability success.** Per `docs/demovideo.md`, Finance Watch had a 0% observed success rate (timeouts) across both rehearsal passes in this environment. It's mentioned only as an implemented, toggleable capability in Appendix A2, with an explicit "fails safely" caveat — never framed as a demonstrated success.
- **AI sub-agent reliability is caveated, not hidden.** Several AI sub-agents (Document Validation, Financial Risk, Spending Pattern) experienced ~90-second provider timeouts against the `gpt-5-mini` model in rehearsal. Slides 6 and Appendix A2 note this honestly rather than implying uniform AI reliability.
- **The two "Locked Technology Direction" documents** (`docs/PROJECT-RULES.md`, `docs/DAY-0-ARCHITECTURE-REPORT.md`) specify Nuxt/Vue/Prisma/Redis+BullMQ. The deck describes what actually shipped (Next.js/React, raw `pg`, PostgreSQL-backed worker) and frames the difference as a documented, reasoned engineering decision (see `docs/production/p7-redis-worker-decision.md`), not a discrepancy to gloss over.

## Assumptions

- "Judges" are assumed to be a mixed audience of business, finance, and technical reviewers, per the brief — main slides stay business-readable; technical depth is pushed to the appendix.
- The competition case (PAY-2026-000041) is presented as this environment's genuine UAT/competition data, not company-wide production financial data, consistent with the brief's instruction.
- Where the brief's suggested design language (5 principles, lime accent, specific narrative beats) could be honored without conflicting with verified facts, it was; where it conflicted with what the repository/live system actually shows, the verified reality took precedence.

## Regenerating or editing the deck

The deck was built programmatically with `pptxgenjs` (`generate-deck.js` in this folder) rather than hand-edited XML, and every shape/text box is a native, editable PowerPoint object (no flattened images). Two ways to edit:

1. **Direct edit**: open `AIMS-Competition-Deck-v1.pptx` in PowerPoint/Keynote/Google Slides and edit slides normally.
2. **Regenerate from source**: edit `generate-deck.js` (colors are centralized in the `C` palette object at the top; each slide is a separate `{ ... }` block), then run:
   ```
   npm install pptxgenjs
   node generate-deck.js
   ```
   This overwrites `AIMS-Competition-Deck-v1.pptx` in place — re-export to PDF afterward if needed (`soffice --headless --convert-to pdf AIMS-Competition-Deck-v1.pptx`, or File → Export in PowerPoint/Keynote).

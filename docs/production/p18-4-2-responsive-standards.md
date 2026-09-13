# P18.4.2 — Responsive Design Standard (AIMS)

Status: STANDARDS ONLY / no CSS, component, or behavior changes in this phase.

Basis: P18.4.1 Responsive Audit (Critical F1, F2; Major F4, F5, F6; Minor F3).
This document defines the one canonical responsive standard all later
implementation phases (P18.4.3+) must follow. It does not itself fix anything.

---

## 1. Executive Result

AIMS has no single authoritative responsive standard today. Shell-level rules
for `.sideNav` / `.appShell` are defined redundantly across at least three
separate `@media(max-width:900px)` blocks and two separate
`@media(max-width:600px)` blocks in `app/day1.css` (audit F5), which produced
two Critical defects that reproduce on every screen below 1024px: a ~250px
dead-space region in the collapsed header (F1) and an unreachable table
action column (F2). Per-screen `*-ui.css` files are comparatively well-behaved
but thin, and inherit shell defects rather than causing new ones (F6). This
document fixes nothing; it defines the standard that the follow-up
implementation phase will fix *against*, so there is one rule per concern
instead of three.

## 2. Responsive Principles

1. **One rule, one place.** Every selector group has exactly one authoritative
   responsive definition. If two rules could apply at the same viewport, that
   is a defect in the standard, not an acceptable overlap (directly answers F5).
2. **Shell vs. screen separation.** Shell/shared-chrome rules (sidebar, header,
   workspace, app grid) live together in one shell location. Screen-specific
   rules live only in that screen's `*-ui.css`. Nothing shared may be
   redefined inside a per-screen file, and nothing screen-specific may leak
   into the shell file.
3. **No dead space.** A responsive collapse must never leave a container
   larger than the content it holds. Height changes at a breakpoint are always
   paired with an explicit `height`/`min-height` reset for that breakpoint
   (answers F1).
4. **No unreachable content.** Content that does not fit its container must
   either reflow, or become horizontally scrollable inside its own
   container. It must never be clipped by an ancestor with no way back to it
   (answers F2). A primary action is never the thing sacrificed to make a row
   fit.
5. **Financial data is never mangled for layout.** Numbers, currency values,
   and words are never broken mid-token to save space (answers F4).
6. **Three breakpoints, no silent fourth.** Every responsive rule is written
   against Desktop / Tablet / Mobile. Narrower internal breakpoints are
   permitted only as documented refinements inside Tablet or Mobile (see §3),
   never as an undocumented parallel system.
7. **Standards are testable.** Every rule in this document maps to at least
   one line in the Verification Checklist (§12). A rule that cannot be
   checked is not a rule.

## 3. Official Breakpoints

| Band | Range | CSS query |
|---|---|---|
| Desktop | ≥1024px | default / no query, or `@media(min-width:1024px)` |
| Tablet | 768–1023px | `@media(max-width:1023px)` down to `@media(min-width:768px)` |
| Mobile | ≤767px | `@media(max-width:767px)` |

No additional breakpoint **family** is introduced. This matches the bands
used to conduct P18.4.1 and matches the two widest, most consequential
thresholds already in the codebase (`1024px`, `768px`).

**Existing sub-breakpoints (1200, 900, 600, 480px)** found in `day1.css` and
the per-screen `*-ui.css` files are **retained as internal refinements**, not
deprecated, because several genuinely useful distinctions (e.g. a 5-column
KPI grid dropping to 3 columns before it needs to drop to 1) live inside the
Tablet/Mobile bands. Rule for using them going forward:

- `1200px` refinements are treated as **early Desktop-band easing** (they may
  only reduce column count/spacing; they must not change shell structure,
  navigation mode, or `overflow` behavior — those change only at 1024/768).
- `900px` and `600px` refinements are treated as **internal Tablet/Mobile
  sub-steps**, not a fourth public band.
- `480px` is treated as an **internal Mobile sub-step** for
  type-scale/spacing only.
- A sub-breakpoint may only appear **once per selector group**, in the one
  location Governance (§10) assigns it. It may not be redeclared elsewhere
  "for convenience."

## 4. Shell Standards

One authoritative rule per selector group. Each of the following currently
has 2–3 competing definitions in `day1.css` (F1, F5); going forward each has
exactly one.

| Selector group | Desktop (≥1024) | Tablet (768–1023) | Mobile (≤767) |
|---|---|---|---|
| **App shell** (`.appShell`) | `display:grid; grid-template-columns: <sidebar-width> minmax(0,1fr)` | `grid-template-columns: 1fr` (single column, sidebar becomes a row) | same as Tablet |
| **Sidebar** (`.sideNav`) | `position:sticky; top:0; height:100vh; overflow-y:auto; flex-direction:column` | `position:relative; height:auto; flex-direction:row; overflow:visible` — **height is explicitly reset to `auto`, never inherited from the Desktop `100vh` rule** | same structural mode as Tablet, condensed padding/spacing only |
| **Header / nav toggle** (`.mobileNavToggle` etc.) | not rendered (full nav visible) | rendered; label may truncate only after content-driven `flex` sizing gives way, never a fixed `max-width` guess (mitigates F3) | same as Tablet |
| **Navigation** (`.primaryNav`) | always visible, vertical list | visible inline / horizontal row *or* collapsed behind the nav toggle — pick one mode per app, do not mix | collapsed behind nav toggle, full-width dropdown when open |
| **Workspace** (`.workspace`) | `max-width` clamp, comfortable side padding | full width, reduced padding | full width, minimum padding |
| **Content width** | `max-width: 1720px` (current value retained) | `max-width: 100%` | `max-width: 100%` |
| **Overflow** | `.appShell`/`.workspace`: `overflow-x: hidden` is permitted **only** at the outermost shell level, and only to stop the *page* from growing wider than the viewport — it must never be the mechanism that clips an intentionally wide inner element (see Table Standards §6). Any element that is deliberately wider than its parent (e.g. a table needing horizontal scroll) must set its **own** `overflow-x:auto`, and that ancestor `overflow:hidden` must not sit between it and the viewport (directly resolves F2). |
| **Sticky behavior** | Sidebar sticky (`position:sticky; top:0`) | Not sticky (sidebar is now a row in normal flow) | Not sticky |
| **Spacing** | `--space-*` tokens, largest step at this band | one step down from Desktop | smallest step, never below the token scale's minimum |
| **Height** | Sidebar: `100vh`. Workspace: `min-height:100vh` via `.appShell`. | Sidebar: `auto` (see above). Workspace: `auto`, grows with content. | same as Tablet |

**Rule:** any change to a Shell Standards row must be made in exactly one
place. If `.sideNav` needs a Tablet-band rule, it is written once, in the
shell's single Tablet media block — never split across multiple
`@media(max-width:900px)` blocks in the same or different files.

## 5. Layout Standards

| Element | Standard |
|---|---|
| **Cards** | Collapse to 1 column at Mobile. May hold 2–3 columns at Tablet if content permits (short labels/KPIs only). A card containing a **data table** is exempt from column-count rules — it follows Table Standards (§6) instead, including permission to span additional grid columns so its table is never the narrowest element on the page (resolves F4). |
| **Grid** (KPI grids, dashboard grids) | Desktop: up to 5 columns. Tablet: 2–3 columns. Mobile: 1 column. Column count steps down monotonically; no grid may skip Tablet and go straight from 5 to 1. |
| **Sections** | Section headers (`.sectionHeading` and similar) keep label + action on one row at Desktop/Tablet; stack at Mobile only if the action text would otherwise truncate. |
| **Panels** (AI panels, filter panels, budget panels) | Same column rules as Cards. Panels never set their own `overflow-x`; only Tables do. |
| **Journey Rail** (`.stageRail`, `.compactJourney`, `.journeySummary`) | Always horizontally scrollable (`overflow-x:auto`) at Tablet/Mobile, with a `min-width` per step so steps never compress below legible size. This is the one place a "horizontal scroll instead of reflow" pattern is preferred over stacking, because a rail is inherently sequential. |
| **Dialogs** (`.submitConfirmation` and future modals) | `width:min(100%, 520px)` at all bands; footer actions are a row at Desktop/Tablet and stack (`display:grid`) at Mobile. Dialogs never exceed viewport height; internal content scrolls, the dialog chrome does not. |
| **Timeline** | Same rule as Journey Rail: horizontal scroll with per-entry `min-width`, never mid-word wrapping of a timestamp or actor name. |
| **Forms** | 2-column field grid at Desktop/Tablet (≥768px) collapses to 1 column at Mobile. This is already the best-performing pattern in the app (`request-ui.css`) and is the reference implementation for all other forms. |
| **Buttons** | Full-width stacking only at Mobile for primary/secondary action pairs in a footer; otherwise inline. See Interaction Standards (§8) for sizing. |
| **Filters** | Same column rules as Cards/Grid. A filter field never truncates its own label; the field's own width shrinks before the label does. |
| **Tables** | See §6, dedicated section. |
| **Pagination** | `Previous / Page X of Y / Next` stays on one row at all three bands (already confirmed working in audit). Never wraps; if space is insufficient, the page-count text abbreviates before the Previous/Next buttons shrink. |

## 6. Table Standards

This section exists specifically to close F2 and prevent its recurrence in
the screens identified at risk by F6 (Approval, Policy, Validation, Finance
Context, Financial Analysis, History).

1. **Horizontal scrolling is owned by the table, not an ancestor.** Every
   table/row-list component sets its own `overflow-x:auto` (with
   `scrollbar-width:thin` or equivalent) directly on the scrolling container.
   No ancestor between the table and the viewport may set `overflow:hidden`
   on the horizontal axis. (Directly resolves F2's "workspace clips the
   table" failure mode.)
2. **Minimum widths are explicit, not incidental.** A table row's total
   minimum width is a deliberate, documented number (e.g. `min-width:720px`),
   set once, and paired with the `overflow-x:auto` from rule 1 on the same
   component — never one without the other.
3. **Column sizing uses a floor, never bare `auto` for load-bearing
   columns.** Every column is `minmax(<floor>, <flexible>)`. A column may
   never be plain `auto` if its content is required for the row to be usable
   (ticket ID, amount, status, primary action). Plain `auto` is reserved for
   genuinely optional/decorative columns only.
4. **Primary action columns never collapse below usable width.** This is a
   hard rule, not a guideline: any column containing the row's primary
   action (e.g. "Open Request →", "Review →") has a non-negotiable minimum
   (e.g. `minmax(120px, auto)`) and is never the column sacrificed when the
   row runs out of horizontal space. If the row cannot fit all columns at
   the current width, the row scrolls (rule 1); the action column is never
   the one that silently reaches 0px, as measured live in F2.
5. **Overflow beyond the minimum width scrolls; it is never clipped.**
   Corollary of rules 1 and 4.
6. **Wrapping:** table cells use `white-space:nowrap` for identifiers,
   amounts, dates, and status chips. Only free-text description columns may
   wrap, and when they do, wrapping breaks on whitespace only
   (`overflow-wrap:normal`) — never mid-word or mid-number (resolves F4).
7. **Numeric cells** are right-aligned (or use `font-variant-numeric:
   tabular-nums`, already used elsewhere in the codebase) and never break
   across lines. A currency amount is one atomic token: `MYR 20,000.00` is
   never split into `MYR 20,000.0` / `0`.
8. **Financial values** (amounts, budgets, spend) additionally never lose
   their currency code or sign to save width; if a column is too narrow to
   show the full value, the row scrolls (rule 1), the value is never
   abbreviated or truncated.
9. **Evidence tables** (audit/validation extracted-fact tables, policy
   requirement tables) follow the same 9 rules as any other table — there is
   no separate "read-only table" exemption, since F6 identified these as the
   highest-risk inheritors of F2 once populated with real data.
10. **History tables** (Payment History and similar immutable-record lists)
    additionally guarantee the record identifier and paid-amount columns are
    never the ones compressed — these are the two fields most likely to be
    referenced outside the app (e.g. in a support ticket).

## 7. Typography Standards

| Concern | Standard |
|---|---|
| **Responsive type scale** | Headings use `clamp()`-based sizing (already in use, e.g. `clamp(28px,2.4vw,34px)`); this pattern is retained as the standard rather than fixed per-breakpoint `font-size` overrides, because it eliminates a class of duplicate-breakpoint bugs (F5) by design. |
| **Line height** | Body text: 1.45–1.6. Headings: 1.0–1.2. Never below 1.3 for any paragraph/help text, to keep wrapped lines legible at Mobile widths. |
| **Wrapping** | Default `overflow-wrap:normal; word-break:normal` everywhere. `word-break:break-all` / aggressive breaking is disallowed for any element that can contain a number, currency value, identifier, or proper noun (resolves F4). It may only be used, deliberately, for genuinely unbreakable machine strings (e.g. a raw hash) with no better option. |
| **Number formatting** | Numbers are formatted once, upstream of layout (grouping separators, fixed decimals), and then treated as an atomic, non-wrapping token per §6.7. Layout never re-breaks a formatted number. |
| **Financial value presentation** | Always `<currency code> <amount>` as one unit (e.g. `MYR 20,000.00`), `tabular-nums`, right-aligned in tables, never wrapped, never abbreviated without an explicit, opt-in "compact" mode (not currently in scope). |
| **Word breaking** | See "Wrapping" above — normal breaking only, no mid-word breaks for human-readable text. |
| **Ellipsis usage** | Ellipsis truncation (`text-overflow:ellipsis`) is permitted only on elements with a genuinely fixed, small container (e.g. a status chip) — not on primary navigational labels with a guessed `max-width` (the cause of F3). Where a label's content is dynamic (e.g. current page name), prefer flexible sizing (`flex:1 1 auto; min-width:0`) over a fixed `max-width` + ellipsis guess. |

## 8. Interaction Standards

| Concern | Standard |
|---|---|
| **Touch targets** | Minimum 44×44px hit area for any interactive control at Tablet/Mobile (the existing `--aims-control-touch-height` token under `pointer:coarse` is the correct mechanism and is retained as the standard). |
| **Minimum control height** | Buttons/inputs: `min-height:38–40px` at Desktop, `min-height:42–44px` at Tablet/Mobile (matches existing `button` / `input` baseline rules). |
| **Button stacking** | Inline (row) at Desktop/Tablet; stacked (`display:grid`, full width) at Mobile for footer action pairs, matching the existing `.requesterDraftForm>footer` / `.submitConfirmation section>div` pattern — this is the standard, not the exception. |
| **Busy state** | Any async action (submit, refresh) shows a visible busy/loading state (spinner or disabled state with label) at all three bands; a busy control is never simply invisible or silently disabled without indication. |
| **Hover behavior** | Hover affordances (`:hover` backgrounds, etc.) are Desktop-only enhancements. They must never be the *only* way to reveal required information or controls, since Tablet/Mobile have no hover. |
| **Focus behavior** | Every interactive element has a visible `:focus-visible` outline at all three bands (existing `outline:3px solid color-mix(...)` pattern is the standard). Focus styling must not be removed or weakened at any breakpoint. |
| **Scroll behavior** | Page-level scroll is vertical only. Horizontal scroll is only ever local to a component that declares it deliberately (Tables §6, Journey Rail/Timeline §5) — the page body itself never scrolls horizontally (already partially enforced via `overflow-x:hidden` on `.appShell`/`.workspace`, retained per §4). |

## 9. Accessibility Standards

| Concern | Standard |
|---|---|
| **Responsive focus** | Tab order follows visual/reading order at every breakpoint; a component that reflows (e.g. grid to single column) must not reorder focus away from visual order. |
| **Screen reader consistency** | Content hidden visually at a given breakpoint (e.g. section labels hidden at Mobile) uses `display:none` (removed from the accessibility tree consistently) rather than visually-hidden-but-still-announced, unless the hidden text is the *only* description of an icon-only control, in which case an `aria-label` is required instead of relying on the visually-hidden text. |
| **Visible labels** | A control's visible label is never the only thing removed to save space at a smaller breakpoint (e.g. `.primaryNav button span{display:none}` patterns must retain an `aria-label` or equivalent when the visible text is hidden). |
| **Keyboard navigation** | The mobile nav toggle (hamburger) is a real `<button>` with `aria-expanded`/`aria-controls` (already the pattern in use) at all breakpoints; this is retained as the standard for any future collapsible nav element. |
| **Zoom / 200% browser zoom** | Layout must remain usable (no clipped/unreachable primary actions, per §6.4) at 200% browser zoom at Desktop width, which is effectively equivalent to testing at a Tablet-width viewport. This is treated as a **required** check, not optional, since it is the standard mechanism low-vision users rely on. |
| **High DPI** | Icons/graphics use vector (SVG/font-icon) or `@2x`-equivalent assets; no responsive rule may assume a specific device-pixel-ratio for layout decisions (only for asset selection). |

## 10. Governance Standards

1. **One breakpoint block per selector group.** For any given selector (e.g.
   `.sideNav`), there is exactly one `@media(max-width:1023px)` (or the
   relevant sub-breakpoint) declaration in the entire codebase. Adding a
   second is a standards violation, full stop — this is the rule that, if it
   had existed, would have prevented F1 and F5.
2. **Shared shell rules must live together.** All shell-level selectors
   (`.appShell`, `.sideNav`, `.mobileNavToggle`, `.primaryNav`, `.workspace`,
   `.userCard`) are defined in one shell location (currently `day1.css`; a
   future refactor may extract this to a dedicated `shell.css`, but it must
   remain a single file/section, not split across phases of edits).
3. **Per-screen rules must stay inside `*-ui.css`.** A screen's own file
   (e.g. `policy-ui.css`, `validation-ui.css`) may only define selectors
   scoped to that screen's own class prefix (`.p1834-policy …`,
   `.p1833-validation …`). It must never redefine a shared shell selector,
   and the shell file must never define a screen-specific selector.
4. **Never duplicate the same breakpoint across multiple locations for the
   same selector.** This applies within a file (no two
   `@media(max-width:900px){ .sideNav{...} }` blocks) and across files (a
   screen file must not re-declare a shell selector at a breakpoint the
   shell file already covers).
5. **New tables/lists reuse the standard, not a bespoke pattern.** Any new
   or modified table-like component implements Table Standards §6 directly
   (via the shared `.table` pattern) rather than inventing a new column/
   overflow strategy per screen — this is how F6's risk (six screens
   inheriting F2 once populated) is closed for good going forward.
6. **This document is the tiebreaker.** Where existing CSS conflicts with
   this standard, this standard wins for all new work; reconciling existing
   CSS with the standard is the explicit job of the implementation phase
   (§11), not something to be worked around ad hoc elsewhere.

## 11. Implementation Priority

Fixes are grouped so that dependent work lands together and nothing is fixed
twice.

**Priority 1 — Critical**
- Consolidate the ≥3 overlapping `@media(max-width:900px)`/`600px`
  `.sideNav`/`.appShell` blocks in `day1.css` into one shell definition
  (closes F1 and, structurally, F5's shell-related duplication).
- Give `.table` (and `.financeQueueList`, `.paymentRows`, and equivalents) an
  owned `overflow-x:auto`; remove reliance on `.workspace{overflow:hidden}`
  as a clipping mechanism; add a `minmax()` floor to every primary-action
  column (closes F2).

**Priority 2 — Major**
- Finish de-duplicating the remaining overlapping breakpoint blocks in
  `day1.css` not already covered by Priority 1 (closes remainder of F5).
- Fix the Budget & Spending / Financial Analysis department table's
  mid-word/mid-number wrapping per Table §6 rule 6–8 and Typography §7
  (closes F4).
- Re-verify Approval, Policy, Validation, Finance Context, Financial
  Analysis, and History against Table Standards §6 with populated data,
  since these were identified as at-risk but unconfirmed (closes F6).

**Priority 3 — Minor**
- Replace the fixed `max-width` + ellipsis truncation on the mobile nav
  toggle label with content-driven flexible sizing (closes F3).

**Priority 4 — Polish**
- Widen or shorten the "All authorized departments" filter option label.
- Confirm Login role-name overflow behavior against a deliberately long
  role label.
- Live-verify the `.submitConfirmation` dialog and populated Timeline
  component against §5, since these were assessed from CSS only in
  P18.4.1.

Work belonging together: the two Priority 1 items are independent of each
other (one is shell layout, one is table overflow) and may be implemented in
either order or in parallel, but both must land before Priority 2's F6
re-verification, since that re-verification is only meaningful once F2 is
actually fixed.

## 12. Verification Checklist

For each item, check at Desktop (1280px), Tablet (768px), and Mobile
(375px) unless noted otherwise.

- [ ] No selector group has more than one responsive rule definition for the
      same breakpoint anywhere in the codebase (grep for duplicate
      `@media(max-width:NNNpx)` blocks touching the same selector).
- [ ] `.sideNav` computed height is content-driven (not a fixed `100vh` or
      any other value taller than its rendered children) at Tablet and
      Mobile.
- [ ] No shell container has more than ~8px of unexplained empty space
      beyond its content + padding at any breakpoint.
- [ ] Every table/row-list's primary action column is clickable and fully
      visible at Tablet and Mobile (never 0px, never clipped).
- [ ] Every table wider than its container scrolls horizontally within its
      own boundary; the page body itself never scrolls horizontally.
- [ ] No ancestor `overflow:hidden` sits between a scrollable table and the
      viewport.
- [ ] No numeric, currency, identifier, or date cell wraps or breaks
      mid-token at any breakpoint, including Desktop.
- [ ] Financial values render as one atomic token (`<code> <amount>`) at
      every breakpoint.
- [ ] Pagination controls stay on one row at all three breakpoints.
- [ ] Forms collapse from 2 columns to 1 column at the Mobile boundary only,
      matching the Request form reference pattern.
- [ ] Dialogs never exceed viewport height; footer buttons stack at Mobile.
- [ ] Journey Rail / Timeline scroll horizontally with legible per-step
      minimum width; no step compresses below its minimum.
- [ ] All interactive controls meet the 44×44px touch target minimum at
      Tablet/Mobile.
- [ ] `:focus-visible` is present and visible on every interactive element
      at every breakpoint.
- [ ] Tab order matches visual order after any breakpoint-driven reflow.
- [ ] Icon-only controls whose text label is hidden at a breakpoint retain
      an `aria-label`.
- [ ] Layout remains usable (no clipped primary actions) at 200% browser
      zoom on a Desktop-width viewport.
- [ ] Shared shell selectors are not redefined inside any `*-ui.css` file;
      screen-scoped selectors are not defined in the shell file.

## 13. Files Created

- `docs/production/p18-4-2-responsive-standards.md` (this document) — the
  official Responsive Design Standard, implementation rules, governance
  rules, migration order, and verification checklist for AIMS.

No other files were created or modified. No CSS, component, Design System,
Core UI Library, API, backend, migration, or workflow file was changed.

## 14. Findings

Supplementary findings surfaced while drafting this standard (documentation
only; no code inspected beyond what P18.4.1 already reviewed, no fixes
applied):

- **Breakpoint inventory:** the codebase currently uses six distinct pixel
  thresholds across `day1.css` and the per-screen `*-ui.css` files — `1200`,
  `1024`, `900`, `768`, `600`, `480`. This standard formalizes `1024`/`768`
  as the two official band boundaries and classifies the other four as
  permitted internal refinements (§3), so no existing, non-duplicated rule
  needs to be discarded — only the *duplicated* ones (F5) need consolidation.
- **`request-ui.css` is the reference implementation.** Of all per-screen
  files, it has the most complete Tablet+Mobile coverage (upload grid,
  review summary, document list, journey summary) and is designated in §11
  as the pattern other screens should be brought up to, rather than
  inventing a new pattern.
- **F6 remains an extrapolated risk, not a confirmed defect**, for Approval,
  Policy, Validation, Finance Context, Financial Analysis, and History — the
  Priority 2 re-verification step (§11) exists specifically to close that
  gap once Priority 1 lands.

## 15. Commit Readiness

- Change type: documentation only (new file).
- No CSS, component, design-system, API, backend, migration, or workflow
  files were touched.
- Safe to commit as a standalone, low-risk, docs-only change independent of
  any other in-flight work.
- Suggested commit message: `docs(p18.4.2): add official responsive design standard`.
- No build, typecheck, or test impact expected (verified no other files were
  modified in this session).

## 16. Final Verdict

**A — Responsive Standards Complete**

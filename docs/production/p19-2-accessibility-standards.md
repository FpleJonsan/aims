# P19.2 — Accessibility Standards (AIMS)

Status: STANDARDS ONLY / no CSS, component, React, backend, API, schema,
Runtime Recovery, Responsive, Design System, or Core UI Library changes in
this phase.

Basis: P19.1 Accessibility Audit — Critical C1–C5; Major M1–M15; Minor
N1–N11; Polish P1–P4. This document is the sole authoritative accessibility
standard for AIMS. It transforms the audit's findings into rules; it does
not itself fix anything. Every rule below traces back to a specific P19.1
finding — no new accessibility topic is introduced that the audit did not
already identify.

---

## 1. Executive Result

AIMS has no accessibility standard today, and the audit found the same
pattern that produced P18.4.1's responsive defects: the same problem solved
correctly once, then re-solved worse, in parallel. `RequesterRequestExperience`
and the Core UI Library's `Input`/`Select`/`Textarea` already implement
required-marking, field errors, and focus management correctly (M8, M9); the
Finance-side `Editor` and five other panels do not (M8, M9, M11). A more
accessible `Sidebar`/`StageRail`/`Button`/`Alert`/`StatusChip` component set
already exists in `app/components/shared/` and `app/components/layout/` —
and is dead code, never imported, while the live app runs a less accessible
duplicate of each (C3, M4, M15, governance note in P19.1 §11). Five Critical
gaps are structural and app-wide: no focus trap (C1), no semantic table
markup anywhere (C2), no `aria-current` anywhere (C3), no skip-navigation
mechanism (C4), and a navigation landmark nested inside `<main>` (C5). This
document defines the one standard all future accessibility work — starting
with the P19.3+ implementation phases — must follow, so each of these
patterns is solved exactly once, in exactly one place.

## 2. Accessibility Principles

1. **One accessible pattern per component type.** A given UI concept
   (status indicator, dialog, table, button, form field) has exactly one
   accessible implementation in the codebase. Where the audit found two or
   three (StatusChip ×3, Button ×2, Alert ×2, two Payment Request forms —
   M4, M11, P19.1 §11 governance note), that is a standards violation to be
   resolved by migration, never grown further.
2. **Accessibility lives in the Core UI Library.** Any new or corrected
   accessible pattern is implemented once in `app/components/ui/`, not
   inline in `page.tsx` and not in a second, parallel `shared/`/`layout/`
   library. The audit found the opposite already happened once — a more
   accessible library exists and is unused (C3, M4, M15) — this principle
   exists specifically so that mistake is not repeated in reverse.
3. **State is never conveyed by color or glyph alone.** Every status,
   current-page, current-step, checked, busy, or required state that is
   shown visually (color, ✓/○ glyph, CSS class) must also be exposed
   programmatically (`aria-current`, `role`, `aria-checked`, `aria-busy`,
   `required`/`aria-required`) or as real text content (C3, M4, M10, M12).
4. **Every landmark is real and correctly structured.** Landmarks
   (`nav`, `main`, `aside`/`complementary`, dialogs) reflect actual document
   structure; a landmark is never nested inside another landmark it is not
   part of (C5), and a region that behaves like a landmark (the stage rail)
   is not left as an unlabeled `<div>` (M12).
5. **Every entry point a sighted keyboard user can reach, a screen-reader
   user can also reach and escape.** Dialogs trap focus, return focus, and
   close on Escape (C1, M1, M2, M3); the app itself is enterable without
   tabbing through the entire sidebar first (C4).
6. **Every asynchronous action announces itself.** A busy/loading state is
   never `disabled`-only; it is either a live region, an `aria-busy` element,
   or a label-text change — and never just a control going quiet (M5, M6,
   M7).
7. **Every control that blocks submission explains why, to assistive
   technology, not just sighted users.** Required fields are marked as
   required, not just described in nearby prose; errors are linked to their
   field, not left as a disconnected banner (M8, M9, M10).
8. **Standards are testable.** Every rule in this document maps to at least
   one line in the Verification Checklist (§13). A rule that cannot be
   checked is not a rule.

## 3. Navigation Standards

Closes C3, C4, C5, M12, M15, N1.

| Concern | Standard |
|---|---|
| **Skip Navigation** | The application shell provides one, single skip mechanism (e.g. a visually-hidden-until-focused "Skip to main content" link) as the first focusable element in the document, landing focus on the primary content region. This is the direct remedy for C4 — verified live in P19.1 to be entirely absent. |
| **`aria-current`** | The primary sidebar's active item carries `aria-current="page"` (closes C3). The Journey Rail's active step carries `aria-current="step"` on the step element itself, in addition to (not instead of) the existing "Current"/"Completed"/"Locked" text content, which the audit confirmed is already exposed to assistive technology and must be retained (closes M12). |
| **Landmarks** | `<nav>` and `<main>` are siblings, never nested. The primary sidebar is `<nav aria-label="Primary navigation">` inside a `<complementary>`/`<aside>` region that is itself a sibling of `<main>`, not a descendant of it (closes C5, confirmed live via the accessibility tree as `main → complementary → navigation`). Exactly one `<main>` exists per rendered view. |
| **Sidebar** | One nav landmark, one accessible name, `aria-current="page"` on the active item, and every decorative glyph preceding a nav label (`▦ ☷ ＋ …`) carries `aria-hidden="true"` — matching the mobile nav toggle's icon, which already does this correctly (closes M15). The sidebar is implemented once, in the Core UI Library (Principle 2); the dead `app/components/layout/Sidebar.tsx` is the reference for correct `aria-current` usage, not a second live implementation. |
| **Journey Rail** | The rail is a `<nav aria-label="…">` (or equivalent labeled landmark), not a bare `<div>` (closes M12's landmark gap). The current step carries `aria-current="step"`. Per-step state text ("Completed"/"Current"/"Locked") is retained as real text content, not removed in favor of the attribute alone — the attribute and the text serve different assistive-technology needs and both are required. |
| **Keyboard navigation** | Tab order follows DOM order, and DOM order follows visual order. CSS `order`/flex-reorder properties must never be used to visually relocate a nav element without also reordering it in the DOM (closes N1 — the mobile-breakpoint `.primaryNav{order:3}` divergence from its DOM position). |

## 4. Dialog Standards

Closes C1, M1, M2, M3, M6.

| Concern | Standard |
|---|---|
| **Focus trap** | Every dialog (`role="dialog" aria-modal="true"`) constrains Tab/Shift-Tab to its own focusable elements for the duration it is open. This is a hard requirement, not a best-effort one — the audit found the app's only dialog has none (C1), and a trap is the single most severe defect on record. |
| **Focus return** | On close (by any path — cancel, confirm, or Escape), focus returns to the element that opened the dialog, or to the most relevant successor (e.g. a success heading) if the trigger no longer exists (closes M3). |
| **Escape handling** | Escape closes the open dialog, following the same focus-return rule above. This is implemented once, as a shared dialog behavior in the Core UI Library — not per screen (closes M1 for dialogs; the mobile nav disclosure's Escape gap is covered under Navigation Standards' keyboard row, §3). |
| **Background inert** | While a dialog is open, content behind it is marked `inert` (or `aria-hidden="true"` where `inert` is unavailable) and is not reachable by Tab, arrow-key, or screen-reader virtual-cursor navigation (closes M2). |
| **Scroll lock** | While a dialog is open, the page body does not scroll; only the dialog's own internal content may scroll if it exceeds viewport height (companion requirement to Background Inert, closes the scroll-lock half of M2). |
| **Busy state** | A dialog's own action buttons (e.g. "Submit Request") follow Button Standards (§8) for busy state — `aria-busy` plus a label change — while an in-dialog async action is pending. This is the dialog-scoped instance of M6/M7 and must not be solved differently inside a dialog than outside one (Principle 1). |

## 5. Table Standards

Closes C2, plus preserves the audit's confirmed positive findings (responsive
reading order, row-action naming).

| Concern | Standard |
|---|---|
| **Semantic table ownership** | Every list of records (Work Queue, My Requests, Approval Inbox, Payment History, Reporting Drill, Budget/vendor breakdowns) is implemented as one shared, semantic table pattern in the Core UI Library — either real `<table>` markup or a fully-equivalent ARIA `role="table"`/`role="row"`/`role="cell"` structure — never a bare `<div>` of button-rows with no header record in the DOM (closes C2, the single largest structural gap found). This pattern is owned once, centrally; individual screens consume it rather than re-inventing row/column markup. |
| **Header association** | Every table has header cells present in the DOM (visually hidden if the design calls for it), and every data cell is programmatically associated with its header — native `<th>`/`<td>` pairing, or the ARIA equivalent (`aria-labelledby`/`headers`) if a non-native structure is retained. |
| **Scope** | Native `<th>` elements declare `scope="col"` or `scope="row"` as appropriate. Where the ARIA-role equivalent is used instead, each header row exposes `role="columnheader"` (and `role="rowheader"` for row headers), matching the same intent. |
| **Caption** | Every table has an accessible name — either a real `<caption>` or an `aria-label`/`aria-labelledby` on the table's containing region. The existing `TableContainer` (`role="region" aria-label`) pattern already does this correctly for Payment History; it is extended to every other list screen, not left as a single exception (closes N8). |
| **Responsive reading order** | The audit confirmed no CSS `order` trick or `data-label` reflow technique currently breaks reading order in any list screen — this is retained as a hard requirement going forward, not just a lucky current state: a table's responsive reflow must never separate a cell from the header association required above. |
| **Accessible actions** | Row-level actions retain distinguishing accessible names (e.g. `aria-label="Remove {filename}"`, or a whole-row button whose full text content is the accessible name) rather than a bare "Edit"/"Remove" repeated identically across rows — the audit found this already done correctly in the one place it was tested (document removal) and it is the standard for every row action going forward. |

## 6. Form Standards

Closes M8, M9, M10, N5, N6, N7, P2; codifies the Core UI Library's existing
correct mechanism as the mandatory pattern.

| Concern | Standard |
|---|---|
| **Required fields** | Every field that gates submission — whether by a disabled button or a server-side rejection — carries the HTML `required` attribute (or `aria-required="true"` where `required` cannot be used) and a visible text indicator. The Core UI Library's `FormField` already renders a text "(required)" indicator and sets `required`; every panel that gates submission on a non-empty value (Validation, Approval, Policy, Finance Control, Payment) must pass this prop rather than relying on prose alone (closes M8). `RequesterRequestExperience` is the reference implementation. |
| **Labels** | Every `<input>`/`<select>`/`<textarea>` has a programmatically associated label: an explicit `<label htmlFor>` with a real `id` (not an implicit nesting-only association with no `id`, which breaks the description wiring below — closes N7), or `aria-label`/`aria-labelledby` where no visible label exists. A control never carries both a visible `label` and a duplicate `aria-label` with independently-maintained text (closes N6) — `aria-label` is used only when there is no visible label. |
| **Descriptions** | Helper/hint text is linked to its control via `aria-describedby`, using the Core UI Library's existing `fieldDescription` mechanism. Controls with no helper text are not required to carry an empty `aria-describedby` (closes/confirms P2 as intentional, not a gap). |
| **Error association** | A field-level validation error is surfaced via that field's own `error` prop (which the Core UI Library already wires to `aria-invalid`/`aria-describedby`), never as a disconnected top-of-panel banner alone. This applies to every panel that currently uses a generic `notice` string for validation failures — Payment Request (internal), Validation, Financial Analysis, Policy, Approval, Finance Control (closes M9). A generic banner may supplement the field-level error for a summary, but never replace it. |
| **`aria-invalid`** | Set automatically by the shared field component whenever an `error` is present; never set or unset manually per screen (Principle 1). |
| **`aria-describedby`** | Composed automatically by the shared field component from whichever of helper/error/success text is present; never hand-assembled per screen. |
| **Autocomplete** | No credential or identity text field exists in the app today (the audit confirmed Login is a button-driven picker, not a text form), so this is a forward-looking rule: any future email, password, or name text input must carry the appropriate `autoComplete` value at the point it is introduced. This is not a remediation item against current code. |
| **Fieldset** | A group of related, mutually-relevant controls (e.g. a multi-item confirmation checklist) is wrapped in `<fieldset>`, not a `<div>` with a nearby heading (closes M10's fieldset gap for Finance Control's "Required Actions" group). |
| **Legend** | Every such `<fieldset>` has a `<legend>` naming the group (e.g. "Required Actions"), programmatically associating the group's heading the way a `<label>` associates a single field (closes M10's legend gap). |
| **Group semantics** | Where a set of toggle controls is functionally a checkbox group (as Finance Control's confirmation checklist is), it is implemented as real `<input type="checkbox">` elements or, if a button-based toggle is a deliberate design choice, as `role="checkbox"` with `aria-checked`, never a plain `<button>` distinguished only by a ✓/○ glyph (remainder of M10). |
| **One implementation per form** | Where the same business fields are captured in more than one place (the Finance-side Editor vs. `RequesterRequestExperience`, per M11), both consume the same shared, accessible field components and the same validation/error-surfacing behavior — accessibility quality must not depend on which workspace opens the form (closes M11, applies Principle 1). |

## 7. Status Standards

Closes M4, M5, M6, M7, N3, N4; this section also carries the Loading
Standard content (`role="status"`, `aria-live`, busy indicators, progressive
loading) as one topic, since Status and Loading are the same audit finding
category (M4–M7) and are not split into a separate top-level section.

| Concern | Standard |
|---|---|
| **StatusChip** | Implemented once, in the Core UI Library, with `role="status"` (or `role="img"` where the chip is purely iconographic) and an `aria-label` describing the state (e.g. `"Status: Pending approval"`) — not a plain colored `<span>`. This closes M4 for both live implementations found (the local `page.tsx` version and the Core UI `Badge`-based version); the dead `shared/StatusChip.tsx` is the reference for the correct pattern, and is retired once its behavior is merged into the one live component (Principle 1, Principle 2). |
| **Alert** | Implemented once. `role="alert"` for danger/error-severity messages (assertive), `role="status"` for informational/success/warning messages (polite) — one shared component decides this mapping from a `tone` prop, rather than each call site re-implementing `role`/`aria-live` by hand (closes N3). |
| **Badge** | Any non-status decorative badge (e.g. `AuthorityBadge`) that conveys meaning beyond its visible text carries `role="img"` and an `aria-label` reinforcing that meaning, even when the visible text already provides a fallback (closes N4). |
| **Loading** | Any view-level loading state (a screen or panel waiting on its first data) is a `role="status"` region with descriptive text (e.g. "Loading your requests…"), matching the pattern the Finance Dashboard already uses correctly. Every loading state — including the Requester Dashboard's, which currently uses a plain `<p>` — must use this same shared mechanism (closes M5). |
| **Busy** | Any control performing an async action exposes `aria-busy="true"` for the duration of that action, via the shared Button component (see §8), never via a bespoke, per-screen `disabled` flag with no `aria-busy` (closes the busy half of M6). |
| **Success / Warning / Danger / Information** | These four tones are the only tones the shared Alert/StatusChip/Badge components support, and each has one fixed role/live-region mapping (per the Alert row above) applied consistently everywhere a tone is used — no screen defines a fifth tone or reassigns an existing tone's semantics. |
| **Live region** | Live regions (`aria-live`, `role="status"`, `role="alert"`) are provided by shared components only (Alert, Loading, StatusChip) — never hand-rolled per call site, which is how the current inconsistency (some inline notices correctly use `role="status" aria-live="polite"`, others use nothing) arose (closes remainder of N3). |
| **Announcements** | Where a busy action's outcome matters to the user (e.g. "Submitting…" → "Submitted"), the shared Button's busy state changes its own visible label text, not only its `aria-busy` attribute — `aria-busy` alone is not reliably announced by all assistive technology on attribute change. The one call site the audit found already doing this correctly ("Checking document…") is the reference pattern (closes M7). |

## 8. Button Standards

Closes M6, M7, M14, M15, N10; incorporates Touch Target findings that are
button-specific (broader touch-target policy is in §10).

| Concern | Standard |
|---|---|
| **Busy buttons** | Every button that triggers an async action is the one shared Button component, set busy via a single `busy`/`aria-busy` prop — never a bare native `<button disabled={busy}>` with no `aria-busy` at all, which is what the Finance-side Editor's Save/Submit/Upload actions currently are (closes M6). |
| **Loading labels** | While busy, the button's visible label text changes to reflect the in-progress action (e.g. "Submitting…"), in addition to `aria-busy` — not a spinner-only visual change (closes M7, restates the Announcements rule in §7 as it applies specifically to buttons). |
| **Disabled explanation** | A button disabled because a required condition is unmet (e.g. an empty required field) exposes the reason via `aria-describedby` pointing at the explanatory text, rather than leaving a screen-reader user with only "button, dimmed" (closes N5). |
| **Icon decoration** | A decorative icon/glyph inside a button that already has a text label carries `aria-hidden="true"`, so it is not announced as a confusing extra word before the label (closes M15 — the primary sidebar nav icons are the confirmed instance, and the mobile nav toggle's icon is the existing correct reference). |
| **Touch target** | Every button meets the Core UI Library's existing `--aims-control-height`/`--aims-control-touch-height` tokens (40px desktop, 44px under `pointer:coarse`) — this token pair is retained as the one standard, and is extended to the legacy, non-Core-UI button paths that currently fall back to 38px or, in the case of the Finance-side document "Remove" button, no minimum size at all (closes M14, N10). |

## 9. Keyboard Standards

Closes M1, N1; codifies the audit's confirmed positive findings (native
control usage, no positive `tabIndex`, no non-semantic click targets) as
mandatory going forward rather than incidental.

| Concern | Standard |
|---|---|
| **Tab order** | Tab order follows DOM order; DOM order follows visual/reading order (companion to the Navigation Standards row on the same subject, §3). No positive `tabIndex` value is introduced anywhere — the audit found none in the current codebase (one correct `tabIndex={0}` on a scrollable region), and that remains the only sanctioned use of `tabIndex`. |
| **Focus order** | A responsive reflow (e.g. a grid collapsing to one column) never reorders focus away from the resulting visual order. CSS `order`/flex-reorder must not be used where it would create a mismatch (closes N1, restates the Navigation Standards rule as a general keyboard rule). |
| **Escape** | Escape closes whatever transient UI is currently open — a dialog (§4) or a disclosure such as the mobile nav — and returns focus per the relevant component's focus-return rule (closes M1). |
| **Enter / Space** | All interactive controls are real, native `<button>`/`<a>`/form elements, which receive Enter/Space activation for free. The audit found zero non-semantic clickable `<div>`/`<span>` elements anywhere in the app; this is retained as a hard rule, not a coincidence — a click handler is never attached to a non-interactive element without also making it a real button or adding the full keyboard-operability contract (`tabIndex`, `role`, `onKeyDown` for Enter/Space). |
| **Arrow keys** | The app currently has no custom composite widget (tablist, listbox, combobox, grid) that would require arrow-key navigation — the audit confirmed only native `<select>`/`<input>` controls are used. This standard is preventive: if such a widget is introduced in future work, it must follow the WAI-ARIA Authoring Practices pattern for that widget's arrow-key behavior in full, not a partial approximation. |
| **Focus visibility** | Every interactive element shows a visible focus indicator when reached by keyboard, at all times — focus styling is never suppressed for any control, in any state (busy, disabled-but-focusable, or otherwise). This standard exists to protect the one keyboard-operability property the audit did not find broken; it is stated explicitly so it cannot regress silently during the remediation work this document authorizes. |

## 10. Visual Accessibility Standards

Closes M12, M13, N9, N11, P1; preserves confirmed strengths (reduced
motion, zoom/reflow, no raster assets).

| Concern | Standard |
|---|---|
| **Contrast** | Every text/background and icon/background pairing meets WCAG AA (4.5:1 normal text, 3:1 large text/UI components). Three specific pairings the audit measured below threshold must be brought to at least 4.5:1: the stage-rail step-number text (measured 3.42:1, M12), the sidebar section-label text (measured 4.36:1, N9), and the currently-unused `--color-text-muted` token (measured 3.70:1) must be corrected before it is ever wired up (P1). |
| **Typography** | Text size and weight are never reduced to a point that would fail the Contrast row above at that size (i.e., dropping into "large text" 3:1 territory is not used as a workaround for an otherwise-failing color pair). This is the full extent of the Typography standard the audit supports — no additional type-scale/line-height topic was raised in P19.1 and none is introduced here. |
| **Zoom** | The audit confirmed no zoom-blocking viewport configuration exists and none may be introduced (`user-scalable=no`/restrictive `maximum-scale` are disallowed). Fixed-height containers combined with `overflow:hidden` (the KPI card pattern, N11) must not be used where they risk clipping content at high zoom or large user font sizes — such containers use a `min-height`, not a fixed `height`, or allow internal scrolling. |
| **Reduced motion** | The existing global `prefers-reduced-motion: reduce` rule (covering both the legacy shell and the Core UI Library) is retained as the one standard mechanism. Any new animation/transition added anywhere in the app must be covered by this existing rule, not a new, parallel motion-reduction mechanism. |
| **Dark mode policy** | **Decided in P19.3F: option (b).** AIMS is light-only by deliberate, recorded product policy — not an unexplained default. Implementing a real dark theme (option (a)) was rejected because it would require inventing a second color palette/theme, which P19.3F's own restrictions ("Do not invent a new theme. Do not redesign colors.") forbid on their face — the two options in the original P19.2 draft were never actually symmetric once a Visual-Accessibility-only migration phase was the vehicle for closing the decision. `color-scheme: light` remains the sanctioned mechanism for this policy (`app/day1.css`, documented in place with a code comment pointing back to this row) and is retained, not removed. Any future decision to add a real dark theme is a distinct, explicitly-scoped product initiative, not an accessibility-migration task. |
| **Touch targets** | The Core UI Library's `pointer:coarse` 40px/44px token pair (§8) is the one standard for every interactive element, not buttons alone — inputs, selects, and textareas included. It is extended to the legacy CSS paths that do not currently receive it. |

## 11. Governance Standards

Directly answers the P19.1 audit's repeated "orphaned/duplicate
implementation" observations (StatusChip ×3, Button ×2, Alert ×2, Sidebar/
StageRail dead code, two Payment Request forms).

1. **One accessibility pattern per component type.** For any given
   accessible concern (status indicator, alert, badge, button, dialog,
   table, form field, nav landmark), there is exactly one implementation in
   the codebase. A second implementation of the same concern — live or
   dead — is a standards violation, whether or not it is currently imported.
2. **Accessibility belongs inside the Core UI Library whenever possible.**
   New and corrected accessible behavior is added to
   `app/components/ui/`. Screen-level code (`page.tsx`) consumes these
   components; it does not re-implement their accessibility behavior
   locally, even for a "quick" one-off screen.
3. **Avoid duplicate accessibility implementations.** Where the audit found
   duplication, the migration phase must resolve it by consolidation, not
   by adding a third variant: `shared/StatusChip.tsx`, `shared/Alert.tsx`,
   `shared/Button.tsx`, `shared/AuthorityBadge.tsx`, `layout/Sidebar.tsx`,
   `layout/UserCard.tsx`, `layout/Brand.tsx`, and `shared/StageRail.tsx` are
   either merged into the Core UI Library (where they are the more
   accessible variant, as `Sidebar.tsx`'s `aria-current` and
   `shared/Button.tsx`'s label-swap busy state both are) and then deleted,
   or deleted outright if superseded — they are never left in place as a
   second, silently-diverging option.
4. **The two Payment Request forms are one form going forward.** The
   Finance-side `Editor` and `RequesterRequestExperience` (M11) must
   converge on one shared set of field components and one validation/error
   surface; workspace-specific layout differences are permitted, but
   accessibility behavior is not workspace-specific.
5. **This document is the tiebreaker.** Where existing code conflicts with
   this standard, this standard wins for all new and corrected work;
   reconciling existing code with the standard is the explicit job of the
   implementation phase (§12), not something to be worked around ad hoc
   elsewhere.
6. **Standards changes are versioned here, not forked elsewhere.** Any
   future revision to an accessibility rule is made by amending this
   document, not by a screen-level exception or a comment explaining a
   deliberate deviation.

## 12. Migration Priority

Grouped by pattern, per P19.2's instructed grouping, so dependent work lands
together and nothing is fixed twice.

**Priority 1 — Critical (Navigation, Dialog, Table)**
- Add a skip-navigation mechanism as the first focusable element in the
  shell (closes C4).
- Restructure the shell so `<nav>`/`<aside>` is a sibling of `<main>`, not a
  descendant (closes C5).
- Add `aria-current="page"` to the active sidebar item and `aria-current
  ="step"` to the active Journey Rail step, consolidating the sidebar and
  rail onto their Core UI Library implementations in the process (closes
  C3, M12's landmark/current-state gaps, and retires the dead `Sidebar.tsx`/
  `StageRail.tsx` per Governance §11.3).
- Implement focus trap, focus return, Escape handling, background inertness,
  and scroll lock on the one existing dialog, as one shared Core UI dialog
  pattern usable by future dialogs (closes C1, M1, M2, M3).
- Replace every button-row list with a semantic table pattern (real `<table>`
  or full ARIA table-role equivalent), including header association, scope,
  and a caption/labeled region for every list screen, not just Payment
  History (closes C2, N8).

**Priority 2 — Forms, Status, Buttons**
- Consolidate the three `StatusChip`/`Badge` implementations and two `Alert`
  implementations into one Core UI Library version each, with correct
  `role`/`aria-label`/live-region behavior (closes M4, N3, N4).
- Bring the Requester Dashboard's loading state onto the shared `role=
  "status"` loading pattern already used by the Finance Dashboard (closes
  M5).
- Add `aria-busy` and a label-text change to every busy button, starting
  with the Finance-side Editor's Save/Submit/Upload actions, which
  currently have neither (closes M6, M7).
- Wire `required`/`aria-required` and field-level `error` (→ `aria-invalid`/
  `aria-describedby`) into Validation, Financial Analysis, Policy, Approval,
  and Finance Control, using the Core UI Library's existing `FormField`
  mechanism and `RequesterRequestExperience` as the reference (closes M8,
  M9).
- Convert Finance Control's "Required Actions" list to a real `<fieldset>/
  <legend>`-grouped checkbox set (closes M10).
- Converge the Finance-side `Editor` and `RequesterRequestExperience` onto
  one shared, accessible field/validation implementation (closes M11).
- Add `aria-describedby`-linked explanations to the disabled submit buttons
  in Finance Control and Payment (closes N5).
- Add `aria-hidden="true"` to decorative nav-icon glyphs (closes M15).

**Priority 3 — Visual, Touch, Polish**
- Correct the three sub-AA color pairings: stage-rail step number, sidebar
  section labels, and the unused `--color-text-muted` token before it is
  ever wired up (closes M12's contrast half, N9, P1).
- Resolve the Dark Mode Policy decision point in §10 (implement or formally
  adopt light-only) and update `color-scheme` accordingly (closes M13).
- Extend the Core UI Library's `pointer:coarse` touch-target tokens to the
  legacy CSS paths, closing the Finance-side document "Remove" button's
  missing minimum size and the 38px legacy button fallback (closes M14,
  N10).
- Fix the mobile-breakpoint `.primaryNav{order:3}` divergence from DOM
  order (closes N1).
- Address the remaining polish items: redundant `label`+`aria-label` on the
  "Ask AIMS" input, missing `id` on legacy `Field` calls, and the
  inconsistent labeled-region coverage across list screens beyond Payment
  History (closes N6, N7, N8 remainder, P2).

Work belonging together: within Priority 1, the skip-link/landmark fix and
the dialog fix are independent and may proceed in parallel; the table
migration should land after or alongside the sidebar/rail work since both
touch the same list-screen markup. Priority 2's form convergence (M11)
depends on the Priority 1 table migration only where a form is embedded in
a list screen — otherwise it may proceed independently. Priority 3 has no
dependencies on Priority 1 or 2 and may be scheduled freely.

## 13. Verification Checklist

- [ ] A skip-navigation link is the first focusable element on every screen
      and moves focus to the primary content region.
- [ ] `<nav>`/`<aside>` is a sibling of `<main>` in the accessibility tree,
      never a descendant, on every screen.
- [ ] The active sidebar item exposes `aria-current="page"`.
- [ ] The active Journey Rail step exposes `aria-current="step"` in addition
      to its existing state text.
- [ ] Every decorative icon glyph adjacent to a text label carries
      `aria-hidden="true"`.
- [ ] The confirmation dialog traps Tab/Shift-Tab within itself while open.
- [ ] Closing the dialog (via any path) returns focus to its trigger or a
      documented successor element.
- [ ] Escape closes the open dialog and the open mobile nav disclosure.
- [ ] Background content is `inert`/`aria-hidden` and non-scrollable while
      the dialog is open.
- [ ] Every list/queue screen renders real header cells with correct
      scope/association, not a `<div>` of unlabeled button-rows.
- [ ] Every table/list region has an accessible name (`<caption>` or labeled
      region), not just Payment History.
- [ ] Every field that gates submission carries `required`/`aria-required`
      and a visible text indicator.
- [ ] Every surfaced validation error is linked to its field via `error`/
      `aria-invalid`/`aria-describedby`, not only a top-of-panel banner.
- [ ] Finance Control's confirmation checklist is a `<fieldset>/<legend>`
      checkbox group with real checked state, not glyph-prefixed buttons.
- [ ] The Finance-side Editor and Requester's form use the same shared field
      and validation components.
- [ ] Every busy button sets `aria-busy` and changes its visible label text.
- [ ] Every disabled-pending-input button has an `aria-describedby`
      explaining the missing requirement.
- [ ] Every `StatusChip`/`Badge`/`Alert` instance in the app resolves to one
      shared component with correct `role`/`aria-label`/live-region behavior.
- [ ] No orphaned duplicate accessibility component (`shared/*`, `layout/*`)
      remains in the repository unresolved (merged-and-deleted, or deleted).
- [ ] Stage-rail step numbers, sidebar section labels, and any newly-wired
      token all meet 4.5:1 contrast.
- [ ] A stated Dark Mode Policy decision exists and `color-scheme` matches it.
- [ ] Every interactive control (not just buttons) meets the 40px desktop /
      44px `pointer:coarse` touch-target standard.
- [ ] No positive `tabIndex` exists anywhere in the codebase.
- [ ] Tab order matches visual order at every breakpoint, including after
      the mobile `.primaryNav` CSS-order fix.
- [ ] Every interactive element shows a visible focus indicator in every
      state (default, busy, disabled-but-focusable).

## 14. Files Created

- `docs/production/p19-2-accessibility-standards.md` (this document) — the
  official Accessibility Standard, governance rules, migration order, and
  verification checklist for AIMS.

No other files were created or modified. No CSS, component, React, backend,
API, schema, Runtime Recovery, Responsive, Design System, or Core UI Library
file was changed.

## 15. Findings

Supplementary observations surfaced while drafting this standard
(documentation only; no new code inspection beyond what P19.1 already
performed, no fixes applied):

- **The audit's "Loading Standard" topic is not a separate section here.**
  P19.2's instructions listed it as its own "Define" block, but it maps
  onto the same P19.1 findings (M4–M7) as Status Standards, and the
  required 17-section output format has no separate top-level slot for it.
  Its content (`role="status"`, `aria-live`, busy indicators) is fully
  covered inside §7.
- **Autocomplete and Arrow-key standards are forward-looking, not
  remediation items.** P19.1 confirmed no credential text fields and no
  custom composite widgets exist today, so §6 and §9 state these as
  preventive rules for future work rather than citing a current defect —
  consistent with the instruction not to introduce topics the audit did not
  identify, since both rules are grounded in an audit-confirmed absence,
  not a new topic.
- **The Dark Mode Policy (§10) is the one standard in this document phrased
  as a decision to be made rather than a rule to apply**, because the audit
  (M13) found an inconsistency (blocking dark mode while offering no
  alternative) rather than a specific wrong value to correct — the standard
  requires the inconsistency be resolved one way or the other during
  migration, and record the outcome here.
- **Governance §11.3's consolidation list is exhaustive against the P19.1
  audit's dead-code findings** (`shared/StatusChip.tsx`, `shared/Alert.tsx`,
  `shared/Button.tsx`, `shared/AuthorityBadge.tsx`, `shared/StageRail.tsx`,
  `layout/Sidebar.tsx`, `layout/UserCard.tsx`, `layout/Brand.tsx`) — no
  additional orphaned component was found while drafting this document.

## 16. Commit Readiness

- Change type: documentation only (new file).
- No CSS, component, React, Design System, Core UI Library, API, backend,
  schema, or workflow file was touched.
- Safe to commit as a standalone, low-risk, docs-only change independent of
  any other in-flight work.
- Suggested commit message: `docs(p19.2): add official accessibility standard`.
- No build, typecheck, or test impact expected (no other files were
  modified in this session).

## 17. Final Verdict

**A — Accessibility Standards Complete**

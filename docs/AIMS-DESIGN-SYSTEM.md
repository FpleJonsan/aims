# AIMS Design System — P18.1

Version 1.0. Status: foundation defined; screen adoption intentionally deferred.
Design authority: the approved P18 UI Standardization Audit in this task. Preserve the green-and-neutral identity and existing product structure.

## Scope and adoption boundary

The canonical values live in `app/design-system/tokens.css`, under `.aims-design-system`. This stylesheet is not imported, and its scope is not applied to any screen. It contains custom properties only: no component styling or layout rules. This document defines contracts, not new UI behavior.

P13–P17 and Runtime Recovery remain frozen. No API, workflow, permission, audit, engine, trust, navigation, or data-format semantics change. No new components, dialogs, shortcuts, filters, or notifications are introduced by this foundation.

### Alias policy

Use only the `--aims-*` names for future design-system adoption. Do not create aliases such as `--primary`, `--color-primary`, `--space-0` meaning 4px, or parallel small/medium synonyms. Existing legacy declarations stay untouched because removing them would alter current pages. Replace their usages and remove obsolete declarations only during approved screen adoption. Identical literals for distinct semantic roles are intentional; they are not alias chains.

## Typography

One operational family: DM Sans, using the existing `--font-body` font loader with system fallback. Manrope may remain only for existing branding when a screen is later standardized. No font loading changes occur here.

| Role | Size / line height | Weight |
|---|---|---|
| Metadata, badge, helper, error | 12 / 18px | 400; 600 for badge emphasis |
| Form label, button | 14 / 20px | 600 |
| Table text | 14 / 20px | 400; 600 for headers |
| Body | 16 / 24px | 400 |
| Section heading | 18 / 26px | 600 |
| Card heading | 22 / 30px | 600 |
| Page heading | 28 / 36px | 600 |
| Major metric or login heading | 32 / 40px | 600 |

Only sizes 12, 14, 16, 18, 22, 28, 32px and weights 400, 500, 600, 700 are permitted. Use 500 for secondary emphasis and 700 sparingly. Heading rank follows document structure, independently of visual size. No operational text below 12px. Use sentence case; reserve uppercase for short existing category labels. Numeric values use tabular numerals; preserve existing currency, precision, date, and timezone semantics.

## Color system

Tokens use semantic roles, not raw color names. Values below are authoritative in the CSS file.

| Role | Foreground/base | Surface |
|---|---|---|
| Primary | #173F2E; hover #20543D; active #2C6048 | — |
| Secondary | #5F6F67 | #FFFFFF; hover #F1F3F0; active #DCE3DD |
| Success | #24784C | #E7F3EB |
| Warning | #9A6415 | #FFF3D8 |
| Danger | #AD4038 | #FAE9E7 |
| Information | #2F6F9F | #E8F1F8 |
| Neutral | #5F6F67 | #F1F3F0 |
| AI advisory | #6D51A8 | #F2EEF9 |
| Background | — | #F5F6F3 |
| Surface / muted surface | — | #FFFFFF / #F1F3F0 |
| Sidebar | — | #10231B |
| Primary / secondary text | #17251F / #5F6F67 | — |
| Decorative border / control border | #DCE3DD / #5F6F67 | — |
| Focus / separating gap | #2F6F9F / #FFFFFF | — |

Use the darker control border when an outline is necessary to recognize an input. Pale borders are separators, not the only control affordance. Disabled controls use dedicated text/surface/border tokens without whole-control opacity. Color never replaces a label. Dark mode is not part of P18.1.

## Spacing and geometry

One spacing scale: **0, 4, 8, 12, 16, 24, 32, 48, 64px**. Token suffixes are literal sizes.

- Label to field: 8px; field to helper/error: 4px.
- Related controls: 8px; form-field groups: 16px.
- Card padding: 24px desktop, 16px mobile.
- Page sections: 32px; major groups: 48px.
- Radius: small 6px controls; medium 10px cards/dialogs; large 14px existing large containers only; pill for badges.
- Shadows: none for nested sections; card for raised cards; overlay for existing modal surfaces. Do not stack shadows on every nested region.
- Icons: 16px inline, 20px in controls, 24px major indicators. Preserve existing icon meanings; decorative icons are hidden from assistive technology.
- Controls: minimum 40px high on desktop, 44px for touch. Textarea minimum 96px; vertical resize. Allow controls to grow for text wrapping/zoom.
- Layers: base 0, sticky 10, popover 20, backdrop 30, dialog 40, notification 50. These reserve layering roles; they do not introduce any surface.

## Buttons

| Variant | Default | Hover | Active |
|---|---|---|---|
| Primary | Primary fill/border, inverse text | Primary-hover fill | Primary-active fill |
| Secondary | Secondary surface, primary text, control border | Secondary-hover surface | Secondary-active surface |
| Text | Transparent, primary text, no visible border | Muted surface and underline | Secondary-active surface, underline |
| Danger | Surface, danger text/border | Danger-hover surface | Danger-active surface; inset danger border emphasis |

All variants: height 40px desktop/44px touch; horizontal padding 16px, vertical padding 8px; icon gap 8px; small radius; 14/20px at 600. Height is a minimum, never a clipping boundary. Danger hover and active intentionally reuse the approved danger tint; active adds border emphasis rather than inventing another red.

Focus uses the common focus ring. Disabled uses disabled tokens, no hover/active change, and disabled semantics. Busy retains the action label with an activity indicator and `aria-busy`; maintain stable width and existing duplicate-submission safeguards. Do not add confirmation steps or alter when business actions are enabled.

## Inputs, selects, textarea, and search

All field types share the small radius, control border, surface, primary text, 14/20px text, horizontal padding 12px, vertical padding 8px, and the control height scale. Search is an existing input with the same contract, not a new search capability. Select retains native semantics and a consistent trailing-indicator space. Textarea grows vertically.

Persistent associated label; optional helper below the field; error immediately after the field. Label at 14/20px, helper/error at 12/18px. Link helper/error IDs through `aria-describedby`; invalid fields use `aria-invalid`. Never rely on placeholders as labels.

| State | Presentation |
|---|---|
| Default | Control border, surface, primary text |
| Hover | Primary border; unchanged geometry |
| Focus | Focus border and common focus ring |
| Error | Danger border, explicit error text |
| Success | Success border and explicit confirmation only when already meaningful |
| Disabled | Disabled tokens; preserve readable value and existing disabled semantics |
| Read-only | Readable value and distinct read-only semantics; not disguised as disabled |

Do not add new validation or change validation timing. Checkbox/radio styling is not implemented; any later existing use must avoid inheriting text-input geometry.

## Cards

Medium radius, 1px decorative border, surface background. Card shadow only on raised containers; nested sections use none. Header/body/footer share 24px desktop/16px mobile horizontal padding. Header contains existing title and actions; body contains content; footer contains existing secondary information/actions. Separate adjacent regions with a border or spacing, not both unnecessarily. Header-to-body and body-to-footer rhythm: 16px where no separator is used. Do not change page composition.

## Badges and status mapping

Pill radius, 12/18px at 600, horizontal padding 8px and vertical padding 4px. Labels are mandatory. Badges are not buttons unless the existing interaction makes them one.

| Presentation | Semantic tokens | Meaning |
|---|---|---|
| Success | Success | Existing ready/completed outcome |
| Warning | Warning | Hold or clarification |
| Danger | Danger | Rejected or failed outcome |
| Neutral | Neutral | Draft or neutral information |
| Info | Info | Informational state |
| AI | AI advisory | Advisory provenance, never authority |
| Historical | Neutral | Explicit “Historical” label; inactive evidence |
| Cancelled | Neutral | Explicit “Cancelled” label |
| Pending | Info | Explicit pending/processing label |

These mappings do not calculate state. Document readiness must remain backend-derived; historical evidence never becomes active/trusted through styling. Distinguish request lifecycle, document status, and decision authority in labels even when their colors coincide.

## Existing dialogs

Medium radius, surface, overlay shadow; use dialog/backdrop layers. Header: title and existing close control. Body: consequence and existing context. Footer: secondary action followed by primary or danger action, gap 8px. Padding 24px desktop/16px mobile. Fit within the viewport; scroll the body when necessary; never hide actions behind the mobile keyboard.

When an existing custom confirmation is later standardized: provide accessible name/description, initial focus, contained Tab/Shift+Tab traversal, Escape dismissal where cancellation is already allowed, background non-interaction, and focus restoration. Use the existing action handlers and cancellation rules. No automatic confirmation, no new confirmation requirement, and no change to native dialogs in this phase.

## Tables and pagination

Semantic table headers for tabular data; labels for interactive controls. Header: muted surface, secondary text at 14/20px 600. Rows: surface, 14/20px 400, subtle separator; default minimum 56px, compact minimum 48px. Cells: horizontal padding 16px, vertical padding 12px default/8px compact; allow multiline rows to grow.

Text left-aligned; numeric values right-aligned with tabular numerals. Preserve currency and precision. Status column uses labelled badges; actions column has consistently named existing controls. Maintain full amounts and accessible labels; do not introduce sorting, columns, filters, or actions. Contain horizontal scrolling within wide tables rather than clipping data.

Pagination belongs below the table, outside its horizontal scroller: existing count/page information first, existing previous/next controls last. Stack on narrow screens; retain accessible names and disabled states. Show totals only when the current API supplies them.

## Interaction, feedback, and motion

- Focus: 3px focus-color outline with 2px offset; use a separating white gap on dark surfaces. Never suppress focus without an equally visible replacement. Verify against the actual surface during adoption.
- Hover/active: use component contracts; never apply hover changes to disabled controls. Do not move layout to signal active state.
- Busy: localized status text and an existing activity indicator; stable control labels. Do not present pending work as success.
- Success, warning, error: distinct semantic surface/text and explicit wording. Use polite status announcements for normal progress and alert semantics for actionable errors; avoid repeated announcements on polling.
- Loading: retain content geometry where practical. Any future skeleton replaces only an existing loading presentation; it does not add data fetching. Loading, empty, and error are distinct states.
- Empty: concise title, explanation, and an existing relevant action only.
- Motion: reuse the existing 140ms ease transition for color, border, and shadow. Reduced-motion duration is zero. No new animation or shortcut system.

## Future adoption acceptance checklist

This is a checklist for later authorized work, not implementation in P18.1.

1. Use canonical tokens without new aliases, font sizes, weights, or spacing values.
2. Verify text contrast (4.5:1 for ordinary text), visible focus, labels, keyboard handling, and touch targets on actual components.
3. Verify desktop, tablet, mobile, zoom, long text, amounts, and empty/loading/error states.
4. Keep all existing actions, navigation, authority checks, API contracts, audit behavior, and backend-derived states unchanged.
5. Run relevant frozen runtime regressions after screen adoption.
6. Remove a legacy token only after all affected usages have been intentionally migrated.

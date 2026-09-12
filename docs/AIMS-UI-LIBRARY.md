# AIMS Core UI Library — P18.2

Status: official future-facing library; no screen adoption. Authority: `docs/AIMS-DESIGN-SYSTEM.md` and `app/design-system/tokens.css` (P18.1).

## Installation boundary

Future approved screens import from `app/components/ui` and wrap their content in `UIProvider`. The barrel imports one stylesheet, which imports the canonical tokens exactly once. Tokens are available inside `.aims-design-system`; UI selectors use the `aims-` namespace. No existing page imports the library. Do not add this import to the current application during P18.2.

Example (documentation only):

```tsx
import {UIProvider, PageHeader, Input, Button} from '@/app/components/ui';

<UIProvider>
  <PageHeader title="Payment request" />
  <Input label="Payee" name="payee" required helper="Use the existing payee details." />
  <Button variant="primary" type="submit" busy={saving}>Save draft</Button>
</UIProvider>
```

Legacy shared/inline components remain untouched and are not the source for future work. Later migrations must deliberately replace them with this library and remove conflicting global selectors. The library does not promise isolation from legacy global `!important` rules when mixed into an unmigrated screen. Do not add a second token file or duplicate styles to work around that boundary.

## Layer 1 — foundation

| Component | Purpose and main props | Rules |
|---|---|---|
| UIProvider | Token/font scope; native div props | One surrounding scope per adopted surface; no data or routing behavior |
| Typography | `as`, `variant`, native element attributes | Variants metadata, label, body, section, card, page, metric; choose semantic heading rank independently |
| Button | Native button props; `variant`, `busy` | Primary, secondary, danger, text only; defaults to type=button; submit must be explicit |
| Input | Native input props plus required `label`, optional `helper`, `error`, `success` | Existing text/search/date/file/etc. uses; do not use for checkbox/radio; native readOnly/required/disabled supported |
| Card | Native div props | Surface/border/shadow wrapper; no navigation or action |
| CardHeader / CardBody / CardFooter | Native div props | Compose existing content; use Typography for title semantics |
| Badge | `tone`, native span props, labelled children | Success, warning, danger, neutral, info, AI; caller supplies meaningful text |
| StatusChip | Typed `status`, native span props | One mapping; backend status passed unchanged; no readiness calculation |

StatusChip covers current request lifecycle states, document quarantine/scanning/CLEAN/rejection/failure, historical/pending/processing/completed, and PASS/HOLD/FAILED. Historical and cancelled are neutral; pending is info; AI provenance uses Badge tone=ai. Surround the chip with its request/document/decision context. It is not automatically a live region: callers should announce actual state changes through Alert rather than announce every table row.

No Ghost variant exists because it has no established AIMS contract. Numeric content can use Typography metric or the table `data-numeric` cell attribute. Keep existing value formatting unchanged.

## Layer 2 — feedback

| Component | Purpose and props | Accessibility / behavior |
|---|---|---|
| Alert | `tone`, optional `title`, content, native div props | Danger uses role=alert; other tones role=status; no automatic dismissal |
| LoadingSpinner | `label`, `decorative` | Named status when standalone; hidden when decorative; static ring avoids introducing animation outside P18.1 |
| BusyButton | Same props as Button | Delegates to Button; no second CSS or implementation; caller supplies busy state |
| EmptyState | `title`, content, optional `action` | Existing action only; not a clickable card; distinct from loading/error |

The busy indicator slot is reserved in both idle and busy states. The visible label and accessible action name stay unchanged; busy sets aria-busy and native disabled. Do not change children while toggling busy if stable width is required. No requests, timers, or business commands are initiated by these components.

Skeleton is deliberately deferred: no existing skeleton presentation was found in AIMS. Current loading use cases are covered by LoadingSpinner, BusyButton, and status content. Adding an unused skeleton would violate the use-only-existing-components constraint.

## Layer 3 — forms

| Component | Props | Usage |
|---|---|---|
| Textarea | Native textarea props + FieldMeta | Label mandatory; readOnly, disabled, required remain native; grows vertically |
| Select | Native select props + FieldMeta; option children | Native keyboard interaction; no custom popup; native select has no readOnly state |
| FormField | Explicit `id`, `label`, optional helper/error/success/required, control children | Low-level composition; caller must put matching id and ARIA attributes on the child |

Input/Textarea/Select automatically compose FormField. Do not wrap them in another FormField. Generated IDs are stable React useId values unless an explicit ID is supplied. Existing aria-describedby IDs are retained and combined with helper/error/success IDs. Errors take precedence over success, receive an associated ID and role=alert, and set aria-invalid. Helper text remains visible. For custom FormField children, connect `<id>-helper`, `<id>-error`, or `<id>-success` as appropriate.

No new validation, validation timing, selectable values, or authority logic is provided. For read-only select data, retain the existing static presentation instead of pretending a disabled select is read-only. Loading data for a select remains a caller-owned state; use its native disabled flag and an adjacent named status as appropriate.

Checkbox and Radio are deliberately deferred: the current frontend has no active checkbox/radio controls, and P18.1 does not establish their geometry. No advanced controls are implemented.

## Layer 4 — layout

| Component | Props | Contract |
|---|---|---|
| PageHeader | `title`, optional `description`, `actions`, native header attributes | h1; one per page; existing actions only |
| SectionHeader | Same as PageHeader | h2; no invented tabs or navigation |
| TableContainer | Required `label`, `density` default/compact, native div props | Focusable named scrolling region; caller supplies semantic table, caption and th scope |
| Pagination | `page`, optional `totalPages`/`total`, supplied `hasPreviousPage`/`hasNextPage`, `onPrevious`/`onNext`, optional busy/label | Below TableContainer; uses backend paging truth without calculating filters or totals |

Table numeric cells use `data-numeric`. Status cells contain StatusChip; actions cells contain existing named buttons. TableContainer does not generate data, sorting, selection, or columns. Rows grow with content. Pagination omits unknown totals, blocks unavailable/busy navigation, and announces supplied page information. Layout flex wrapping accommodates narrow widths; touch pointers use the P18.1 touch control height and compact card padding.

## Interaction and accessibility

All interactive primitives retain native keyboard semantics. A common token-driven focus rule covers controls, links, and focusable table regions. Disabled colors use tokens rather than opacity. Read-only inputs retain keyboard access. Static components do not receive unnecessary tab stops or disabled props.

The ring has no continuous animation; existing color/border transitions use the P18.1 duration, which becomes zero under reduced motion. Decorative SVGs are hidden from assistive technology. No keyboard shortcuts, focus traps, or modal behavior are introduced.

Components do not decide business eligibility. Required labels, meaningful button children, labelled table regions, and proper table semantics remain caller responsibilities. Screen-reader and whole-screen accessibility acceptance must also occur when screens are adopted.

## Verification and migration

`node --experimental-strip-types --test test/ui-library.test.ts` checks every exported component, every presentation variant, field association, native state attributes, stable busy markup, pagination boundaries, token references, duplicate selectors, and no imports from existing screens. Typecheck, lint and application build remain required.

For later adoption: preserve handlers and data fetching; migrate one approved surface at a time; remove its legacy CSS collisions; verify keyboard/focus, actual busy width, read-only/disabled states, all backend-provided statuses, zoom/touch layouts, and frozen runtime regressions. Do not derive trust, readiness, or authorization in this library.

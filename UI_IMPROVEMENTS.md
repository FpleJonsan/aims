# AIMS UI Improvements

Generated: 2026-08-27

## Executive Summary

The AIMS UI is functionally complete but built as a **monolithic single-file React component** (2,910 lines) with **mixed design systems** in CSS. While it works, this architecture creates maintenance risks, limits reusability, and makes collaboration difficult.

**Priority:** Refactor for production readiness while preserving all existing functionality.

---

## Critical Issues

### 1. Monolithic Component Architecture 🔴 CRITICAL

**Current state:**
- Entire app: **one 2,910-line component** (`app/page.tsx`)
- 13+ `useState` hooks in a single component
- No component extraction or separation of concerns
- All business logic mixed with UI rendering

**Impact:**
- Hard to test individual features
- Difficult to debug
- Poor code reusability
- Merge conflicts inevitable with multiple developers
- Browser dev tools struggle with large components

**Recommendation:**
Break into feature-based components:

```
app/
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   ├── payment-request/
│   │   ├── PaymentRequestForm.tsx
│   │   ├── PaymentRequestList.tsx
│   │   └── PaymentRequestDetail.tsx
│   ├── validation/
│   │   └── ValidationPanel.tsx
│   ├── finance/
│   │   ├── FinanceContextPanel.tsx
│   │   ├── FinancialAnalysisPanel.tsx
│   │   └── FinanceControlPanel.tsx
│   ├── approval/
│   │   └── ApprovalWorkflow.tsx
│   ├── payment/
│   │   └── PaymentPanel.tsx
│   ├── dashboard/
│   │   ├── Dashboard.tsx
│   │   ├── KpiCard.tsx
│   │   └── DashboardFilters.tsx
│   └── shared/
│       ├── StatusChip.tsx
│       ├── AuthorityBadge.tsx
│       ├── StageRail.tsx
│       └── Button.tsx
├── hooks/
│   ├── useApi.ts
│   ├── useAuth.ts
│   ├── usePaymentRequests.ts
│   └── useSession.ts
├── lib/
│   ├── api-client.ts
│   └── types.ts
└── page.tsx (< 200 lines)
```

**Estimated effort:** 2-3 days  
**Risk:** Low (pure refactor, no behavior change)

---

### 2. Mixed & Duplicated CSS 🔴 CRITICAL

**Current state:**
- Two CSS files: `day1.css` (1,184 lines) + `globals.css` (minified)
- Overlapping/conflicting styles
- CSS variables defined but not consistently used
- Old styles not cleaned up after design system update

**Examples of duplication:**

```css
/* day1.css line 982-1008 */
:root {
  --background: #f5f6f2;
  --primary: #173f2e;
  /* ... 25 more variables */
}

/* globals.css line 1 */
:root{--ink:#16221d;--cream:#f3f0e8;--lime:#c8ff65; /* ... different names, similar values */}
```

**Impact:**
- Inconsistent UI appearance
- Hard to maintain visual consistency
- Bundle size inflation (~50KB CSS)
- Design changes require touching multiple files

**Recommendation:**

1. **Consolidate to one design system:**
   - Keep the newer refined system (lines 982+ in day1.css)
   - Remove old/duplicate styles
   - Use Tailwind CSS utilities where appropriate (already imported)

2. **Organize CSS:**
   ```
   app/
   ├── styles/
   │   ├── variables.css      (design tokens)
   │   ├── reset.css          (normalize)
   │   ├── layout.css         (shell, grid)
   │   ├── components.css     (button, card, chip)
   │   └── utilities.css      (helpers)
   ```

3. **Consider CSS-in-JS** (optional):
   - Tailwind classes via `className`
   - Or CSS Modules per component
   - Removes global scope pollution

**Estimated effort:** 1-2 days  
**Risk:** Medium (visual regression testing needed)

---

### 3. Type Safety Issues 🟡 HIGH

**Current state:**
- Frequent `Record<string, unknown>` casts
- `/* eslint-disable @typescript-eslint/no-explicit-any */` at top
- Runtime type coercion with `String()`, `Number()`
- No validation of API responses

**Examples:**

```typescript
// Line 255-256
const safe=await api(`/requester/requests/${id}`) as {request:Record<string,unknown>;documents:Array<Record<string,unknown>>;activity:Array<Record<string,unknown>>};

// Line 2849-2850
function requesterListItem(x:Record<string,unknown>):Item{
  return {id:String(x.id),ticketNumber:x.ticket_number?String(x.ticket_number):null, /* ... */
```

**Impact:**
- Runtime errors not caught at compile time
- No autocomplete/IntelliSense for API data
- Hard to refactor safely

**Recommendation:**

1. **Generate types from OpenAPI spec:**
   ```bash
   npm install -D openapi-typescript
   npx openapi-typescript http://localhost:3001/openapi -o src/types/api.ts
   ```

2. **Use Zod for runtime validation:**
   ```typescript
   import { z } from 'zod';

   const PaymentRequestSchema = z.object({
     id: z.string().uuid(),
     ticketNumber: z.string().nullable(),
     status: z.enum(['DRAFT', 'SUBMITTED', /* ... */]),
     // ...
   });

   type PaymentRequest = z.infer<typeof PaymentRequestSchema>;

   // In API calls:
   const data = await api('/payment-requests');
   return PaymentRequestSchema.array().parse(data);
   ```

3. **Remove `any` usage:**
   - Enable `noExplicitAny` in `tsconfig.json`
   - Fix type errors incrementally

**Estimated effort:** 2 days  
**Risk:** Low (catches bugs early)

---

### 4. Accessibility Gaps 🟡 HIGH

**Current state:**
- Missing ARIA labels on interactive elements
- No keyboard navigation for custom components
- Focus management issues on modal/panel transitions
- Status chips not screen-reader friendly
- Form errors not announced

**Examples:**

```tsx
// Line 96-98: KpiCard button has no accessible label
<button className={`kpiCard tone-${tone}`} onClick={onClick}>
  <span className="metricIcon">{icon}</span>
  {/* No aria-label for what this metric represents */}
```

**Impact:**
- Not usable by keyboard-only users
- Screen reader users can't navigate effectively
- May violate WCAG 2.1 AA standards

**Recommendation:**

1. **Add semantic HTML & ARIA:**
   ```tsx
   <button
     className="kpiCard"
     onClick={onClick}
     aria-label={`${label}: ${value}`}
   >
     {/* ... */}
   </button>

   <StatusChip
     status={status}
     role="status"
     aria-live="polite"
   >
     {status.replaceAll("_", " ")}
   </StatusChip>
   ```

2. **Keyboard navigation:**
   - Tab order follows logical flow
   - Escape closes modals/panels
   - Enter/Space activate buttons

3. **Focus management:**
   ```typescript
   useEffect(() => {
     if (selected) {
       // Focus first interactive element when detail opens
       const firstInput = document.querySelector('.editor input');
       (firstInput as HTMLElement)?.focus();
     }
   }, [selected]);
   ```

4. **Use a11y linting:**
   ```bash
   npm install -D eslint-plugin-jsx-a11y
   ```

**Estimated effort:** 1 day  
**Risk:** Low (additive improvements)

---

### 5. Performance Issues 🟠 MEDIUM

**Current state:**
- No memoization of expensive computations
- All state changes trigger full component re-render
- Large lists not virtualized
- No code splitting

**Examples:**

```typescript
// Line 142-191: refresh() recreates on every render
const refresh = useCallback(async () => {
  // Fetches data, runs on every state change
}, [api, session, workspace, approvalPage, financeView]);
// Heavy dependency array triggers frequent re-runs
```

**Impact:**
- UI feels sluggish with 50+ payment requests
- Battery drain on mobile devices
- Unnecessary network requests

**Recommendation:**

1. **Memoize expensive operations:**
   ```typescript
   const filteredItems = useMemo(() => {
     return items.filter(/* expensive filter */);
   }, [items, filters]);

   const DashboardKpi = memo(({ label, value }) => (
     <KpiCard label={label} value={value} />
   ));
   ```

2. **Virtualize long lists:**
   ```bash
   npm install @tanstack/react-virtual
   ```

   ```tsx
   import { useVirtualizer } from '@tanstack/react-virtual';

   function PaymentRequestList({ items }) {
     const rowVirtualizer = useVirtualizer({
       count: items.length,
       getScrollElement: () => parentRef.current,
       estimateSize: () => 72, // row height
     });
     // Render only visible rows
   }
   ```

3. **Code splitting:**
   ```tsx
   const Dashboard = lazy(() => import('./components/Dashboard'));
   const PaymentHistory = lazy(() => import('./components/PaymentHistory'));
   ```

4. **Debounce API calls:**
   ```typescript
   import { useDebouncedCallback } from 'use-debounce';

   const debouncedSearch = useDebouncedCallback(
     (query) => api(`/payment-requests?search=${query}`),
     500
   );
   ```

**Estimated effort:** 1-2 days  
**Risk:** Low (incremental gains)

---

### 6. State Management 🟠 MEDIUM

**Current state:**
- 13+ `useState` hooks in root component
- Props drilling through multiple levels
- Derived state computed inline
- No centralized state for shared data

**Example:**

```typescript
// Lines 101-113
const [user, setUser] = useState<string | null>(null),
  [items, setItems] = useState<Item[]>([]),
  [selected, setSelected] = useState<Item | null>(null),
  [notice, setNotice] = useState(""),
  [showPaymentHistory, setShowPaymentHistory] = useState(false),
  [showDashboard, setShowDashboard] = useState(false),
  [session,setSession]=useState<PortalSession|null>(null),
  [workspace,setWorkspace]=useState<Workspace|null>(null),
  [financeView,setFinanceView]=useState<FinanceView>("dashboard"),
  // ... 4 more
```

**Impact:**
- Hard to track state changes
- State updates can be out of sync
- Difficult to implement undo/redo or state persistence

**Recommendation:**

1. **Extract custom hooks:**
   ```typescript
   // hooks/useAuth.ts
   export function useAuth() {
     const [user, setUser] = useState<string | null>(null);
     const [session, setSession] = useState<PortalSession | null>(null);
     const [workspace, setWorkspace] = useState<Workspace | null>(null);

     useEffect(() => {
       // Auth logic here
     }, []);

     return { user, session, workspace, setUser, switchWorkspace };
   }

   // hooks/usePaymentRequests.ts
   export function usePaymentRequests(workspace: Workspace) {
     const [items, setItems] = useState<Item[]>([]);
     const [selected, setSelected] = useState<Item | null>(null);
     // ...
   }
   ```

2. **Consider Context for global state:**
   ```typescript
   // contexts/SessionContext.tsx
   const SessionContext = createContext<SessionContextType | null>(null);

   export function SessionProvider({ children }) {
     const [session, setSession] = useState<PortalSession | null>(null);
     const [workspace, setWorkspace] = useState<Workspace | null>(null);

     return (
       <SessionContext.Provider value={{ session, workspace, /* ... */ }}>
         {children}
       </SessionContext.Provider>
     );
   }

   export function useSession() {
     const context = useContext(SessionContext);
     if (!context) throw new Error('useSession must be within SessionProvider');
     return context;
   }
   ```

3. **For complex state, use Zustand or Jotai** (lightweight state libs):
   ```bash
   npm install zustand
   ```

   ```typescript
   // stores/session-store.ts
   import { create } from 'zustand';

   interface SessionStore {
     user: string | null;
     session: PortalSession | null;
     workspace: Workspace | null;
     setUser: (user: string) => void;
     switchWorkspace: (workspace: Workspace) => void;
   }

   export const useSessionStore = create<SessionStore>((set) => ({
     user: null,
     session: null,
     workspace: null,
     setUser: (user) => set({ user }),
     switchWorkspace: (workspace) => set({ workspace }),
   }));
   ```

**Estimated effort:** 1-2 days  
**Risk:** Medium (requires careful migration)

---

### 7. Error Handling 🟠 MEDIUM

**Current state:**
- Global `notice` string for all errors
- No error boundaries
- Network errors show generic messages
- No retry logic

**Examples:**

```typescript
// Line 2907-2909: Generic error handler
function msg(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}
```

**Impact:**
- User sees cryptic error messages
- App crashes on unhandled errors
- No recovery from transient failures

**Recommendation:**

1. **Add error boundaries:**
   ```tsx
   // components/ErrorBoundary.tsx
   export class ErrorBoundary extends Component<Props, State> {
     static getDerivedStateFromError(error: Error) {
       return { hasError: true, error };
     }

     render() {
       if (this.state.hasError) {
         return (
           <div className="errorFallback">
             <h2>Something went wrong</h2>
             <p>{this.state.error?.message}</p>
             <button onClick={() => window.location.reload()}>
               Reload page
             </button>
           </div>
         );
       }
       return this.props.children;
     }
   }
   ```

2. **Structured error display:**
   ```tsx
   // components/Alert.tsx
   type AlertProps = {
     type: 'error' | 'warning' | 'info' | 'success';
     title: string;
     message: string;
     action?: { label: string; onClick: () => void };
   };

   function Alert({ type, title, message, action }: AlertProps) {
     const icons = { error: '⚠', warning: '⚡', info: 'ℹ', success: '✓' };
     return (
       <div className={`alert alert-${type}`} role="alert">
         <span>{icons[type]}</span>
         <div>
           <strong>{title}</strong>
           <p>{message}</p>
           {action && <button onClick={action.onClick}>{action.label}</button>}
         </div>
       </div>
     );
   }
   ```

3. **API retry with exponential backoff:**
   ```typescript
   async function fetchWithRetry(
     url: string,
     options?: RequestInit,
     retries = 3
   ) {
     for (let i = 0; i < retries; i++) {
       try {
         const response = await fetch(url, options);
         if (response.ok) return response;
         if (response.status >= 500 && i < retries - 1) {
           await new Promise(resolve => setTimeout(resolve, 2 ** i * 1000));
           continue;
         }
         throw new Error(`HTTP ${response.status}`);
       } catch (error) {
         if (i === retries - 1) throw error;
         await new Promise(resolve => setTimeout(resolve, 2 ** i * 1000));
       }
     }
   }
   ```

**Estimated effort:** 1 day  
**Risk:** Low

---

### 8. Testing Gaps 🟢 LOW

**Current state:**
- No unit tests for UI components
- No integration tests for user flows
- No visual regression tests

**Impact:**
- Refactoring is risky without tests
- Hard to verify fixes don't break other features
- Manual testing is time-consuming

**Recommendation:**

1. **Add component tests with Vitest + Testing Library:**
   ```bash
   npm install -D vitest @testing-library/react @testing-library/user-event
   ```

   ```typescript
   // components/StatusChip.test.tsx
   import { render, screen } from '@testing-library/react';
   import { StatusChip } from './StatusChip';

   test('renders status chip with correct text', () => {
     render(<StatusChip status="PENDING_APPROVAL" />);
     expect(screen.getByText('PENDING APPROVAL')).toBeInTheDocument();
   });
   ```

2. **Integration tests with Playwright:**
   ```bash
   npm install -D @playwright/test
   ```

   ```typescript
   // e2e/payment-request.spec.ts
   test('create and submit payment request', async ({ page }) => {
     await page.goto('http://localhost:3000');
     await page.click('text=New Request');
     await page.fill('input[name="payee"]', 'Vendor Inc');
     await page.fill('input[name="amount"]', '5000');
     await page.click('text=Submit');
     await expect(page.locator('.statusChip')).toHaveText('SUBMITTED');
   });
   ```

3. **Visual regression with Chromatic or Percy**

**Estimated effort:** 2-3 days (initial setup)  
**Risk:** Low (purely additive)

---

## Quick Wins (< 1 hour each)

### 1. Extract reusable components
Move `StatusChip`, `AuthorityBadge`, `KpiCard` to separate files

### 2. Add loading states
Replace `"Loading…"` with proper skeleton UI

### 3. Improve button accessibility
Add `aria-label` to icon-only buttons

### 4. Use semantic HTML
Replace `<div>` with `<header>`, `<nav>`, `<article>`, `<section>` where appropriate

### 5. Add input validation feedback
Show inline errors on form fields

### 6. Improve mobile responsiveness
Test on actual devices, fix layout breaks

### 7. Add keyboard shortcuts
`Ctrl+K` for search, `Escape` to close panels

### 8. Optimize images/assets
(None found currently, but add `next/image` if images are added)

### 9. Add meta tags
Improve SEO and social sharing

### 10. Enable React Strict Mode
Catch potential issues early

---

## Recommended Phased Approach

### Phase 1: Foundation (Week 1)
- ✅ Extract shared components (Button, StatusChip, etc.)
- ✅ Set up component folder structure
- ✅ Add TypeScript strict mode
- ✅ Consolidate CSS design system

### Phase 2: Architecture (Week 2)
- ✅ Break page.tsx into feature components
- ✅ Create custom hooks (useAuth, useApi, etc.)
- ✅ Add error boundaries
- ✅ Implement proper state management

### Phase 3: Quality (Week 3)
- ✅ Add unit tests for components
- ✅ Add integration tests for key flows
- ✅ Improve accessibility (ARIA, keyboard nav)
- ✅ Performance optimization (memoization, virtualization)

### Phase 4: Polish (Week 4)
- ✅ Visual refinements
- ✅ Loading/error states
- ✅ Documentation (Storybook or similar)
- ✅ Code review and cleanup

---

## Tools & Libraries to Consider

### Already Installed ✅
- React 19
- TypeScript
- Tailwind CSS
- Zod (for validation)

### Recommended Additions
- **@tanstack/react-query** - Data fetching with caching
- **@tanstack/react-virtual** - List virtualization
- **react-hook-form** - Form state management
- **zustand** or **jotai** - Lightweight global state
- **@testing-library/react** - Component testing
- **@playwright/test** - E2E testing
- **storybook** - Component documentation
- **eslint-plugin-jsx-a11y** - Accessibility linting

---

## Metrics to Track

Before/after refactoring:

| Metric | Current | Target |
|--------|---------|--------|
| Largest component (LOC) | 2,910 | < 300 |
| CSS file size | ~60KB | < 30KB |
| Type safety coverage | ~70% | > 95% |
| Test coverage | 0% | > 80% |
| Lighthouse Accessibility | Unknown | > 95 |
| Bundle size | Unknown | < 200KB (gzipped) |
| Time to Interactive | Unknown | < 3s |

---

## Next Steps

1. **Review this document** with the team
2. **Prioritize** which improvements to tackle first
3. **Create tickets** for each work item
4. **Set up** development workflow (branching strategy, PR templates)
5. **Start with Phase 1** quick wins

---

## Questions?

This assessment is based on current codebase state (2026-08-27). The functionality is solid — these improvements focus on **maintainability**, **scalability**, and **developer experience** for production deployment.

Want me to help implement any of these? I can:
- Create component structure
- Write migration scripts
- Set up testing framework
- Build example implementations

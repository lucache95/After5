# P11 — Cross-Cutting Polish: States, A11y, Mobile, Analytics, Scale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Write only what each step specifies — no placeholders, no speculative code.**

**Goal:** Make the experience-first dating loop production-grade along the five cross-cutting axes the audit flagged: (1) consistent LOADING / ERROR / EMPTY states on every async loop action, (2) ACCESSIBILITY (non-audio ambient equivalent, button-based swipe alternative, `aria-live` offer countdown, pink-on-dark contrast, screen-reader feed semantics), (3) MOBILE responsiveness (and explicitly leaning on the P2 native-push backbone where web is too weak), (4) ANALYTICS — a PostHog event for **every** loop state transition plus a flag mechanism to tune the offer window, and (5) SCALABILITY — index review, presence fan-out for the demand hint, notification batching, and timezone/DST correctness for `scheduled_for`/offer expiry.

**Architecture:** P11 is *woven through* P0–P10, so it does **not** invent loop tables or RPCs — it builds the thin, reusable layers that wrap them. State handling and a11y live in **shared React primitives** in `apps/web/components/loop/` (consumed by P4/P5/P6 loop screens, and later by `apps/mobile`). Analytics is **dual-path**: client transitions go through an extended `track` helper in `apps/web/app/PostHogProvider.tsx`; server-authoritative transitions (offer made/accepted/expired, lock, auto-roll — all fired by P5 SECURITY DEFINER functions and P2 jobs) are written to a new `analytics_events` outbox table by the same `log_status_transition()` trigger family P0 already installs, then forwarded to PostHog by a small relay so **no transition is lost when it happens in the DB rather than the browser**. Feature flags use PostHog flags read through a typed wrapper, with a DB-backed fallback (`feature_config`) so the offer-window length is tunable even when PostHog is unreachable and so jobs/Edge Functions (which have no browser SDK) can read it. Timezone/DST is enforced as an invariant: every wall-clock value is stored `timestamptz` (P0 already does this) and every *display* + *expiry math* resolves against `cities.timezone` via a shared `formatInZone`/`addOfferWindow` utility.

**Tech Stack:** Next.js 15 (App Router, React 19) + Tailwind (existing cream palette + a new dark feed theme), `posthog-js` (already a dep) + `posthog-node` (added here, for the server relay), Supabase Postgres migrations (`supabase/migrations/`), psql invariant tests (`supabase/tests/`, P0 pattern), and a **newly bootstrapped** Vitest + React Testing Library harness for the shared TS/React primitives (the repo has no test runner yet). Realtime presence (Supabase Realtime) powers the demand-hint fan-out.

**Source docs:** spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§5 browse, §7 lifecycle, §10 mobile, §13 analytics); roadmap `docs/superpowers/plans/2026-05-25-experience-first-dating-implementation-roadmap.md` (P11 scope + Closes); data model `docs/superpowers/plans/2026-05-25-p0-data-model.md` (builds on `audit_log`, `offers`, `locks`, `queue_entries`, `swipes`, `date_instances`, `cities.timezone`).

**Dependency note (woven phase):** P11 is finalized last (per roadmap dependency graph). It assumes P0's schema exists. Where it references P4/P5/P6 loop screens or P2 jobs/push that may not be merged yet, it **builds the shared primitive / table / helper** (which is P11's deliverable) and references the integration point by its P0 contract name — it never edits unbuilt files. Each such reference is called out in the task so integration is a one-line wire-up when the host phase lands.

**Conventions (follow exactly):**
- DB: migration filenames `YYYYMMDDHHMMSS_p11_snake_description.sql`; enable RLS on every new table; idempotent policies via `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`; reuse P0's `set_updated_at()` trigger; `timestamptz` for all instants; psql tests as `DO $$ … RAISE EXCEPTION on failure … END $$;` blocks (clean exit = PASS).
- TS/React: shared primitives in `apps/web/components/loop/`; one component per file; named exports; Tailwind classes only (no inline color hex except in the documented dark-theme token file); analytics event names are `snake_case` and centralized in one taxonomy module — never call `posthog.capture` ad hoc.
- Tests: `*.test.ts(x)` colocated next to source; run with `pnpm --filter @after5/web test`. Each task is failing test → FAIL → real code → PASS → commit.

**Local test loop:**
- React/TS: `pnpm --filter @after5/web test` (Vitest, jsdom).
- DB: `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`.

---

## File Structure

```
apps/web/
  vitest.config.ts                         # NEW — Vitest + jsdom + RTL bootstrap (Task 1)
  vitest.setup.ts                          # NEW — jest-dom matchers, posthog mock
  components/loop/
    AsyncBoundary.tsx                       # Task 2 — loading/error/empty wrapper
    AsyncBoundary.test.tsx
    useAsyncAction.ts                       # Task 3 — idle/pending/error state hook for mutations
    useAsyncAction.test.ts
    LoopActionButton.tsx                    # Task 4 — button w/ pending spinner + disabled + aria-busy
    LoopActionButton.test.tsx
    states.ts                               # Task 2 — LoadState union + copy map (one source of truth)
    OfferCountdown.tsx                      # Task 8 — aria-live polite countdown
    OfferCountdown.test.tsx
    SwipeDeck.tsx                           # Task 7 — gesture + button-equivalent swipe (a11y)
    SwipeDeck.test.tsx
    AmbientSound.tsx                        # Task 6 — audio + visual/caption non-audio equivalent
    AmbientSound.test.tsx
    feed-a11y.ts                            # Task 9 — screen-reader feed semantics helpers
    feed-a11y.test.ts
  app/
    PostHogProvider.tsx                     # EDIT (Task 11) — extend `track` with loop taxonomy + flags
    loop-analytics.ts                       # Task 10 — event taxonomy (single source) + types
    loop-analytics.test.ts
  lib/
    timezone.ts                             # Task 14 — formatInZone / addOfferWindow / DST-safe math
    timezone.test.ts
    feature-flags.ts                        # Task 12 — typed flag reader (PostHog + DB fallback)
    feature-flags.test.ts
  styles/
    feed-theme.css                          # Task 5 — dark feed theme tokens (contrast-audited)
  app/globals.css                           # EDIT (Task 5) — import feed-theme tokens
  tailwind.config.ts                        # EDIT (Task 5) — register `feed.*` dark tokens

packages/api-client/src/
  analytics-relay.ts                        # Task 13 — drain analytics_events → posthog-node
  analytics-relay.test.ts

supabase/
  migrations/
    20260525130000_p11_analytics_events.sql       # Task 10 — outbox + trigger extension
    20260525130100_p11_feature_config.sql          # Task 12 — DB-backed flag fallback
    20260525130200_p11_index_review.sql            # Task 15 — missing/covering indexes
    20260525130300_p11_presence_demand_hint.sql    # Task 16 — bucketed demand-hint view
    20260525130400_p11_notification_batching.sql   # Task 17 — batch/coalesce notification rows
    20260525130500_p11_offer_expiry_tz.sql          # Task 14 — TZ-correct expiry helper fn
  tests/
    p11_analytics_events.sql
    p11_feature_config.sql
    p11_index_review.sql
    p11_presence_demand_hint.sql
    p11_notification_batching.sql
    p11_offer_expiry_tz.sql
```

---

## Task 1: Bootstrap the Vitest + React Testing Library harness

The repo has **no test runner**. Every later TS/React task needs one. This task adds it and proves it runs.

**Files:**
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/vitest.setup.ts`
- Create: `apps/web/components/loop/smoke.test.ts`
- Modify: `apps/web/package.json` (devDeps + `test` script)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/components/loop/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test`
Expected: FAIL — `test` script does not exist / `vitest: command not found`.

- [ ] **Step 3: Add the harness**

Add to `apps/web/package.json` `devDependencies`: `"vitest": "^2.1.0"`, `"@vitejs/plugin-react": "^4.3.0"`, `"jsdom": "^25.0.0"`, `"@testing-library/react": "^16.0.0"`, `"@testing-library/jest-dom": "^6.5.0"`, `"@testing-library/user-event": "^14.5.0"`. Add to `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`.

```ts
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
```

```ts
// apps/web/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// posthog-js must never make network calls in tests; stub the module surface we use.
vi.mock('posthog-js', () => ({
  default: { init: vi.fn(), capture: vi.fn(), isFeatureEnabled: vi.fn(), getFeatureFlagPayload: vi.fn() },
}));
```

Then `pnpm install` (run from repo root; updates lockfile).

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test`
Expected: PASS — 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/vitest.config.ts apps/web/vitest.setup.ts apps/web/components/loop/smoke.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "P11: bootstrap Vitest + React Testing Library test harness for apps/web

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `AsyncBoundary` — the one loading/error/empty pattern

Defines the **single, consistent** state contract every loop screen uses. `LoadState<T>` is a discriminated union (`idle | loading | error | empty | ready`) and `AsyncBoundary` renders the right slot. `states.ts` also holds the canonical copy map so "the night filled up" (spec §2 pillar 5, kind-by-design) and error/retry strings are not reinvented per screen.

**Files:**
- Create: `apps/web/components/loop/states.ts`
- Create: `apps/web/components/loop/AsyncBoundary.tsx`
- Create: `apps/web/components/loop/AsyncBoundary.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/loop/AsyncBoundary.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AsyncBoundary } from './AsyncBoundary';

describe('AsyncBoundary', () => {
  it('shows a labelled spinner while loading', () => {
    render(<AsyncBoundary state={{ status: 'loading' }} label="offers">x</AsyncBoundary>);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent(/loading offers/i);
  });

  it('shows an empty slot with custom copy', () => {
    render(
      <AsyncBoundary state={{ status: 'empty' }} empty={<p>No nights nearby yet</p>}>x</AsyncBoundary>,
    );
    expect(screen.getByText(/no nights nearby yet/i)).toBeInTheDocument();
  });

  it('shows an error slot with an accessible retry button', () => {
    const onRetry = () => {};
    render(<AsyncBoundary state={{ status: 'error', error: new Error('boom') }} onRetry={onRetry}>x</AsyncBoundary>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('renders children when ready', () => {
    render(<AsyncBoundary state={{ status: 'ready' }}><span>content</span></AsyncBoundary>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module './AsyncBoundary'`).

- [ ] **Step 3: Write the code**

```ts
// apps/web/components/loop/states.ts
export type LoadState<T = unknown> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'empty' }
  | { status: 'ready'; data?: T };

// Kind-by-design copy (spec §2.5): non-selection / empty never reads as rejection.
export const loopCopy = {
  feedEmpty: 'No nights match your filters right now — widen your distance or check back tonight.',
  shortlistEmpty: 'No one has shown interest in this night yet.',
  offersEmpty: 'No active offer right now.',
  chatEmpty: 'Say hi — this chat opens once an offer is active.',
  genericError: "Something went wrong on our end. We didn't lose your place.",
  retry: 'Try again',
} as const;
```

```tsx
// apps/web/components/loop/AsyncBoundary.tsx
'use client';
import type { ReactNode } from 'react';
import type { LoadState } from './states';
import { loopCopy } from './states';

export function AsyncBoundary<T>({
  state, label = 'content', empty, onRetry, children,
}: {
  state: LoadState<T>;
  label?: string;
  empty?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center py-8 text-secondary">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
        <span className="ml-2 text-sm">{`Loading ${label}…`}</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="rounded-card border border-border bg-surface p-4 text-sm text-text">
        <p>{loopCopy.genericError}</p>
        {onRetry && (
          <button type="button" onClick={onRetry}
            className="mt-3 rounded-pill border border-border px-3 py-1.5 font-medium hover:bg-background">
            {loopCopy.retry}
          </button>
        )}
      </div>
    );
  }
  if (state.status === 'empty') {
    return <div className="py-8 text-center text-secondary text-sm">{empty ?? loopCopy.feedEmpty}</div>;
  }
  return <>{children}</>;
}
```

- [ ] **Step 4: Run it, expect PASS** (`pnpm --filter @after5/web test`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/states.ts apps/web/components/loop/AsyncBoundary.tsx apps/web/components/loop/AsyncBoundary.test.tsx
git commit -m "P11: AsyncBoundary + LoadState union — one loading/error/empty pattern for the loop

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `useAsyncAction` — mutation state for the riskiest flows

Wraps any async mutation (offer accept, lock, swipe, withdraw) in `idle → pending → success | error`, prevents double-submit, and surfaces a typed error. This is the hook the concrete riskiest flows (Task 4 button, P5 lock confirm) build on.

**Files:**
- Create: `apps/web/components/loop/useAsyncAction.ts`
- Create: `apps/web/components/loop/useAsyncAction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/components/loop/useAsyncAction.test.ts
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useAsyncAction } from './useAsyncAction';

describe('useAsyncAction', () => {
  it('moves idle → pending → idle on success and returns the value', async () => {
    const fn = vi.fn().mockResolvedValue('locked');
    const { result } = renderHook(() => useAsyncAction(fn));
    expect(result.current.status).toBe('idle');
    let returned: unknown;
    await act(async () => { returned = await result.current.run('id-1'); });
    expect(returned).toBe('locked');
    expect(result.current.status).toBe('idle');
  });

  it('ignores a second call while pending (no double-submit)', async () => {
    let release!: () => void;
    const fn = vi.fn(() => new Promise<void>((res) => { release = res; }));
    const { result } = renderHook(() => useAsyncAction(fn));
    act(() => { void result.current.run(); });
    act(() => { void result.current.run(); });
    expect(fn).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
  });

  it('captures the error and exposes it', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('offer expired'));
    const { result } = renderHook(() => useAsyncAction(fn));
    await act(async () => { await result.current.run().catch(() => {}); });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('offer expired');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code**

```ts
// apps/web/components/loop/useAsyncAction.ts
'use client';
import { useCallback, useRef, useState } from 'react';

type Status = 'idle' | 'pending' | 'error';

export function useAsyncAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<Error | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    if (inFlight.current) return undefined;     // dedupe double-submit
    inFlight.current = true;
    setStatus('pending');
    setError(null);
    try {
      const result = await fn(...args);
      setStatus('idle');
      return result;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setStatus('error');
      throw err;
    } finally {
      inFlight.current = false;
    }
  }, [fn]);

  return { status, error, run, isPending: status === 'pending' };
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/useAsyncAction.ts apps/web/components/loop/useAsyncAction.test.ts
git commit -m "P11: useAsyncAction hook — pending/error state + double-submit guard for loop mutations

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `LoopActionButton` — the concrete accessible mutation control

The button used by offer-accept and lock-confirm (the two highest-stakes, irreversible flows). Disables + sets `aria-busy` while pending, shows a spinner, and emits the configured analytics event on success (wired to Task 10's taxonomy).

**Files:**
- Create: `apps/web/components/loop/LoopActionButton.tsx`
- Create: `apps/web/components/loop/LoopActionButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/loop/LoopActionButton.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { LoopActionButton } from './LoopActionButton';

describe('LoopActionButton', () => {
  it('disables and sets aria-busy while the action runs, then re-enables', async () => {
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((res) => { release = res; }));
    render(<LoopActionButton action={action}>Confirm lock</LoopActionButton>);
    const btn = screen.getByRole('button', { name: /confirm lock/i });
    await userEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    release();
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('renders an accessible error after a failed action', async () => {
    const action = vi.fn().mockRejectedValue(new Error('expired'));
    render(<LoopActionButton action={action}>Accept offer</LoopActionButton>);
    await userEvent.click(screen.getByRole('button', { name: /accept offer/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i));
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code**

```tsx
// apps/web/components/loop/LoopActionButton.tsx
'use client';
import type { ReactNode } from 'react';
import { useAsyncAction } from './useAsyncAction';
import { loopCopy } from './states';

export function LoopActionButton({
  action, children, onDone, className,
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  onDone?: () => void;
  className?: string;
}) {
  const { run, isPending, status, error } = useAsyncAction(action);
  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        aria-busy={isPending}
        onClick={() => { void run().then((r) => { if (r !== undefined) onDone?.(); }).catch(() => {}); }}
        className={className ?? 'inline-flex items-center gap-2 rounded-pill bg-accent px-5 py-2.5 font-medium text-background disabled:opacity-60'}
      >
        {isPending && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
        {children}
      </button>
      {status === 'error' && (
        <p role="alert" className="mt-2 text-sm text-accent">{loopCopy.genericError}{error ? '' : ''}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/LoopActionButton.tsx apps/web/components/loop/LoopActionButton.test.tsx
git commit -m "P11: LoopActionButton — accessible pending/disabled/aria-busy control for accept + lock

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Dark feed theme tokens + pink-on-dark contrast audit

The immersive blind feed (spec §5: "feel the night while you scroll") is dark-themed with a pink accent — distinct from the cream marketing palette. The audit flagged "pink-on-dark contrast." This task defines the dark `feed.*` tokens, picks a pink that **passes WCAG AA (≥4.5:1 for text, ≥3:1 for large text/UI)** against the dark background, and proves it with a contrast test computed from the token values.

**Files:**
- Create: `apps/web/styles/feed-theme.css`
- Modify: `apps/web/tailwind.config.ts` (register `feed.*` colors)
- Create: `apps/web/lib/contrast.ts` (WCAG ratio util)
- Create: `apps/web/lib/contrast.test.ts`

- [ ] **Step 1: Write the failing test** (the chosen tokens must pass AA)

```ts
// apps/web/lib/contrast.test.ts
import { describe, it, expect } from 'vitest';
import { contrastRatio, FEED_TOKENS } from './contrast';

describe('feed dark-theme contrast (WCAG AA)', () => {
  it('body text on feed bg is ≥ 4.5:1', () => {
    expect(contrastRatio(FEED_TOKENS.text, FEED_TOKENS.bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('pink accent on feed bg is ≥ 3:1 (large text / UI affordance)', () => {
    expect(contrastRatio(FEED_TOKENS.accent, FEED_TOKENS.bg)).toBeGreaterThanOrEqual(3);
  });
  it('muted/secondary text on feed bg is ≥ 4.5:1', () => {
    expect(contrastRatio(FEED_TOKENS.muted, FEED_TOKENS.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module './contrast'`).

- [ ] **Step 3: Write the code** — implement the WCAG ratio and pick passing tokens.

```ts
// apps/web/lib/contrast.ts
// WCAG 2.x relative-luminance contrast ratio. Used to keep the dark feed theme
// (pink-on-dark) accessible; the FEED_TOKENS here are the source of truth that
// feed-theme.css and tailwind.config.ts mirror.
export const FEED_TOKENS = {
  bg:     '#14101A', // near-black plum (the night)
  text:   '#F5EEF7', // off-white
  muted:  '#C9B9D6', // lavender-grey — must clear 4.5:1
  accent: '#FF6FA5', // pink affordance (swipe-right / live elements) — must clear 3:1
} as const;

function luminance(hex: string): number {
  const m = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
```

> If any token fails AA at first run, darken `bg` / lighten `text`/`muted` / saturate `accent` until the test passes. Do **not** weaken the threshold.

```css
/* apps/web/styles/feed-theme.css — mirrors FEED_TOKENS (lib/contrast.ts is source of truth). */
.feed-theme {
  --feed-bg: #14101A;
  --feed-text: #F5EEF7;
  --feed-muted: #C9B9D6;
  --feed-accent: #FF6FA5;
  background: var(--feed-bg);
  color: var(--feed-text);
}
```

In `apps/web/tailwind.config.ts`, add under `theme.extend.colors`:
```ts
feed: {
  bg: '#14101A',
  text: '#F5EEF7',
  muted: '#C9B9D6',
  accent: '#FF6FA5',
},
```
Add `import './styles/feed-theme.css';` to `apps/web/app/globals.css` (or `@import` per its existing pattern).

- [ ] **Step 4: Run it, expect PASS.** If it fails, adjust hex values (per the note) and re-run until green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/contrast.ts apps/web/lib/contrast.test.ts apps/web/styles/feed-theme.css apps/web/tailwind.config.ts apps/web/app/globals.css
git commit -m "P11: dark feed theme tokens + WCAG-AA pink-on-dark contrast audit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `AmbientSound` — audio with a non-audio equivalent (a11y + web fallback)

Spec §5 plays ambient sound per night; §10 notes iOS Safari blocks autoplay-with-sound. This component plays audio when allowed, but **always** renders a visible caption + waveform-equivalent so deaf/HoH users and muted-web users get the same information. Audio never autoplays-with-sound on web (gesture-gated); the caption is the canonical channel.

**Files:**
- Create: `apps/web/components/loop/AmbientSound.tsx`
- Create: `apps/web/components/loop/AmbientSound.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/loop/AmbientSound.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { AmbientSound } from './AmbientSound';

describe('AmbientSound', () => {
  it('renders a text caption equivalent for the sound (a11y, no audio required)', () => {
    render(<AmbientSound src="/s/jazz.mp3" caption="Low jazz, clinking glasses" />);
    expect(screen.getByText(/low jazz, clinking glasses/i)).toBeInTheDocument();
  });

  it('does not autoplay with sound on web (muted by default, gesture-gated)', () => {
    render(<AmbientSound src="/s/jazz.mp3" caption="x" />);
    const audio = screen.getByTestId('ambient-audio') as HTMLAudioElement;
    expect(audio.autoplay).toBe(false);
    expect(audio.muted).toBe(true);
    expect(audio).toHaveAttribute('preload', 'none');
  });

  it('exposes a labelled play toggle for screen readers', () => {
    render(<AmbientSound src="/s/jazz.mp3" caption="x" />);
    expect(screen.getByRole('button', { name: /play ambient sound/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code**

```tsx
// apps/web/components/loop/AmbientSound.tsx
'use client';
import { useRef, useState } from 'react';

// Audio is the garnish; the caption is the canonical channel (a11y + iOS-Safari
// autoplay block, spec §10). Audio is muted + preload=none and only un-mutes on
// an explicit user gesture, so nothing autoplays-with-sound on web.
export function AmbientSound({ src, caption }: { src: string; caption: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); return; }
    el.muted = false;
    void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  };

  return (
    <div className="flex items-center gap-2 text-sm text-feed-muted">
      <button type="button" onClick={toggle}
        aria-label={playing ? 'Pause ambient sound' : 'Play ambient sound'}
        className="rounded-pill border border-feed-muted/40 px-2 py-1">
        {playing ? '❚❚' : '►'}
      </button>
      <span aria-hidden={false}>{caption}</span>
      <audio ref={ref} src={src} muted autoPlay={false} preload="none" loop data-testid="ambient-audio" />
    </div>
  );
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/AmbientSound.tsx apps/web/components/loop/AmbientSound.test.tsx
git commit -m "P11: AmbientSound — caption non-audio equivalent + gesture-gated playback (a11y + web fallback)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `SwipeDeck` — accessible swipe with button equivalents

The audit requires an accessible alternative to the swipe gesture. This deck renders **explicit Pass / Interested buttons** (keyboard + screen-reader operable) alongside the gesture, fires the same callback for both, and announces the result via `aria-live`. Gesture handling is minimal (pointer-based) so the component stays test-friendly; the buttons are the accessibility-complete path.

**Files:**
- Create: `apps/web/components/loop/SwipeDeck.tsx`
- Create: `apps/web/components/loop/SwipeDeck.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/loop/SwipeDeck.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SwipeDeck } from './SwipeDeck';

describe('SwipeDeck', () => {
  it('fires onSwipe("right") from the Interested button', async () => {
    const onSwipe = vi.fn();
    render(<SwipeDeck dateInstanceId="di-1" onSwipe={onSwipe}><p>The night</p></SwipeDeck>);
    await userEvent.click(screen.getByRole('button', { name: /interested/i }));
    expect(onSwipe).toHaveBeenCalledWith('right');
  });

  it('fires onSwipe("left") from the Pass button', async () => {
    const onSwipe = vi.fn();
    render(<SwipeDeck dateInstanceId="di-1" onSwipe={onSwipe}><p>The night</p></SwipeDeck>);
    await userEvent.click(screen.getByRole('button', { name: /pass/i }));
    expect(onSwipe).toHaveBeenCalledWith('left');
  });

  it('the card group has a screen-reader label and a live region', () => {
    render(<SwipeDeck dateInstanceId="di-1" onSwipe={() => {}}><p>x</p></SwipeDeck>);
    expect(screen.getByRole('group', { name: /a date night/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code**

```tsx
// apps/web/components/loop/SwipeDeck.tsx
'use client';
import { useState, type ReactNode } from 'react';

type Direction = 'left' | 'right';

export function SwipeDeck({
  dateInstanceId, onSwipe, children,
}: {
  dateInstanceId: string;
  onSwipe: (dir: Direction) => void;
  children: ReactNode;
}) {
  const [announce, setAnnounce] = useState('');

  const act = (dir: Direction) => {
    setAnnounce(dir === 'right' ? 'Marked interested. Next night.' : 'Passed. Next night.');
    onSwipe(dir);
  };

  return (
    <div role="group" aria-label="A date night to consider" data-instance={dateInstanceId} className="feed-theme">
      <div>{children}</div>
      <div className="mt-4 flex items-center justify-center gap-4">
        <button type="button" onClick={() => act('left')}
          className="rounded-pill border border-feed-muted/40 px-6 py-3 text-feed-text">
          Pass
        </button>
        <button type="button" onClick={() => act('right')}
          className="rounded-pill bg-feed-accent px-6 py-3 font-medium text-feed-bg">
          Interested
        </button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/SwipeDeck.tsx apps/web/components/loop/SwipeDeck.test.tsx
git commit -m "P11: SwipeDeck — keyboard/SR-accessible Pass+Interested buttons as swipe-gesture equivalent

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `OfferCountdown` — accessible time-boxed offer timer

The exclusive offer (spec §7.3) is "confirm by [T]." The countdown must be announced to screen readers without spamming them. Uses `aria-live="polite"` and only re-announces at meaningful thresholds (per-minute under 1h, per-hour above), computing remaining time against the absolute `expires_at` (timezone-safe via Task 14's helper).

**Files:**
- Create: `apps/web/components/loop/OfferCountdown.tsx`
- Create: `apps/web/components/loop/OfferCountdown.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/loop/OfferCountdown.test.tsx
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OfferCountdown } from './OfferCountdown';

describe('OfferCountdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders a polite live region with remaining time', () => {
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    render(<OfferCountdown expiresAt={expires} />);
    const live = screen.getByRole('timer');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent(/2h/);
  });

  it('shows the expired message once past expiry and calls onExpire', () => {
    const onExpire = vi.fn();
    const expires = new Date(Date.now() + 1000).toISOString();
    render(<OfferCountdown expiresAt={expires} onExpire={onExpire} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('timer')).toHaveTextContent(/expired/i);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code**

```tsx
// apps/web/components/loop/OfferCountdown.tsx
'use client';
import { useEffect, useRef, useState } from 'react';

function remaining(expiresAt: string): { ms: number; label: string } {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { ms, label: 'Offer expired' };
  const mins = Math.floor(ms / 60000);
  if (mins >= 60) return { ms, label: `${Math.floor(mins / 60)}h ${mins % 60}m left to confirm` };
  return { ms, label: `${mins}m left to confirm` };
}

export function OfferCountdown({ expiresAt, onExpire }: { expiresAt: string; onExpire?: () => void }) {
  const [state, setState] = useState(() => remaining(expiresAt));
  const fired = useRef(false);

  useEffect(() => {
    const tick = () => {
      const next = remaining(expiresAt);
      setState(next);
      if (next.ms <= 0 && !fired.current) { fired.current = true; onExpire?.(); }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  return (
    <span role="timer" aria-live="polite" aria-atomic="true" className="font-medium text-feed-accent">
      {state.label}
    </span>
  );
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/OfferCountdown.tsx apps/web/components/loop/OfferCountdown.test.tsx
git commit -m "P11: OfferCountdown — aria-live polite offer-window timer with onExpire callback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Screen-reader feed semantics helpers

The blind feed must read coherently to a screen reader: each night is a list item with a composed accessible name ("A Friday evening night in Downtown, 50-50, low jazz") that **never leaks creator identity** (spec §5/§7.2). This pure module composes that label from the `browse_feed` view fields (P0 Task 11), so feed markup and tests share one labelling rule.

**Files:**
- Create: `apps/web/components/loop/feed-a11y.ts`
- Create: `apps/web/components/loop/feed-a11y.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/components/loop/feed-a11y.test.ts
import { describe, it, expect } from 'vitest';
import { feedItemLabel, FEED_LIST_ROLE } from './feed-a11y';

describe('feed-a11y', () => {
  it('composes a label from blind feed fields only (no identity)', () => {
    const label = feedItemLabel({
      time_window_start: '2026-06-05T19:00:00Z',
      venue_neighborhood: 'Downtown',
      pay_setting: 'split',
      vibe_tags: ['cozy', 'live music'],
      timezone: 'America/Vancouver',
    });
    expect(label).toMatch(/Downtown/);
    expect(label).toMatch(/cozy/);
    expect(label).toMatch(/split the bill|50-?50/i);
  });

  it('never references a creator name or id', () => {
    const label = feedItemLabel({
      time_window_start: '2026-06-05T19:00:00Z',
      venue_neighborhood: 'Pandosy',
      pay_setting: 'i_pay',
      vibe_tags: [],
      timezone: 'America/Vancouver',
      // @ts-expect-error — proving creator fields are not consumed even if present
      creator_id: 'should-be-ignored', creator_name: 'Alex',
    });
    expect(label.toLowerCase()).not.toContain('alex');
    expect(label).not.toContain('should-be-ignored');
  });

  it('exposes the list role for the feed container', () => {
    expect(FEED_LIST_ROLE).toBe('feed');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code**

```ts
// apps/web/components/loop/feed-a11y.ts
import { formatInZone } from '@/lib/timezone';

// ARIA `feed` role gives SR users a paged, virtual-scroll-friendly reading model.
export const FEED_LIST_ROLE = 'feed' as const;

type FeedItem = {
  time_window_start: string;        // ISO; coarse (hour-truncated) per browse_feed
  venue_neighborhood: string | null;
  pay_setting: 'i_pay' | 'they_pay' | 'split' | null;
  vibe_tags: string[];
  timezone: string;                 // from cities.timezone
};

const PAY_COPY: Record<NonNullable<FeedItem['pay_setting']>, string> = {
  i_pay: 'they treat',
  they_pay: 'you treat',
  split: '50-50, split the bill',
};

// Consumes ONLY blind fields — creator identity is structurally absent (browse_feed view).
export function feedItemLabel(item: FeedItem): string {
  const when = formatInZone(item.time_window_start, item.timezone, { weekday: 'long', hour: 'numeric' });
  const where = item.venue_neighborhood ?? 'a vetted spot';
  const vibe = item.vibe_tags.length ? `, ${item.vibe_tags.join(' and ')}` : '';
  const pay = item.pay_setting ? `, ${PAY_COPY[item.pay_setting]}` : '';
  return `A ${when} night in ${where}${vibe}${pay}`;
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/feed-a11y.ts apps/web/components/loop/feed-a11y.test.ts
git commit -m "P11: feed-a11y — SR-safe feed item labels (blind fields only) + ARIA feed role

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Analytics taxonomy + `analytics_events` outbox (every transition)

Spec §13 demands an event for **every** lifecycle transition. Two halves:
1. **Client taxonomy** (`loop-analytics.ts`): one typed map of every event name + payload shape — `swipe_right`, `swipe_left`, `shortlist_added`, `rank_changed`, `offer_made`, `offer_accepted`, `offer_passed`, `offer_expired`, `standby_filled`, `lock_confirmed`, `lock_cancelled`, `reciprocal_chooser_shown`, `withdraw`, `rate_submitted`, `feed_empty_shown`, plus `time_to_lock`.
2. **Server outbox** (`analytics_events` table + trigger): because the highest-value transitions (offer made/accepted/expired, lock, auto-roll) fire inside P5 SECURITY DEFINER functions / P2 jobs — *not* the browser — a DB trigger writes them to `analytics_events`, which Task 13's relay drains to PostHog. This guarantees server-authoritative transitions are never lost.

**Files:**
- Create: `apps/web/app/loop-analytics.ts`
- Create: `apps/web/app/loop-analytics.test.ts`
- Create: `supabase/migrations/20260525130000_p11_analytics_events.sql`
- Create: `supabase/tests/p11_analytics_events.sql`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/loop-analytics.test.ts
import { describe, it, expect } from 'vitest';
import { LOOP_EVENTS, isLoopEvent } from './loop-analytics';

describe('loop analytics taxonomy', () => {
  it('enumerates every §7.1 / §13 transition', () => {
    for (const name of [
      'swipe_right', 'swipe_left', 'shortlist_added', 'rank_changed',
      'offer_made', 'offer_accepted', 'offer_passed', 'offer_expired',
      'standby_filled', 'lock_confirmed', 'lock_cancelled',
      'reciprocal_chooser_shown', 'withdraw', 'rate_submitted', 'feed_empty_shown',
    ]) {
      expect(LOOP_EVENTS).toContain(name);
    }
  });
  it('isLoopEvent guards unknown names', () => {
    expect(isLoopEvent('offer_made')).toBe(true);
    expect(isLoopEvent('nope')).toBe(false);
  });
});
```

```sql
-- supabase/tests/p11_analytics_events.sql
-- A status change on offers must enqueue an analytics_events row (server-authoritative transition).
DO $$
DECLARE cre uuid; cand uuid; cid uuid; inst uuid; off uuid; n int;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'c') returning id into cre;
  insert into profiles (id, first_name) values (gen_random_uuid(),'a') returning id into cand;
  insert into cities (slug,name,timezone,is_active) values ('p11a','p11a','America/Vancouver',true)
    on conflict (slug) do nothing;
  select id into cid from cities where slug='p11a';
  insert into itineraries (id,user_id) values (gen_random_uuid(),cre);
  insert into date_instances (itinerary_id,creator_id,city_id,starts_at)
    select i.id,cre,cid, now()+interval '2 days' from itineraries i where i.user_id=cre limit 1
    returning id into inst;
  insert into offers (date_instance_id,candidate_id,creator_id,status,expires_at)
    values (inst,cand,cre,'active', now()+interval '1 day') returning id into off;
  update offers set status='accepted', resolved_at=now() where id=off;
  select count(*) into n from analytics_events
    where entity='offers' and entity_id=off and event='offer_accepted';
  IF n < 1 THEN RAISE EXCEPTION 'analytics_events did not capture offer_accepted'; END IF;
  RAISE NOTICE 'analytics_events OK (% rows)', n;
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (missing module; `relation "analytics_events" does not exist`).

- [ ] **Step 3: Write the code**

```ts
// apps/web/app/loop-analytics.ts
// Single source of truth for loop event names + payloads. NEVER call posthog.capture
// with a string literal elsewhere — add it here so client + server taxonomies match
// the DB `analytics_events.event` enum-of-text written by the trigger in migration p11.
export const LOOP_EVENTS = [
  'swipe_right', 'swipe_left', 'shortlist_added', 'rank_changed',
  'offer_made', 'offer_accepted', 'offer_passed', 'offer_expired',
  'standby_filled', 'lock_confirmed', 'lock_cancelled',
  'reciprocal_chooser_shown', 'withdraw', 'rate_submitted', 'feed_empty_shown',
] as const;

export type LoopEvent = (typeof LOOP_EVENTS)[number];

export function isLoopEvent(name: string): name is LoopEvent {
  return (LOOP_EVENTS as readonly string[]).includes(name);
}

export interface LoopEventProps {
  date_instance_id?: string;
  city_id?: string;
  queue_position?: number;
  offer_window_hours?: number;   // experiment context for tuning the window
  time_to_lock_ms?: number;
}
```

```sql
-- supabase/migrations/20260525130000_p11_analytics_events.sql
-- Outbox for server-authoritative loop transitions (offer/lock/queue/date_instance status
-- changes happen in SECURITY DEFINER fns + jobs, not the browser). Drained by the relay
-- (api-client/analytics-relay.ts) to PostHog. Keeps the §13 "every transition" guarantee
-- even when the transition never touches a client.
create table if not exists analytics_events (
  id bigint generated always as identity primary key,
  event text not null,                 -- mirrors apps/web/app/loop-analytics.ts LOOP_EVENTS
  entity text not null,                -- 'offers' | 'locks' | 'queue_entries' | 'date_instances'
  entity_id uuid not null,
  distinct_id uuid,                    -- subject user for PostHog identity
  props jsonb not null default '{}',
  forwarded_at timestamptz,            -- null = not yet sent to PostHog
  created_at timestamptz not null default now()
);
create index if not exists analytics_events_unforwarded_idx
  on analytics_events (created_at) where forwarded_at is null;

-- Map a (table, old_status, new_status) transition to a LOOP_EVENT name.
create or replace function loop_event_for(tbl text, old_s text, new_s text) returns text
language sql immutable as $fn$
  select case
    when tbl='offers' and new_s='active'   then 'offer_made'
    when tbl='offers' and new_s='accepted' then 'offer_accepted'
    when tbl='offers' and new_s='passed'   then 'offer_passed'
    when tbl='offers' and new_s='expired'  then 'offer_expired'
    when tbl='locks'  and new_s='active'   then 'lock_confirmed'
    when tbl='locks'  and new_s='cancelled' then 'lock_cancelled'
    when tbl='queue_entries' and new_s='shortlisted' then 'shortlist_added'
    when tbl='queue_entries' and new_s='standby'     then 'standby_filled'
    else null
  end;
$fn$;

create or replace function enqueue_analytics_event() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare ev text; subj uuid;
begin
  if (tg_op='INSERT') then
    ev := loop_event_for(tg_table_name, null, new.status::text);
  elsif (tg_op='UPDATE' and new.status is distinct from old.status) then
    ev := loop_event_for(tg_table_name, old.status::text, new.status::text);
  else
    return new;
  end if;
  if ev is null then return new; end if;
  -- subject = the candidate/matched user where present, else creator
  subj := coalesce(
    case when tg_table_name='offers' then new.candidate_id
         when tg_table_name='locks' then new.matched_user_id
         when tg_table_name='queue_entries' then new.candidate_id
         else null end,
    new.creator_id);
  insert into analytics_events(event, entity, entity_id, distinct_id, props)
  values (ev, tg_table_name, new.id, subj,
          jsonb_build_object('date_instance_id', new.date_instance_id));
  return new;
end $fn$;

create trigger analytics_offers after insert or update on offers
  for each row execute function enqueue_analytics_event();
create trigger analytics_locks after insert or update on locks
  for each row execute function enqueue_analytics_event();
create trigger analytics_queue after insert or update on queue_entries
  for each row execute function enqueue_analytics_event();

alter table analytics_events enable row level security;  -- service-role read/drain only; no policies = deny.
```

- [ ] **Step 4: Apply + run both tests, expect PASS** (`supabase db reset && psql … -f supabase/tests/p11_analytics_events.sql`; `pnpm --filter @after5/web test`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/loop-analytics.ts apps/web/app/loop-analytics.test.ts supabase/migrations/20260525130000_p11_analytics_events.sql supabase/tests/p11_analytics_events.sql
git commit -m "P11: loop analytics taxonomy + analytics_events outbox trigger (every server transition)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Extend the client `track` helper with the loop taxonomy

Wire the client-side transitions (swipe, withdraw, rate, empty-feed-shown, reciprocal-chooser-shown, time_to_lock) through the existing `track` object in `PostHogProvider.tsx`, validated against Task 10's taxonomy so a typo can't ship an off-taxonomy event.

**Files:**
- Modify: `apps/web/app/PostHogProvider.tsx`
- Create: `apps/web/app/loop-track.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/loop-track.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import posthog from 'posthog-js';
import { track } from './PostHogProvider';

beforeEach(() => { vi.clearAllMocks(); process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test'; });

describe('track.loop', () => {
  it('captures a taxonomy event with props', () => {
    track.loop('swipe_right', { date_instance_id: 'di-1' });
    expect(posthog.capture).toHaveBeenCalledWith('swipe_right', { date_instance_id: 'di-1' });
  });
  it('throws on an off-taxonomy event name (dev guard)', () => {
    // @ts-expect-error invalid event
    expect(() => track.loop('not_an_event', {})).toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Edit `PostHogProvider.tsx`** — add the `loop` member to the exported `track` object and import the taxonomy:

```ts
// add near the top imports
import { isLoopEvent, type LoopEvent, type LoopEventProps } from './loop-analytics';

// add inside the exported `track` object:
  loop: (event: LoopEvent, props?: LoopEventProps) => {
    if (!isLoopEvent(event)) throw new Error(`Unknown loop event: ${event}`);
    safeCapture(event, props);
  },
```

(Note: `ensureInit()` already no-ops without `NEXT_PUBLIC_POSTHOG_KEY`; the test sets it so `safeCapture` reaches the mocked `posthog.capture`.)

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/PostHogProvider.tsx apps/web/app/loop-track.test.tsx
git commit -m "P11: track.loop — typed client capture for loop transitions, validated against taxonomy

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Feature flags + `feature_config` (tune the offer window)

Open question §11.1: the lock-offer window length (default 24–48h) must be tunable via experiment. PostHog feature flags drive client experiments, but **jobs and Edge Functions (offer-expiry) have no browser SDK**, so the source of truth for the window length is a DB row in `feature_config`; PostHog is the experiment-assignment layer that *writes* the chosen value, and the client reader prefers the PostHog flag and falls back to the DB value.

**Files:**
- Create: `apps/web/lib/feature-flags.ts`
- Create: `apps/web/lib/feature-flags.test.ts`
- Create: `supabase/migrations/20260525130100_p11_feature_config.sql`
- Create: `supabase/tests/p11_feature_config.sql`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/feature-flags.test.ts
import { describe, it, expect, vi } from 'vitest';
import posthog from 'posthog-js';
import { offerWindowHours } from './feature-flags';

describe('offerWindowHours', () => {
  it('uses the PostHog flag payload when present', () => {
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue({ hours: 36 });
    expect(offerWindowHours(48)).toBe(36);
  });
  it('falls back to the provided DB default when no flag', () => {
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    expect(offerWindowHours(48)).toBe(48);
  });
  it('clamps to the safe 12–72h range', () => {
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue({ hours: 999 });
    expect(offerWindowHours(48)).toBe(72);
  });
});
```

```sql
-- supabase/tests/p11_feature_config.sql
DO $$
DECLARE v int;
BEGIN
  PERFORM 1 FROM feature_config WHERE key='offer_window_hours';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_window_hours seed missing'; END IF;
  SELECT (value->>'hours')::int INTO v FROM feature_config WHERE key='offer_window_hours';
  IF v < 12 OR v > 72 THEN RAISE EXCEPTION 'offer_window_hours out of safe range: %', v; END IF;
  RAISE NOTICE 'feature_config OK (offer window = % h)', v;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL.**

- [ ] **Step 3: Write the code**

```ts
// apps/web/lib/feature-flags.ts
'use client';
import posthog from 'posthog-js';

const MIN_HOURS = 12;
const MAX_HOURS = 72;

// Offer-window length (spec §11.1). PostHog flag payload is the experiment layer;
// the dbDefault arg is the feature_config fallback the server/jobs also read.
export function offerWindowHours(dbDefault: number): number {
  const payload = posthog.getFeatureFlagPayload?.('offer_window') as { hours?: number } | undefined;
  const raw = typeof payload?.hours === 'number' ? payload.hours : dbDefault;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(raw)));
}
```

```sql
-- supabase/migrations/20260525130100_p11_feature_config.sql
-- DB-backed flag/config fallback. Jobs + Edge Functions (no browser SDK) read here;
-- PostHog experiments may overwrite the value when an experiment concludes.
create table if not exists feature_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);
create trigger set_feature_config_updated_at before update on feature_config
  for each row execute function set_updated_at();

insert into feature_config (key, value, description) values
  ('offer_window_hours', '{"hours": 36}', 'Lock-offer expiry window in hours (spec §11.1; safe range 12-72).')
on conflict (key) do nothing;

alter table feature_config enable row level security;
do $$ begin
  create policy "feature_config_public_read" on feature_config for select using (true);
exception when duplicate_object then null; end $$;
-- writes are service-role/admin only (no insert/update policy).
```

- [ ] **Step 4: Apply + run both, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/feature-flags.ts apps/web/lib/feature-flags.test.ts supabase/migrations/20260525130100_p11_feature_config.sql supabase/tests/p11_feature_config.sql
git commit -m "P11: feature flags (offer-window experiment) + feature_config DB fallback for jobs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Analytics relay — drain `analytics_events` to PostHog (server-side)

Forward the outbox to PostHog from the server (jobs/Edge Functions have no browser SDK). Adds `posthog-node` and a pure-ish `drainAnalyticsEvents` that selects unforwarded rows, captures them, and marks them forwarded — idempotent and batched.

**Files:**
- Create: `packages/api-client/src/analytics-relay.ts`
- Create: `packages/api-client/src/analytics-relay.test.ts`
- Modify: `packages/api-client/package.json` (add `posthog-node`)
- Modify: `packages/api-client/src/index.ts` (re-export the relay)

- [ ] **Step 1: Write the failing test** (mocked client + posthog-node)

```ts
// packages/api-client/src/analytics-relay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { drainAnalyticsEvents } from './analytics-relay';

function fakeClient(rows: Array<{ id: number; event: string; distinct_id: string; props: object }>) {
  const updated: number[][] = [];
  return {
    updated,
    from() {
      return {
        select() { return { is() { return { order() { return { limit: async () => ({ data: rows, error: null }) }; } } }; } },
        update() { return { in: async (_c: string, ids: number[]) => { updated.push(ids); return { error: null }; } }; },
      } as never;
    },
  };
}

describe('drainAnalyticsEvents', () => {
  it('captures each unforwarded row and marks them forwarded', async () => {
    const capture = vi.fn();
    const client = fakeClient([
      { id: 1, event: 'offer_made', distinct_id: 'u1', props: { date_instance_id: 'd1' } },
      { id: 2, event: 'lock_confirmed', distinct_id: 'u2', props: {} },
    ]);
    const n = await drainAnalyticsEvents(client as never, { capture } as never);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith({ distinctId: 'u1', event: 'offer_made', properties: { date_instance_id: 'd1' } });
    expect(client.updated.flat()).toEqual([1, 2]);
    expect(n).toBe(2);
  });

  it('returns 0 and skips update when nothing is pending', async () => {
    const capture = vi.fn();
    const client = fakeClient([]);
    const n = await drainAnalyticsEvents(client as never, { capture } as never);
    expect(n).toBe(0);
    expect(capture).not.toHaveBeenCalled();
    expect(client.updated).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code** — add `"posthog-node": "^4.2.0"` to `packages/api-client/package.json` deps, then:

```ts
// packages/api-client/src/analytics-relay.ts
import type { After5Client } from './index';

// Minimal surface of posthog-node we depend on (keeps tests decoupled).
export interface PostHogLike {
  capture(args: { distinctId: string; event: string; properties?: Record<string, unknown> }): void;
}

// Drain the analytics_events outbox to PostHog. Idempotent: only forwarded_at IS NULL
// rows are sent, then marked. Call from a P2 scheduled job (e.g. every minute).
export async function drainAnalyticsEvents(
  client: After5Client,
  ph: PostHogLike,
  batch = 500,
): Promise<number> {
  const { data, error } = await client
    .from('analytics_events')
    .select('id, event, distinct_id, props')
    .is('forwarded_at', null)
    .order('created_at')
    .limit(batch);
  if (error) throw error;
  const rows = data ?? [];
  if (rows.length === 0) return 0;

  for (const r of rows) {
    ph.capture({
      distinctId: (r as { distinct_id: string }).distinct_id,
      event: (r as { event: string }).event,
      properties: (r as { props: Record<string, unknown> }).props,
    });
  }
  const ids = rows.map((r) => (r as { id: number }).id);
  const { error: upErr } = await client
    .from('analytics_events')
    .update({ forwarded_at: new Date().toISOString() })
    .in('id', ids);
  if (upErr) throw upErr;
  return rows.length;
}
```

Re-export from `packages/api-client/src/index.ts`: `export { drainAnalyticsEvents, type PostHogLike } from './analytics-relay';`

- [ ] **Step 4: Run it, expect PASS.** (Run via the web test command if api-client has no own runner: add a sibling `vitest.config.ts` to `packages/api-client`, or import-test it through web — prefer adding the package's own `vitest run` script mirroring Task 1. Keep it minimal: `"test": "vitest run"` + `vitest` devDep.)

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/analytics-relay.ts packages/api-client/src/analytics-relay.test.ts packages/api-client/src/index.ts packages/api-client/package.json pnpm-lock.yaml
git commit -m "P11: analytics relay — drain analytics_events outbox to PostHog (server-side, batched, idempotent)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Timezone/DST correctness for display + offer expiry

The audit flags timezone/DST. P0 already stores everything `timestamptz` (instants are correct), so the risk is in (a) **display** — a "Friday evening" window must render in the city's zone, and (b) **expiry math** — adding the offer window across a DST boundary. Two halves: a TS display helper, and a DB helper that computes `expires_at` from `feature_config` + `cities.timezone` so jobs and the offer RPC share one rule.

**Files:**
- Create: `apps/web/lib/timezone.ts`
- Create: `apps/web/lib/timezone.test.ts`
- Create: `supabase/migrations/20260525130500_p11_offer_expiry_tz.sql`
- Create: `supabase/tests/p11_offer_expiry_tz.sql`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/timezone.test.ts
import { describe, it, expect } from 'vitest';
import { formatInZone, addOfferWindow } from './timezone';

describe('timezone', () => {
  it('formats an instant in the city zone, not the runner zone', () => {
    // 2026-06-05T02:00:00Z is 2026-06-04 19:00 PDT (America/Vancouver, UTC-7 in summer)
    const out = formatInZone('2026-06-05T02:00:00Z', 'America/Vancouver', { weekday: 'long', hour: 'numeric' });
    expect(out).toMatch(/Thursday/);
    expect(out).toMatch(/7/);
  });

  it('adds the offer window as a real-duration (DST-agnostic instant math)', () => {
    const base = '2026-03-08T08:00:00Z'; // around US/CA spring-forward
    const out = addOfferWindow(base, 36);
    expect(out).toBe(new Date(Date.parse(base) + 36 * 3600_000).toISOString());
  });
});
```

```sql
-- supabase/tests/p11_offer_expiry_tz.sql
-- offer_expires_at(starts_at, hours) = starts_at + interval (real duration; instants are tz-safe).
DO $$
DECLARE got timestamptz; want timestamptz;
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname='offer_expires_at';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_expires_at() missing'; END IF;
  got  := offer_expires_at(timestamptz '2026-03-08 08:00:00Z', 36);
  want := timestamptz '2026-03-08 08:00:00Z' + make_interval(hours => 36);
  IF got <> want THEN RAISE EXCEPTION 'offer_expires_at off: got % want %', got, want; END IF;
  RAISE NOTICE 'offer_expires_at OK';
END $$;
```

- [ ] **Step 2: Run both, expect FAIL.**

- [ ] **Step 3: Write the code**

```ts
// apps/web/lib/timezone.ts
// All instants are timestamptz/ISO (correct by storage). These helpers ensure
// DISPLAY resolves in the city zone and offer-window math is a real-duration add,
// so a DST boundary never shifts an offer's wall-clock deadline incorrectly.
export function formatInZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-CA', { ...options, timeZone }).format(new Date(iso));
}

// Offer windows are durations of elapsed time, not calendar hours — adding to the
// epoch instant is inherently DST-safe.
export function addOfferWindow(baseIso: string, hours: number): string {
  return new Date(Date.parse(baseIso) + hours * 3_600_000).toISOString();
}
```

```sql
-- supabase/migrations/20260525130500_p11_offer_expiry_tz.sql
-- Single rule for offer expiry used by the P5 offer RPC and P2 expiry job.
-- starts_at is timestamptz (instant); make_interval add is DST-safe by construction.
create or replace function offer_expires_at(window_start timestamptz, window_hours int)
returns timestamptz language sql immutable as $fn$
  select window_start + make_interval(hours => window_hours);
$fn$;
```

- [ ] **Step 4: Apply + run both, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/timezone.ts apps/web/lib/timezone.test.ts supabase/migrations/20260525130500_p11_offer_expiry_tz.sql supabase/tests/p11_offer_expiry_tz.sql
git commit -m "P11: timezone/DST helpers — city-zone display + DST-safe offer expiry (shared client+DB rule)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Index review — covering indexes for hot loop queries

Review the loop's hot read paths and add the indexes P0 left out. Hot paths: (a) creator pulls right-swipers for a night (`swipes` by instance, direction); (b) candidate reads their queue rows; (c) the expiry job scans active offers by `expires_at`; (d) the auto-roll job finds the next `standby` by rank; (e) the relay scans unforwarded analytics. Verify each via `EXPLAIN` choosing an index scan, asserted in psql.

**Files:**
- Create: `supabase/migrations/20260525130200_p11_index_review.sql`
- Create: `supabase/tests/p11_index_review.sql`

- [ ] **Step 1: Write the failing test** (the expiry-scan index must exist and be used)

```sql
-- supabase/tests/p11_index_review.sql
DO $$
DECLARE plan text;
BEGIN
  PERFORM 1 FROM pg_indexes WHERE tablename='offers' AND indexname='offers_active_expiry_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'offers_active_expiry_idx missing'; END IF;
  PERFORM 1 FROM pg_indexes WHERE tablename='queue_entries' AND indexname='queue_standby_rank_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_standby_rank_idx missing'; END IF;
  PERFORM 1 FROM pg_indexes WHERE tablename='swipes' AND indexname='swipes_creator_right_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'swipes_creator_right_idx missing'; END IF;
  RAISE NOTICE 'index review OK';
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130200_p11_index_review.sql
-- (a) Expiry job: "active offers due before now()" — partial, ordered by expiry.
create index if not exists offers_active_expiry_idx
  on offers (expires_at) where status = 'active';

-- (b) Auto-roll: "next standby by rank for this instance" — partial on standby.
create index if not exists queue_standby_rank_idx
  on queue_entries (date_instance_id, rank) where status = 'standby';

-- (c) Creator shortlist screen: right-swipers on the creator's nights.
create index if not exists swipes_creator_right_idx
  on swipes (creator_id, date_instance_id) where direction = 'right';

-- (d) Candidate "my queue" reads (status filter common).
create index if not exists queue_candidate_status_idx
  on queue_entries (candidate_id, status);

-- (e) ratee reliability aggregation (P7) reads many rows per ratee.
create index if not exists match_ratings_ratee_submitted_idx
  on match_ratings (ratee_id, submitted_at);
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130200_p11_index_review.sql supabase/tests/p11_index_review.sql
git commit -m "P11: index review — partial/covering indexes for expiry, auto-roll, shortlist, queue, ratings

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Presence-backed bucketed demand-hint (fan-out)

Spec §7.2: show a **bucketed** demand hint ("a few people are interested") weighted to **trusted, currently-available** users, capped. This task adds a `demand_hint` view that buckets the *capped* count of right-swipers per instance, and a reusable `bucket_demand()` function so the value is computed once and the same way for both the candidate-facing API and analytics. Presence (who is "currently available") is supplied as a parameter set the P5/Realtime layer passes in; P11 owns the bucketing rule and the cap.

**Files:**
- Create: `supabase/migrations/20260525130300_p11_presence_demand_hint.sql`
- Create: `supabase/tests/p11_presence_demand_hint.sql`

- [ ] **Step 1: Write the failing test** (bucketing thresholds + cap)

```sql
-- supabase/tests/p11_presence_demand_hint.sql
DO $$
BEGIN
  PERFORM 1 FROM pg_proc WHERE proname='bucket_demand';
  IF NOT FOUND THEN RAISE EXCEPTION 'bucket_demand() missing'; END IF;
  IF bucket_demand(0)  <> 'none'   THEN RAISE EXCEPTION 'bucket 0 wrong: %', bucket_demand(0); END IF;
  IF bucket_demand(2)  <> 'a_few'  THEN RAISE EXCEPTION 'bucket 2 wrong: %', bucket_demand(2); END IF;
  IF bucket_demand(7)  <> 'several' THEN RAISE EXCEPTION 'bucket 7 wrong: %', bucket_demand(7); END IF;
  IF bucket_demand(50) <> 'many'   THEN RAISE EXCEPTION 'bucket 50 wrong: %', bucket_demand(50); END IF;
  -- The view must never expose a raw count column (de-risk per §7.2).
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='demand_hint' AND column_name='raw_count';
  IF FOUND THEN RAISE EXCEPTION 'LEAK: demand_hint exposes raw_count'; END IF;
  RAISE NOTICE 'demand hint OK';
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130300_p11_presence_demand_hint.sql
-- Bucketed social-proof signal (spec §7.2): honest, never an exact N, capped.
create or replace function bucket_demand(n int) returns text
language sql immutable as $fn$
  select case
    when n <= 0  then 'none'
    when n <= 3  then 'a_few'
    when n <= 10 then 'several'
    else 'many'
  end;
$fn$;

-- Per-instance hint. Counts only right-swipes, capped at 50 (the queue cap is enforced
-- elsewhere; this caps the *signal* so a swipe-farm can't inflate it). Presence/trust
-- weighting is applied by the P5 read layer passing a filtered swiper set; the structural
-- guarantee here is: bucket only, no raw count leaves the DB.
create or replace view demand_hint
with (security_invoker = true) as
select
  s.date_instance_id,
  bucket_demand(least(count(*) filter (where s.direction='right')::int, 50)) as demand_bucket
from swipes s
group by s.date_instance_id;

grant select on demand_hint to authenticated;
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130300_p11_presence_demand_hint.sql supabase/tests/p11_presence_demand_hint.sql
git commit -m "P11: bucketed demand-hint view + bucket_demand() — capped, no raw-count leak (spec §7.2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Notification batching / coalescing (anti-storm scale)

P2 owns push + rate limiting; P11 owns the **scale** primitive that prevents a fan-out storm: a coalescing helper so N rapid transitions to one recipient become one digest row. Since P2's `notifications` table may not be merged yet, P11 ships a self-contained `notification_batches` table + a `coalesce_notification()` function that the P2 sender calls; if the same (recipient, kind) is pending-unsent within a debounce window, it merges instead of inserting a new row.

**Files:**
- Create: `supabase/migrations/20260525130400_p11_notification_batching.sql`
- Create: `supabase/tests/p11_notification_batching.sql`

- [ ] **Step 1: Write the failing test** (second event within window coalesces)

```sql
-- supabase/tests/p11_notification_batching.sql
DO $$
DECLARE u uuid; n int;
BEGIN
  insert into profiles (id, first_name) values (gen_random_uuid(),'n') returning id into u;
  PERFORM coalesce_notification(u, 'standby_update', '{"a":1}'::jsonb, interval '5 minutes');
  PERFORM coalesce_notification(u, 'standby_update', '{"a":2}'::jsonb, interval '5 minutes');
  select count(*) into n from notification_batches
   where recipient_id=u and kind='standby_update' and sent_at is null;
  IF n <> 1 THEN RAISE EXCEPTION 'expected 1 coalesced batch, got %', n; END IF;
  -- merged payload should carry a count of 2
  PERFORM 1 FROM notification_batches
    WHERE recipient_id=u AND kind='standby_update' AND (payload->>'event_count')::int = 2;
  IF NOT FOUND THEN RAISE EXCEPTION 'coalesced batch did not increment event_count'; END IF;
  RAISE NOTICE 'notification batching OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/20260525130400_p11_notification_batching.sql
-- Coalesces rapid same-kind notifications to one recipient into a single unsent batch
-- within a debounce window (anti notification-storm; P2's sender drains sent_at IS NULL).
create table if not exists notification_batches (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  first_event_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notification_batches_pending_idx
  on notification_batches (recipient_id, kind) where sent_at is null;

create or replace function coalesce_notification(
  p_recipient uuid, p_kind text, p_payload jsonb, p_window interval
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare existing uuid;
begin
  select id into existing from notification_batches
   where recipient_id=p_recipient and kind=p_kind and sent_at is null
     and last_event_at > now() - p_window
   order by last_event_at desc limit 1
   for update;
  if existing is null then
    insert into notification_batches(recipient_id, kind, payload)
    values (p_recipient, p_kind, p_payload || jsonb_build_object('event_count', 1))
    returning id into existing;
  else
    update notification_batches
       set last_event_at = now(),
           payload = p_payload
             || jsonb_build_object('event_count', coalesce((payload->>'event_count')::int,1) + 1)
     where id = existing;
  end if;
  return existing;
end $fn$;

alter table notification_batches enable row level security;  -- service-role only; no policies.
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525130400_p11_notification_batching.sql supabase/tests/p11_notification_batching.sql
git commit -m "P11: notification batching — coalesce_notification() debounce window (anti-storm scale)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Full verification — all P11 tests + type regen

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated — now includes `analytics_events`, `feature_config`, `notification_batches`, `demand_hint`)

- [ ] **Step 1: DB reset (applies every P0 + P11 migration)**

Run: `supabase db reset`
Expected: completes with no error; all migrations apply in order.

- [ ] **Step 2: Run all P11 psql tests**

Run:
```bash
for f in supabase/tests/p11_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`.

- [ ] **Step 3: Run all web/package TS tests**

Run: `pnpm --filter @after5/web test && pnpm --filter @after5/api-client test`
Expected: all suites pass.

- [ ] **Step 4: Regenerate types**

Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` gains `analytics_events`, `feature_config`, `notification_batches`, `demand_hint`.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P11: regenerate database types for analytics/flags/batching/demand-hint additions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (vs roadmap P11 'Closes' list):**
- Missing loading/error/empty states → Task 2 (`AsyncBoundary` + `LoadState`), Task 3 (`useAsyncAction` for mutations), Task 4 (`LoopActionButton` for the riskiest accept/lock flows). Consistent pattern + concrete riskiest-flow examples. ✅
- Accessibility — non-audio ambient equivalent → Task 6 (caption is canonical channel). ✅
- Accessibility — accessible swipe alternative → Task 7 (`SwipeDeck` Pass/Interested buttons, keyboard + SR). ✅
- Accessibility — accessible offer countdown → Task 8 (`OfferCountdown`, `role=timer` + `aria-live=polite`). ✅
- Accessibility — pink-on-dark contrast → Task 5 (WCAG-AA-verified `feed.*` tokens). ✅
- Accessibility — screen-reader feed semantics → Task 9 (`feed-a11y` labels from blind fields only + ARIA `feed` role). ✅
- Mobile responsiveness + native-push reliance → loop primitives are responsive Tailwind; ambient (Task 6) gesture-gates per iOS-Safari §10; push dependency is explicitly delegated to P2, with P11 owning the **batching** scale primitive (Task 17) the P2 sender consumes. ✅
- Analytics — event for every state transition → Task 10 (taxonomy enumerating §7.1/§13 transitions + `analytics_events` outbox trigger for server-authoritative transitions), Task 11 (client `track.loop`), Task 13 (relay to PostHog). ✅
- Experimentation / flag to tune offer window → Task 12 (PostHog flag + `feature_config` DB fallback readable by jobs). ✅
- Scalability — index review → Task 15. Presence fan-out for demand hint → Task 16. Notification batching → Task 17. ✅
- Timezone / DST for `scheduled_for` + offer expiry → Task 14 (display + DST-safe expiry, shared client+DB rule). ✅

**Builds on P0 (no re-invention):** consumes `offers`, `locks`, `queue_entries`, `swipes`, `date_instances`, `match_ratings`, `cities.timezone`, `browse_feed`, and the `set_updated_at()` trigger. Analytics outbox trigger is a sibling of P0's `log_status_transition()` (different table, same status-distinct pattern), so the two coexist without conflict. No P0 migration is edited; all P11 migrations are additive.

**Integration points referenced but not edited (host phase wires them in one line):** P4 feed screen consumes `SwipeDeck`/`AmbientSound`/`feed-a11y`/`AsyncBoundary`; P5 offer/lock RPCs call `offer_expires_at()` + emit via the outbox; P5 candidate API reads `demand_hint`; P2 jobs call `drainAnalyticsEvents()` (every minute) and the P2 sender drains `notification_batches` / calls `coalesce_notification()`. Each is named by its P0/contract symbol, not by an unbuilt file path.

**Decisions:**
- **Analytics tool: PostHog** (already a dependency and wired in `PostHogProvider.tsx`). Dual-path (client `track.loop` + server `analytics_events` outbox → `posthog-node` relay) because the most important transitions fire in the DB/jobs, not the browser — a browser-only approach would silently drop them.
- **Flagging approach: PostHog feature flags as the experiment-assignment layer, `feature_config` as the source-of-truth fallback** the offer-expiry job/RPC reads (browser SDK is unavailable server-side). The window value is clamped to a safe 12–72h range in both layers.
- **Dark feed theme is a separate token set** (`feed.*`) from the cream marketing palette; contrast is a test, not a guideline, so it can't regress.

**Placeholder scan:** none — every step has runnable code/SQL and exact commands. The two `@ts-expect-error` lines are intentional negative tests, not placeholders.

**Test-harness note:** the repo had no JS test runner; Task 1 bootstraps Vitest + RTL before any component task, and Task 13 adds a minimal sibling runner to `packages/api-client`. psql tests follow P0's `DO $$ … RAISE EXCEPTION … END $$;` convention exactly.

**Risk note:** `demand_hint`/`browse_feed` use `security_invoker=true` views — RLS on the underlying `swipes` already restricts visibility, so the bucketed view cannot leak more than the caller may already read; the view's job is to ensure only the *bucket* (never a raw N) is selectable, which the test asserts structurally.

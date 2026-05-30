SUBORDINATE EXECUTION SLICE. This plan is not authoritative by itself. It must be implemented only through INTEGRATION-CONTRACT.md v2 and RECONCILED-MASTER-PLAN.md. If this file conflicts with either, this file loses.

# P11 — Cross-Cutting Polish: States, A11y, Mobile, Analytics, Scale — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Write only what each step specifies — no placeholders, no speculative code.**

> **AUTHORITY & POSITION.** P11 maps to **Stage S12 (Polish & finalization)** of `RECONCILED-MASTER-PLAN.md` §8. The governing source of truth is `INTEGRATION-CONTRACT.md` v2 (incl. C11). This plan is the subordinate execution slice for S12. **Depends on: S1–S11 (woven through them); P11 finalizes last.** Every shared object this plan touches is owned and frozen by the contract — P11 references canonical definitions, never recreates them.

**Goal:** Make the experience-first dating loop production-grade along the five cross-cutting axes the audit flagged: (1) consistent LOADING / ERROR / EMPTY states **wired into the real S5/S6/S7 screens**, (2) ACCESSIBILITY (non-audio caption wired into P4's `AmbientPlayer`, button-equivalent swipe wired into P4's `SwipeDeck`, `aria-live` offer countdown on the lock screen, pink-on-dark contrast, screen-reader feed semantics on the real `browse_feed` columns), (3) MOBILE responsiveness (leaning on the C1 native-push backbone), (4) ANALYTICS — the `analytics_relay` job + handler that drains `analytics_events` (C11.8) to PostHog with 30d retention, verifying all 15 transition events emit (P5/P2 emit; P11 relays), and (5) SCALABILITY — index review, demand-hint via the canonical `match_demand_hint` (C2), `dispatch_notification` anti-storm (C1), and timezone/DST correctness for offer expiry via `offer_expires_at()` (C11.1).

**Architecture:** P11 is *woven through* S1–S11, so it **does not invent loop tables or RPCs** — it builds the thin, reusable layers that wrap them, and wires them into the **already-shipped host screens** (P4 feed, the S6 lock/offer screen, P6 chat). State handling and a11y live in **shared React primitives** in `apps/web/components/loop/` that are then **imported by explicit host-screen edit tasks in this plan** (no orphans). Analytics is **server-authoritative**: P5 SECURITY DEFINER functions and P2 jobs emit all 15 transition events into the **`analytics_events` outbox table created in S2 (P2 band `123900`, C11.8)**; P11 owns the **`analytics_relay` job type (C1) + its `process-jobs` handler** that drains the outbox to PostHog via `posthog-node`, plus **30-day retention**. The tunable offer window reads `feature_config` via **`offer_expires_at()` (C11.1, owned by P2 band `123800`)** — P5 already calls it; P11 owns the flag config UI/value only, not a parallel system. Timezone/DST: every instant is `timestamptz`; display resolves against `cities.timezone` via a shared `formatInZone` utility; expiry math is owned by `offer_expires_at()`.

**Tech Stack:** Next.js 15 (App Router, React 19) + Tailwind (existing cream palette + a new dark feed theme), `posthog-js` (already a dep) + `posthog-node` (added here, for the server relay), Supabase Postgres migrations (`supabase/migrations/`), psql invariant tests (`supabase/tests/`, P0 pattern). **vitest is owned by P1's single root config (C10/C12) — P11 does NOT bootstrap a runner; it assumes `pnpm test` and adds `*.test.ts(x)` files only.**

**Source docs:** **AUTHORITY** `docs/superpowers/plans/2026-05-25-INTEGRATION-CONTRACT.md` (v2, incl. C11) and `docs/superpowers/plans/2026-05-25-RECONCILED-MASTER-PLAN.md` (S12); spec `docs/superpowers/specs/2026-05-25-experience-first-dating-core-loop-design.md` (§5 browse, §7 lifecycle, §10 mobile, §13 analytics); data model `docs/superpowers/plans/2026-05-25-p0-data-model.md`.

**Dependency note (woven phase):** P11 = S12, finalized last. **All S1–S11 shared objects already exist when P11 runs** (jobs/enum/runner C1, `analytics_events`+`feature_config`+`offer_expires_at()`+`dispatch_notification` S2, P4 feed screen + `SwipeDeck`/`AmbientPlayer`, the S6 match API + lock/offer screen, P6 chat). P11 therefore **wires into real merged files** — every primitive has an explicit host-screen consumer task below. No "builds the primitive, host wires later" deferral (there is no later phase); no "assume exists" placeholders.

**Conventions (follow exactly):**
- DB: migration filenames `YYYYMMDDHHMMSS_p11_snake_description.sql` in **band `132000–1329xx`** (C6/C11), except the **`browse_feed` finalization migration at band `133000`** (C11.3, the single feed-finalization slot). Enable RLS on every new table; idempotent policies via `DO $$ BEGIN CREATE POLICY … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`; reuse P0's `set_updated_at()` trigger; `timestamptz` for all instants; psql tests as `DO $$ … RAISE EXCEPTION on failure … END $$;` blocks (clean exit = PASS); all psql test fixtures use **`mk_user`/`mk_itinerary`/`mk_instance` (C8)** — never bare inserts into `profiles`/`itineraries`.
- TS/React: shared primitives in `apps/web/components/loop/`; one component per file; named exports; Tailwind classes only (no inline color hex except in the documented dark-theme token file); analytics event names are `snake_case` and centralized in one taxonomy module — never call `posthog.capture` ad hoc.
- Tests: `*.test.ts(x)` colocated next to source; run with `pnpm test` (P1's root vitest workspace config, C12). Each task is failing test → FAIL → real code → PASS → commit.

**Local test loop:**
- React/TS: `pnpm --filter @after5/web test` (Vitest, jsdom).
- DB: `supabase db reset` then `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f <test.sql>`.

---

## File Structure

```
apps/web/
  # NO vitest bootstrap — P1 owns the single root vitest.config.ts (C10/C12). P11 adds *.test.* files only.
  components/loop/
    AsyncBoundary.tsx                       # Task 2 — loading/error/empty wrapper
    AsyncBoundary.test.tsx
    useAsyncAction.ts                       # Task 3 — idle/pending/error state hook for mutations
    useAsyncAction.test.ts
    LoopActionButton.tsx                    # Task 4 — button w/ pending spinner + disabled + aria-busy
    LoopActionButton.test.tsx
    states.ts                               # Task 2 — LoadState union + copy map (one source of truth)
    OfferCountdown.tsx                      # Task 8 — aria-live polite countdown (threshold-throttled)
    OfferCountdown.test.tsx
    feed-a11y.ts                            # Task 9 — SR feed semantics from canonical browse_feed columns
    feed-a11y.test.ts
  app/
    loop-analytics.ts                       # Task 10 — event taxonomy (single source) + types
    loop-analytics.test.ts
  components/feed/
    SwipeDeck.tsx                           # EDIT (Task 7) — wire a11y Pass/Interested buttons into P4's deck
    AmbientPlayer.tsx                       # EDIT (Task 6) — wire caption non-audio equivalent into P4's player
    BrowseFeed.tsx                          # EDIT (Task 9b) — wire AsyncBoundary + feed-a11y into P4's feed
  app/(loop)/lock/[offerId]/page.tsx        # EDIT (Task 4b) — wire OfferCountdown + LoopActionButton into S6 lock screen
  app/(loop)/chat/[threadId]/page.tsx       # EDIT (Task 4c) — wire AsyncBoundary empty/loading into P6 chat thread
  lib/
    timezone.ts                             # Task 14 — formatInZone display helper (DST-safe via Intl)
    timezone.test.ts
    feature-flags.ts                        # Task 12 — typed flag reader (PostHog + feature_config fallback)
    feature-flags.test.ts
  styles/
    feed-theme.css                          # Task 5 — dark feed theme tokens (contrast-audited)
  app/globals.css                           # EDIT (Task 5) — import feed-theme tokens
  tailwind.config.ts                        # EDIT (Task 5) — register `feed.*` dark tokens
  lib/contrast.ts                            # Task 5 — WCAG ratio util (token source of truth)
  lib/contrast.test.ts

packages/api-client/src/
  analytics-relay.ts                        # Task 13 — drain analytics_events → posthog-node (service-role + flush)
  analytics-relay.test.ts

supabase/
  functions/process-jobs/                   # EDIT (Task 13b) — add `analytics_relay` handler to C1 runner dispatch
  migrations/
    20260525132000_p11_analytics_relay_job.sql      # Task 13b — add 'analytics_relay' job dispatch wiring + 30d retention helper
    20260525132100_p11_index_review.sql             # Task 15 — missing/covering indexes (aligned to S6 ordering)
    20260525133000_p11_browse_feed_finalize.sql      # Task 18b — browse_feed FINALIZATION (C11.3 drop+create, band 133000)
  tests/
    p11_analytics_relay_job.sql
    p11_analytics_events_coverage.sql        # Task 10 — verifies all 15 transition events have an emit source
    p11_index_review.sql
    p11_browse_feed_finalize.sql
    p11_feature_config.sql                   # Task 12 — asserts the C11.1 seed/range (read-only check; table owned by P2)
```

> **REMOVED vs the original draft (now SUPERSEDED — do not build):**
> - `vitest.config.ts`/`vitest.setup.ts`/Task 1 harness → **P1 owns the root config (C10/C12).** P11 deletes any duplicate setup and assumes `pnpm test`.
> - `20260525130000_p11_analytics_events.sql` (outbox table + trigger) → **`analytics_events` is created in S2 (P2 band `123900`, C11.8).** P11 does NOT create it; P11 owns the relay job/handler/retention only. Server emission of all 15 events is done by P5 RPCs / P2 jobs (C2/C8) — P11 verifies coverage, it does not own a competing trigger.
> - `20260525130100_p11_feature_config.sql` (table) → **`feature_config` + `offer_expires_at()` are owned by P2 (C11.1, bands `123800`).** P11 ships only the flag-reader UI/value; no parallel table.
> - `20260525130300_p11_presence_demand_hint.sql` + `bucket_demand()`/`demand_hint` view → **DELETED (CV7/DS2).** The only demand hint is **`match_demand_hint(p_instance)` (C2, owned by P5)**. P11 must not ship a duplicate.
> - `20260525130400_p11_notification_batching.sql` + `notification_batches`/`coalesce_notification()` → **DELETED (DS1).** The only anti-storm system is **`dispatch_notification` (C1, owned by P2)** with its consent→quiet-hours→rate-limit chain. P11 must not ship a parallel batching table.
> - `20260525130500_p11_offer_expiry_tz.sql` + a P11 `offer_expires_at(window_start, window_hours)` → **DELETED (CV8/C11.1).** `offer_expires_at(p_from default now())` reading `feature_config` is owned by P2; P5's `match_make_offer` already calls it. P11 keeps only the TS `formatInZone` display helper.
> - Band `130xxx` timestamps → **WRONG (collides with P9, C6).** P11's band is `132000–1329xx`; the feed finalization is `133000` (C11.3).

---

## Task 1: Delete any duplicate vitest setup; assume P1's root config (C10/C12)

**SUPERSEDED — the original "bootstrap a runner" task is removed.** Per **C10/C12 (DS4, CV10)**, **P1 owns the single root `vitest.config.ts`** (workspace globs covering `apps/web` + `packages/*`). P11 (and P3/P6/P8/P10) **delete** their duplicate setups and assume `pnpm test`. Since P11 is finalized last, the root config already exists.

**Files:**
- Delete (if present): any `apps/web/vitest.config.ts`/`vitest.setup.ts` that P11 added in a prior pass.
- Verify: P1's root vitest workspace globs already cover `apps/web/components/**`, `apps/web/app/**`, `apps/web/lib/**`, and `packages/api-client/**` so this plan's `*.test.*` files run under `pnpm test`.

- [ ] **Step 1: Confirm the root config exists and covers P11's paths**

Run: `pnpm test -- --reporter=verbose` (P1's root vitest). Expected: it discovers and runs existing tests across the workspace. If `apps/web/lib/**` or `packages/api-client/**` are not in P1's workspace globs, **do not add a new config** — note the gap and have it folded into P1's root config (single source, C12).

- [ ] **Step 2: Remove any P11-authored duplicate runner**

If a previous pass created `apps/web/vitest.config.ts`/`vitest.setup.ts`, delete them. The posthog-js mock the suites rely on belongs in P1's root `vitest.setup.ts` — reference it there, do not fork it.

- [ ] **Step 3: Commit (only if files were removed)**

```bash
git rm -f apps/web/vitest.config.ts apps/web/vitest.setup.ts 2>/dev/null || true
git commit -m "P11: drop duplicate vitest setup — use P1 root workspace config (C12)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Depends on: **P1** (root vitest config, C12). All subsequent TS/React tasks run under `pnpm test`.

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

// Distinct, actionable copy per P5/C2 exception code (single source — never inline at a
// call site). Codes are owned by the S6 match-API plan; P11 maps them to copy.
export const errorCopy: Record<string, string> = {
  OFFER_EXPIRED: 'This offer has expired. Browse for another night.',
  OFFER_TAKEN: 'Someone else locked this night first.',
  RANK_FROZEN: 'This shortlist is being resolved — try again in a moment.',
  NOT_SHORTLISTED: "You're no longer shortlisted for this night.",
  LOCK_FLOW_BLOCKED: "Your account can't start a new date right now.",
};

export function copyForError(err: Error | null): string {
  if (err && err.message in errorCopy) return errorCopy[err.message];
  return loopCopy.genericError;
}
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

The button used by offer-accept and lock-confirm (the two highest-stakes, irreversible flows). Disables + sets `aria-busy` while pending, shows a spinner, and renders a **distinct, actionable error** per P5 SQL exception code (not a single generic string). **This component is wired into the real S6 lock/offer screen in Task 4b — it is not an orphan.** The two terminal flows it serves call the **C2 RPCs `match_accept_offer`/`match_make_offer`** (never ad-hoc names); the success path emits its analytics event via the server outbox, so the button itself only needs to surface state.

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

  it('maps a known P5 exception code to actionable copy', async () => {
    const action = vi.fn().mockRejectedValue(new Error('OFFER_EXPIRED'));
    render(<LoopActionButton action={action}>Accept offer</LoopActionButton>);
    await userEvent.click(screen.getByRole('button', { name: /accept offer/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/offer has expired/i));
  });

  it('falls back to generic copy for an unknown error', async () => {
    const action = vi.fn().mockRejectedValue(new Error('kaboom'));
    render(<LoopActionButton action={action}>Confirm lock</LoopActionButton>);
    await userEvent.click(screen.getByRole('button', { name: /confirm lock/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i));
  });
});
```

> The error codes mapped here are the P5/C2 exceptions (`OFFER_EXPIRED`, `OFFER_TAKEN`, `RANK_FROZEN`, `NOT_SHORTLISTED`, `LOCK_FLOW_BLOCKED`). The canonical set lives in S6's match-API plan; P11 reads them, it does not invent them. Add unmapped codes to `states.ts`'s `errorCopy` map (single source) — never inline a string per call site.

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code**

```tsx
// apps/web/components/loop/LoopActionButton.tsx
'use client';
import type { ReactNode } from 'react';
import { useAsyncAction } from './useAsyncAction';
import { copyForError } from './states';

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
        <p role="alert" className="mt-2 text-sm text-accent">{copyForError(error)}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/LoopActionButton.tsx apps/web/components/loop/LoopActionButton.test.tsx
git commit -m "P11: LoopActionButton — accessible pending/disabled/aria-busy control + P5 error mapping

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4b: WIRE `OfferCountdown` + `LoopActionButton` into the real S6 lock/offer screen (no orphan)

**ORPHAN FIX (audit §1, §5; contract C11 "no orphans").** `OfferCountdown` and `LoopActionButton` are useless unless mounted on a real screen. The offer/lock surface is built in **S6 (the matching loop)** — it owns the route `apps/web/app/(loop)/lock/[offerId]/page.tsx` (the candidate's accept-offer / confirm-lock screen). P11 **edits that real, already-merged screen** to render the primitives. **Depends on: S6 (lock/offer screen + the C2 RPCs `match_accept_offer`/`match_make_offer`).**

> If the S6 screen does not exist when this task runs, **stop and resolve ownership against S6** — do NOT build a parallel offer screen here (that would be a new surface P11 doesn't own). The contract reconciliation places the offer/lock UI in S6; P11 only wires polish into it.

**Files:**
- Modify: `apps/web/app/(loop)/lock/[offerId]/page.tsx` (S6's screen)

- [ ] **Step 1: Add a failing integration test on the host screen** asserting the lock screen renders `role="timer"` (the countdown) and the accept control with `aria-busy` wiring, and that confirming calls the S6 `match_accept_offer` action.

- [ ] **Step 2: Run it, expect FAIL** (screen does not yet import the primitives).

- [ ] **Step 3: Edit the S6 screen** to:
  - render `<OfferCountdown expiresAt={offer.expires_at} onExpire={…} />` for the active offer window (the `expires_at` is set server-side by `offer_expires_at()`, C11.1 — the screen only displays it),
  - render `<LoopActionButton action={() => acceptOffer(offerId)}>Confirm lock</LoopActionButton>` where `acceptOffer` calls the C2 RPC `match_accept_offer(auth.uid(), offerId, idemKey)`,
  - wrap the offer-detail fetch in `<AsyncBoundary state={…} empty={loopCopy.offersEmpty}>`.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(loop)/lock/[offerId]/page.tsx"
git commit -m "P11: wire OfferCountdown + LoopActionButton into the S6 lock/offer screen (de-orphan)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4c: WIRE `AsyncBoundary` empty/loading into the real P6 chat thread (no orphan)

**ORPHAN FIX.** P6 (S7 chat) builds the chat thread screen but defers loading/empty states to P11. P11 **edits P6's real thread screen** to use `AsyncBoundary` + `loopCopy.chatEmpty`. **Depends on: S7 (P6 chat thread screen + C9 chat-core hooks).**

**Files:**
- Modify: `apps/web/app/(loop)/chat/[threadId]/page.tsx` (P6's screen)

- [ ] **Step 1: Failing test** — the chat thread screen shows `loopCopy.chatEmpty` when the message list is empty and a labelled spinner while loading.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Edit P6's thread screen** to wrap the message-list fetch in `<AsyncBoundary state={…} empty={<p>{loopCopy.chatEmpty}</p>} onRetry={…}>`. Chat opens only once an offer thread exists (C9 `open_chat_thread`); the empty copy is kind-by-design.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(loop)/chat/[threadId]/page.tsx"
git commit -m "P11: wire AsyncBoundary loading/empty states into the P6 chat thread (de-orphan)

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

  // Guard against the tested source (lib/contrast.ts) drifting from the CSS/Tailwind copies.
  it('CSS + Tailwind token copies match FEED_TOKENS (no silent drift)', async () => {
    const css = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../styles/feed-theme.css', import.meta.url), 'utf8'));
    for (const hex of Object.values(FEED_TOKENS)) {
      expect(css.toLowerCase()).toContain(hex.toLowerCase());
    }
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

## Task 6: WIRE a caption non-audio equivalent INTO P4's `AmbientPlayer` (no duplicate component)

**ORPHAN/DUP FIX (audit §1; DS6).** P4 already ships `apps/web/components/feed/AmbientPlayer.tsx` ("native-first audio w/ explicit web fallback") and the real feed renders it. P11 must **NOT** build a second `components/loop/AmbientSound`. Instead, P11 **edits P4's existing `AmbientPlayer`** to add the deaf/HoH **caption equivalent** the audit demanded and the gesture-gated/muted-by-default web fallback (spec §10 iOS Safari). **Depends on: P4 (`AmbientPlayer.tsx`, the sounds library + signed-URL serving from S4).**

**Files:**
- Modify: `apps/web/components/feed/AmbientPlayer.tsx` (P4's component)

- [ ] **Step 1: Add failing tests to P4's component test**

```tsx
// in apps/web/components/feed/AmbientPlayer.test.tsx (P4's test file — extend it)
it('renders a text caption equivalent for the sound (a11y, no audio required)', () => {
  render(<AmbientPlayer src="/s/jazz.mp3" caption="Low jazz, clinking glasses" />);
  expect(screen.getByText(/low jazz, clinking glasses/i)).toBeInTheDocument();
});
it('does not autoplay with sound on web (muted by default, gesture-gated)', () => {
  render(<AmbientPlayer src="/s/jazz.mp3" caption="x" />);
  const audio = screen.getByTestId('ambient-audio') as HTMLAudioElement;
  expect(audio.autoplay).toBe(false);
  expect(audio.muted).toBe(true);
  expect(audio).toHaveAttribute('preload', 'none');
});
it('surfaces feedback when the iOS gesture policy rejects playback', async () => {
  // un-muting a not-yet-loaded source can reject on iOS Safari; the user must see it, not a silent no-op.
  // (assert the rejected-play UX, e.g. an "tap to enable sound" hint)
});
```

- [ ] **Step 2: Run, expect FAIL** (P4's player lacks the caption + muted/gesture contract).

- [ ] **Step 3: Edit P4's `AmbientPlayer`** to:
  - accept and always render a visible `caption` (the canonical channel for deaf/HoH + muted web),
  - set `muted` + `preload="none"` and only un-mute on an explicit user gesture,
  - on a play rejection (iOS gesture policy) show a small "tap to enable sound" hint instead of swallowing the error,
  - keep a labelled play/pause toggle (`aria-label`), `data-testid="ambient-audio"` on the `<audio>`.

  The `src` is the **signed-URL minted by S4's media pipeline**; the `caption` comes from the sounds library row (S4). P11 does not own serving — it consumes the S4 URL.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/feed/AmbientPlayer.tsx apps/web/components/feed/AmbientPlayer.test.tsx
git commit -m "P11: add caption non-audio equivalent + gesture-gated fallback to P4 AmbientPlayer (a11y; no dup)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: WIRE accessible Pass/Interested buttons INTO P4's `SwipeDeck` (no duplicate component)

**ORPHAN/DUP FIX (audit §1; DS6).** P4 already ships `apps/web/components/feed/SwipeDeck.tsx` (the real feed deck that POSTs to `/api/feed/swipe`). P11 must **NOT** build a second `components/loop/SwipeDeck`. Instead, P11 **edits P4's existing `SwipeDeck`** to add the keyboard- + screen-reader-operable **Pass / Interested buttons** (the a11y-complete path), an `aria-live` result announcement (threshold-quiet, not spammy), and the SR group label — firing the **same `/api/feed/swipe` action** the gesture uses. **Depends on: P4 (`SwipeDeck.tsx` + `/api/feed/swipe`).**

**Files:**
- Modify: `apps/web/components/feed/SwipeDeck.tsx` (P4's component)

- [ ] **Step 1: Add failing tests to P4's component test**

```tsx
// in apps/web/components/feed/SwipeDeck.test.tsx (P4's test file — extend it)
it('fires the same swipe action ("right") from the Interested button', async () => {
  const onSwipe = vi.fn();
  render(<SwipeDeck dateInstanceId="di-1" onSwipe={onSwipe}><p>The night</p></SwipeDeck>);
  await userEvent.click(screen.getByRole('button', { name: /interested/i }));
  expect(onSwipe).toHaveBeenCalledWith('right');
});
it('fires the same swipe action ("left") from the Pass button', async () => {
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
```

- [ ] **Step 2: Run, expect FAIL** (P4's deck has the gesture but no accessible buttons / SR semantics).

- [ ] **Step 3: Edit P4's `SwipeDeck`** to add, alongside the existing gesture:
  - explicit `Pass` / `Interested` buttons that call the **same swipe action** the gesture invokes (P4's `/api/feed/swipe` → idempotent swipe; the swipe write is owned by S5),
  - a `role="group"` with `aria-label="A date night to consider"` wrapping the card (uses the dark `feed.*` tokens from Task 5),
  - an `aria-live="polite"` status region that announces the result (kind-by-design copy), updated only on action (not per-frame).

  The swipe itself stays P4/S5-owned; P11 only adds the accessible alternate controls and SR semantics.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/feed/SwipeDeck.tsx apps/web/components/feed/SwipeDeck.test.tsx
git commit -m "P11: add SR/keyboard Pass+Interested buttons to P4 SwipeDeck (a11y; same swipe action; no dup)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `OfferCountdown` — accessible time-boxed offer timer (threshold-throttled, no SR spam)

The exclusive offer (spec §7.3) is "confirm by [T]." The countdown must be announced to screen readers **without spamming them**. The visible label updates each second, but the **`aria-live` announced value is throttled** to meaningful thresholds (per-minute under 1h, per-hour above) — separating the visible ticker from the announced region so `aria-live` does not fire every second. Remaining time is computed against the absolute `expires_at` (set server-side by `offer_expires_at()`, C11.1). **This component is consumed by the S6 lock screen in Task 4b — not an orphan.**

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

  it('does NOT re-announce the live region every second (throttled to thresholds)', () => {
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    render(<OfferCountdown expiresAt={expires} />);
    const announced = screen.getByRole('timer').textContent;
    act(() => { vi.advanceTimersByTime(3000); }); // 3 ticks
    // above 1h, the announced value changes only per-hour → unchanged after 3s
    expect(screen.getByRole('timer').textContent).toBe(announced);
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
  // The announced label only re-renders when it changes (threshold = whole minute under 1h,
  // whole hour above), so aria-live does NOT fire every second.
  const [label, setLabel] = useState(() => remaining(expiresAt).label);
  const fired = useRef(false);
  const lastLabel = useRef(label);

  useEffect(() => {
    const tick = () => {
      const next = remaining(expiresAt);
      if (next.label !== lastLabel.current) {   // only update on a threshold change
        lastLabel.current = next.label;
        setLabel(next.label);
      }
      if (next.ms <= 0 && !fired.current) { fired.current = true; onExpire?.(); }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [expiresAt, onExpire]);

  return (
    <span role="timer" aria-live="polite" aria-atomic="true" className="font-medium text-feed-accent">
      {label}
    </span>
  );
}
```

> Throttling is real: `remaining()` returns a label at whole-minute granularity (under 1h) / whole-hour granularity (above), so `setLabel` is a no-op on most ticks and the live region announces only at threshold boundaries.

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/loop/OfferCountdown.tsx apps/web/components/loop/OfferCountdown.test.tsx
git commit -m "P11: OfferCountdown — aria-live polite offer-window timer with onExpire callback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Screen-reader feed semantics helpers (canonical `browse_feed` columns)

The blind feed must read coherently to a screen reader: each night is a list item with a composed accessible name ("A Friday evening night in Downtown, 50-50, low jazz") that **never leaks creator identity** (spec §5/§7.2). This pure module composes that label from the **canonical `browse_feed_for_viewer` projection (C4/C11.3)**, so feed markup and tests share one labelling rule.

> **CONTRACT-CORRECT COLUMNS (C4).** The feed row exposes: `date_instance_id, city_id, time_window_start (hour-truncated), itinerary_id, pay_setting, vibe_tags, why_note, sound_title, sound_license, venue_neighborhood, is_seed` (+ `distance_m` from the RPC). There is **no `timezone` column on the feed row** — display zone comes from `cities.timezone` resolved via `city_id`; the helper takes `timeZone` as an explicit argument the caller supplies from that lookup. `pay_setting` enum values follow the canonical P10 labels (CC5).

**Files:**
- Create: `apps/web/components/loop/feed-a11y.ts`
- Create: `apps/web/components/loop/feed-a11y.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/components/loop/feed-a11y.test.ts
import { describe, it, expect } from 'vitest';
import { feedItemLabel, FEED_LIST_ROLE } from './feed-a11y';

describe('feed-a11y', () => {
  it('composes a label from canonical browse_feed columns only (no identity)', () => {
    const label = feedItemLabel(
      {
        date_instance_id: 'di-1',
        city_id: 'c-1',
        time_window_start: '2026-06-05T19:00:00Z',
        venue_neighborhood: 'Downtown',
        pay_setting: 'split',
        vibe_tags: ['cozy', 'live music'],
      },
      'America/Vancouver', // timeZone resolved from cities.timezone via city_id (not a feed column)
    );
    expect(label).toMatch(/Downtown/);
    expect(label).toMatch(/cozy/);
    expect(label).toMatch(/split the bill|50-?50/i);
  });

  it('never references a creator name or id (structurally absent from browse_feed)', () => {
    const label = feedItemLabel(
      {
        date_instance_id: 'di-2',
        city_id: 'c-1',
        time_window_start: '2026-06-05T19:00:00Z',
        venue_neighborhood: 'Pandosy',
        pay_setting: 'i_pay',
        vibe_tags: [],
        // @ts-expect-error — proving creator fields are not consumed even if present
        creator_id: 'should-be-ignored', creator_name: 'Alex',
      },
      'America/Vancouver',
    );
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

// Canonical browse_feed_for_viewer projection (C4/C11.3) — identity-stripped.
// NOTE: there is NO `timezone` column on the feed row; the city zone is resolved
// from cities.timezone via city_id and passed to feedItemLabel as an argument.
export type FeedItem = {
  date_instance_id: string;
  city_id: string;
  time_window_start: string;        // ISO; hour-truncated per browse_feed
  venue_neighborhood: string | null;
  pay_setting: 'i_pay' | 'they_pay' | 'split' | null;
  vibe_tags: string[];
};

// Pay labels are the canonical P10 set (CC5) — applied consistently on every surface.
const PAY_COPY: Record<NonNullable<FeedItem['pay_setting']>, string> = {
  i_pay: 'they treat',
  they_pay: 'you treat',
  split: '50-50, split the bill',
};

// Consumes ONLY blind feed columns — creator identity is structurally absent (browse_feed).
export function feedItemLabel(item: FeedItem, timeZone: string): string {
  const when = formatInZone(item.time_window_start, timeZone, { weekday: 'long', hour: 'numeric' });
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
git commit -m "P11: feed-a11y — SR-safe feed item labels (canonical browse_feed columns) + ARIA feed role

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9b: WIRE `AsyncBoundary` + `feed-a11y` + the canonical empty state INTO P4's `BrowseFeed` (no orphan)

**ORPHAN FIX (audit §1, §6).** The "consistent states on every loop screen" claim is empty unless a screen adopts `AsyncBoundary`. P4 ships the feed screen with its own `EmptyFeedState`. P11 **edits P4's real feed component** to wrap the `browse_feed_for_viewer` fetch in `AsyncBoundary` (loading/error/empty/ready) and to apply `feedItemLabel(...)` (with `cities.timezone` resolved via `city_id`) and the ARIA `feed` role to the list. Reuse P4's existing `EmptyFeedState` as the `empty` slot (do not introduce a second empty component). **Depends on: P4 (`BrowseFeed.tsx`, `browse_feed_for_viewer` RPC — finalized by Task 18b).**

**Files:**
- Modify: `apps/web/components/feed/BrowseFeed.tsx` (P4's component)

- [ ] **Step 1: Failing test** — the feed renders a labelled spinner while loading, P4's `EmptyFeedState` when `browse_feed_for_viewer` returns no rows, an alert + retry on error, and the list carries `role="feed"` with each item labelled by `feedItemLabel`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Edit P4's `BrowseFeed`** to wrap the fetch in `<AsyncBoundary state={…} label="nights" empty={<EmptyFeedState/>} onRetry={…}>`, set `role={FEED_LIST_ROLE}` on the list container, and set each card's accessible name from `feedItemLabel(row, cityTimezoneFor(row.city_id))`. The feed read continues through P4's `browse_feed_for_viewer` RPC (C4) — P11 adds no second data source.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/components/feed/BrowseFeed.tsx
git commit -m "P11: wire AsyncBoundary + feed-a11y + ARIA feed role into P4 BrowseFeed (de-orphan states/a11y)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Loop analytics taxonomy + transition-event coverage verification (`analytics_events` owned by S2)

Spec §13 demands an event for **every** lifecycle transition (15 of them). **The `analytics_events` outbox TABLE is owned and created in S2 (P2 band `123900`, C11.8) — P11 does NOT create it and ships no competing trigger.** Per the contract, **P5/P2 EMIT** every transition event into `analytics_events` from their own SECURITY DEFINER functions / jobs (C2 line 82: "Every transition emits its analytics event into `analytics_events`"); **P11 VERIFIES coverage and RELAYS** (Task 13). This task ships:
1. **Client taxonomy** (`loop-analytics.ts`): one typed map of all 15 event names + payload shape (the shared vocabulary; client-only transitions like `feed_empty_shown` go through `track.loop`, Task 11).
2. **A coverage-verification psql test** proving the **7 previously lost/mislabeled events are emitted by the right S6/S2 source with the correct distinct name** — fixing the audit §3 gaps. P11 owns the *assertion*, not the emit code; if a coverage check fails, the fix lands in the **owning S6/S2 plan** (P11 flags it, the contract makes S6/S2 emit it).

> **The 7 events the audit found lost/mislabeled — coverage requirements P11 verifies (fixed in S6/S2 per C2):**
> - `swipe_right` / `swipe_left` — emitted at the swipe write (S5). Client `track.loop` is the primary path; server path optional.
> - `rank_changed` — emitted by S6 `match_shortlist` rank change (NOT a `status` change — needs an explicit emit, not a status-trigger). Must be its own event, never folded into `offer_*`.
> - `withdraw` — emitted **distinctly** by S6 `match_withdraw` / `match_autowithdraw_user_conflicts`; MUST NOT be mislabeled as `offer_passed`/`offer_expired`. (Audit §3 "WRONG LABEL + LOST".)
> - `reciprocal_chooser_shown` — emitted by S6 `match_resolve_reciprocal` (C11.4) when the chooser is surfaced.
> - `rate_submitted` — emitted on `match_ratings` insert (S8 rating window).
> - `standby_filled` — emitted on the real promotion (`shortlisted → offer_active` via `match_auto_roll`/`match_next_standby`, C2), NOT a nonexistent `status='standby'` value.

**Files:**
- Create: `apps/web/app/loop-analytics.ts`
- Create: `apps/web/app/loop-analytics.test.ts`
- Create: `supabase/tests/p11_analytics_events_coverage.sql`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/app/loop-analytics.test.ts
import { describe, it, expect } from 'vitest';
import { LOOP_EVENTS, isLoopEvent } from './loop-analytics';

describe('loop analytics taxonomy', () => {
  it('enumerates every §7.1 / §13 transition (all 15)', () => {
    for (const name of [
      'swipe_right', 'swipe_left', 'shortlist_added', 'rank_changed',
      'offer_made', 'offer_accepted', 'offer_passed', 'offer_expired',
      'standby_filled', 'lock_confirmed', 'lock_cancelled',
      'reciprocal_chooser_shown', 'withdraw', 'rate_submitted', 'feed_empty_shown',
    ]) {
      expect(LOOP_EVENTS).toContain(name);
    }
    expect(LOOP_EVENTS).toHaveLength(15);
  });
  it('isLoopEvent guards unknown names', () => {
    expect(isLoopEvent('offer_made')).toBe(true);
    expect(isLoopEvent('nope')).toBe(false);
  });
});
```

```sql
-- supabase/tests/p11_analytics_events_coverage.sql
-- COVERAGE: each server-authoritative transition (driven by the C2 match_* RPCs / C1 jobs)
-- must land a distinctly-named row in the S2-owned analytics_events outbox. Fixtures via C8.
-- This asserts the contract emit (owned by S6/S2); if it fails, the fix is in the owning plan.
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE cre uuid; cand uuid; itin uuid; inst uuid; off uuid; n int;
BEGIN
  cre  := mk_user('creator');
  cand := mk_user('candidate');
  itin := mk_itinerary(cre);
  inst := mk_instance(itin, cre, now() + interval '2 days');

  -- drive the real transitions through the C2 API (NOT bare status UPDATEs)
  perform match_shortlist(cre, inst, cand, 1);
  off := match_make_offer(cre, inst, cand, 'idem-1');
  perform match_accept_offer(cand, off, 'idem-2');

  -- distinct, correctly-named events landed in the S2 outbox:
  perform 1 from analytics_events where event='offer_made'     and entity_id=off;
  if not found then raise exception 'offer_made not emitted by match_make_offer'; end if;
  perform 1 from analytics_events where event='offer_accepted'  and entity_id=off;
  if not found then raise exception 'offer_accepted not emitted by match_accept_offer'; end if;
  perform 1 from analytics_events where event='shortlist_added';
  if not found then raise exception 'shortlist_added not emitted by match_shortlist'; end if;

  -- withdraw must be its own event, NEVER relabeled as offer_passed/expired:
  perform match_withdraw(cand, inst);
  perform 1 from analytics_events where event='withdraw';
  if not found then raise exception 'withdraw not emitted distinctly by match_withdraw'; end if;

  raise notice 'analytics coverage OK';
  rollback;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (missing taxonomy module; coverage rows absent until S6/S2 emit).

- [ ] **Step 3: Write the client taxonomy** (the only DB object P11 owns for analytics is the relay job in Task 13b — the table + emits are S2/S6).

```ts
// apps/web/app/loop-analytics.ts
// Single source of truth for loop event names + payloads. NEVER call posthog.capture
// with a string literal elsewhere. These names match the S2-owned `analytics_events.event`
// values that P5/P2 write (C2/C11.8) and the relay (Task 13) forwards to PostHog.
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

- [ ] **Step 4: Run both, expect PASS** (the coverage psql test passes once S6/S2 emit per contract; until then it is the executable proof of the gap — do not skip it).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/loop-analytics.ts apps/web/app/loop-analytics.test.ts supabase/tests/p11_analytics_events_coverage.sql
git commit -m "P11: loop analytics taxonomy (15 events) + outbox coverage test (table owned by S2; emits by S6/S2)

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

## Task 12: Offer-window flag config UI/value (reads the P2-owned `feature_config`; no parallel table)

The lock-offer window length must be tunable. **The `feature_config` table + the `offer_window_hours` row + `offer_expires_at()` are owned by P2 (C11.1, band `123800`) — P11 does NOT create them.** P5's `match_make_offer` already sets `expires_at := offer_expires_at()` (C2/C11.1) — the window is **already load-bearing**; the audit's "decorative flag" seam is closed by the contract. P11 owns **only the flag-reader UI/value layer**: a typed client reader that prefers a PostHog flag and falls back to the DB value, plus the admin path that writes the chosen value back into the P2-owned `feature_config` row.

> **No parallel system.** P11 must not `create table feature_config`, must not define a second `offer_expires_at(...)`, and the schema P11 reads is the **C11.1 schema**: `feature_config(key text pk, value jsonb, updated_at)` with the seed `('offer_window_hours','24'::jsonb)`. The value is a bare JSON scalar (`'24'`), read via `value#>>'{}'` — **not** `value->>'hours'`. `offer_expires_at()` clamps to 12–72h server-side (C11.1).

**Files:**
- Create: `apps/web/lib/feature-flags.ts`
- Create: `apps/web/lib/feature-flags.test.ts`
- Create: `supabase/tests/p11_feature_config.sql` (read-only assertion against the P2-owned table)

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/feature-flags.test.ts
import { describe, it, expect, vi } from 'vitest';
import posthog from 'posthog-js';
import { offerWindowHours } from './feature-flags';

describe('offerWindowHours', () => {
  it('uses the PostHog flag payload when present', () => {
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue({ hours: 36 });
    expect(offerWindowHours(24)).toBe(36);
  });
  it('falls back to the provided feature_config default when no flag', () => {
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    expect(offerWindowHours(24)).toBe(24);
  });
  it('clamps to the C11.1 safe 12–72h range (same clamp as offer_expires_at())', () => {
    (posthog.getFeatureFlagPayload as ReturnType<typeof vi.fn>).mockReturnValue({ hours: 999 });
    expect(offerWindowHours(24)).toBe(72);
  });
});
```

```sql
-- supabase/tests/p11_feature_config.sql
-- READ-ONLY check against the P2-owned (C11.1) feature_config row. P11 does not create it.
DO $$
DECLARE v int;
BEGIN
  PERFORM 1 FROM feature_config WHERE key='offer_window_hours';
  IF NOT FOUND THEN RAISE EXCEPTION 'offer_window_hours seed missing (owned by P2/C11.1)'; END IF;
  -- C11.1 stores a bare JSON scalar: value = '24'::jsonb, read via #>>'{}'
  SELECT (value#>>'{}')::int INTO v FROM feature_config WHERE key='offer_window_hours';
  IF v < 12 OR v > 72 THEN RAISE EXCEPTION 'offer_window_hours out of C11.1 safe range: %', v; END IF;
  RAISE NOTICE 'feature_config OK (offer window = % h)', v;
END $$;
```

- [ ] **Step 2: Run both, expect FAIL** (missing reader module; `feature_config` exists from P2).

- [ ] **Step 3: Write the code** (client reader only — clamp mirrors `offer_expires_at()`'s 12–72h, C11.1).

```ts
// apps/web/lib/feature-flags.ts
'use client';
import posthog from 'posthog-js';

const MIN_HOURS = 12;
const MAX_HOURS = 72;

// Offer-window length. PostHog flag payload is the experiment-assignment layer;
// dbDefault is the value read from the P2-owned feature_config row (C11.1) for SSR/jobs.
// The clamp matches offer_expires_at()'s server-side clamp so client + server agree.
export function offerWindowHours(dbDefault: number): number {
  const payload = posthog.getFeatureFlagPayload?.('offer_window') as { hours?: number } | undefined;
  const raw = typeof payload?.hours === 'number' ? payload.hours : dbDefault;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(raw)));
}
```

> **Write path (admin UI).** The experiment's chosen value is written back to `feature_config` by an admin-only RPC/route (admin gated by `admin_has_role()`, C10) that updates the C11.1 row's `value` (bare JSON scalar). P11 wires this admin control into the existing S9 admin console (`apps/web/app/admin/*`); it does not add a public write policy. The server-side window math stays in `offer_expires_at()` — P11 never recomputes expiry in TS.

- [ ] **Step 4: Apply + run both, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/feature-flags.ts apps/web/lib/feature-flags.test.ts supabase/tests/p11_feature_config.sql
git commit -m "P11: offer-window flag reader + admin write into P2-owned feature_config (C11.1; no parallel table)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Analytics relay — drain the S2 `analytics_events` outbox to PostHog (service-role + flush)

Forward the **S2-owned** `analytics_events` outbox to PostHog from the server (jobs have no browser SDK). Adds `posthog-node` and `drainAnalyticsEvents` that selects unforwarded rows, captures them, **`flush()`es (at-least-once)**, then marks them forwarded — idempotent and batched. The drain runs **only** under the `analytics_relay` job handler wired in Task 13b (C1 job type).

> **Auth (audit §5).** The relay MUST be constructed with the **service-role** Supabase client (RLS on `analytics_events` = no policies = deny; the relay bypasses RLS via service role). If it ran with a user JWT, `SELECT` returns 0 rows and the drain silently no-ops. The handler injects the service-role client.
> **At-least-once (audit §4).** `posthog-node.capture` is buffered fire-and-forget; the relay calls `await ph.flush()` **before** marking rows `forwarded_at`, so a crash re-drains rather than silently dropping. Re-delivery is acceptable (PostHog dedups on event id if supplied; otherwise at-least-once is the documented guarantee).

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
  it('captures each unforwarded row, flushes, THEN marks them forwarded (at-least-once)', async () => {
    const capture = vi.fn();
    const flush = vi.fn().mockResolvedValue(undefined);
    const client = fakeClient([
      { id: 1, event: 'offer_made', distinct_id: 'u1', props: { date_instance_id: 'd1' } },
      { id: 2, event: 'lock_confirmed', distinct_id: 'u2', props: {} },
    ]);
    const n = await drainAnalyticsEvents(client as never, { capture, flush } as never);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith({ distinctId: 'u1', event: 'offer_made', properties: { date_instance_id: 'd1' } });
    expect(flush).toHaveBeenCalledTimes(1);            // flush BEFORE marking forwarded
    expect(client.updated.flat()).toEqual([1, 2]);
    expect(n).toBe(2);
  });

  it('does NOT mark forwarded if flush rejects (rows re-drain next run)', async () => {
    const capture = vi.fn();
    const flush = vi.fn().mockRejectedValue(new Error('network'));
    const client = fakeClient([{ id: 1, event: 'offer_made', distinct_id: 'u1', props: {} }]);
    await expect(drainAnalyticsEvents(client as never, { capture, flush } as never)).rejects.toThrow();
    expect(client.updated).toEqual([]);               // never marked forwarded on flush failure
  });

  it('returns 0 and skips capture/flush when nothing is pending', async () => {
    const capture = vi.fn();
    const flush = vi.fn();
    const client = fakeClient([]);
    const n = await drainAnalyticsEvents(client as never, { capture, flush } as never);
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
  flush(): Promise<void>;
}

// Drain the S2-owned analytics_events outbox to PostHog. MUST be called with a
// SERVICE-ROLE client (RLS denies otherwise). Idempotent: only forwarded_at IS NULL rows
// are sent; flush() (at-least-once) runs BEFORE marking forwarded so a crash re-drains.
// Invoked only by the `analytics_relay` job handler (Task 13b).
export async function drainAnalyticsEvents(
  client: After5Client,            // service-role client
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
  await ph.flush();                // at-least-once: ensure delivery BEFORE marking forwarded
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

- [ ] **Step 4: Run it, expect PASS** via `pnpm test` (P1's root vitest workspace already covers `packages/api-client/**`, C12 — do NOT add a sibling config).

- [ ] **Step 5: Commit**

```bash
git add packages/api-client/src/analytics-relay.ts packages/api-client/src/analytics-relay.test.ts packages/api-client/src/index.ts packages/api-client/package.json pnpm-lock.yaml
git commit -m "P11: analytics relay — drain S2 analytics_events outbox to PostHog (service-role, flush, idempotent)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13b: `analytics_relay` job type + `process-jobs` handler + 30-day retention (C1/C11.8)

**SEAM FIX (audit §2; C1; C11.8).** The relay (Task 13) is inert without a job to run it. P11 **owns the `analytics_relay` JOB TYPE + its handler** (the `job_type` enum already includes `'analytics_relay'` per C1 — P11 does NOT `ALTER TYPE`; the value is in the canonical C1 enum). P11 adds the **handler branch in the C1 `process-jobs` runner** that drains the outbox with a service-role client, plus a **self-rescheduling enqueue** (so it runs continuously) and **30-day retention** (C11.8: purge `analytics_events` after 30d). **Depends on: S2 (C1 `jobs`/`job_type`/`enqueue_job`/`process-jobs` runner; `analytics_events` table).**

> P11 must use the C1 names exactly: `enqueue_job(p_type job_type, …)`, the runner's per-`type` dispatch, dead-letter at `attempts>=5`. No local `jobs`/shim.

**Files:**
- Modify: `supabase/functions/process-jobs/` (add the `analytics_relay` dispatch branch in the C1 runner)
- Create: `supabase/migrations/20260525132000_p11_analytics_relay_job.sql` (retention purge fn + initial self-rescheduling enqueue)
- Create: `supabase/tests/p11_analytics_relay_job.sql`

- [ ] **Step 1: Write the failing test**

```sql
-- supabase/tests/p11_analytics_relay_job.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE n int;
BEGIN
  -- the job type exists in the C1 enum (P11 did not add it; it is canonical)
  PERFORM 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
   WHERE t.typname='job_type' AND e.enumlabel='analytics_relay';
  IF NOT FOUND THEN RAISE EXCEPTION 'analytics_relay missing from C1 job_type enum'; END IF;

  -- a recurring analytics_relay job is enqueued (self-reschedule keeps the drain live)
  PERFORM 1 FROM jobs WHERE type='analytics_relay' AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'no pending analytics_relay job enqueued'; END IF;

  -- 30d retention helper exists and prunes forwarded rows older than 30d
  PERFORM 1 FROM pg_proc WHERE proname='purge_analytics_events';
  IF NOT FOUND THEN RAISE EXCEPTION 'purge_analytics_events() missing (C11.8 retention)'; END IF;
  INSERT INTO analytics_events(event, entity, entity_id, distinct_id, forwarded_at, created_at)
    VALUES ('offer_made','offers',gen_random_uuid(),gen_random_uuid(), now()-interval '31 days', now()-interval '31 days');
  PERFORM purge_analytics_events();
  SELECT count(*) INTO n FROM analytics_events WHERE created_at < now()-interval '30 days';
  IF n <> 0 THEN RAISE EXCEPTION 'purge_analytics_events left % stale rows', n; END IF;
  RAISE NOTICE 'analytics_relay job + retention OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration + handler**

```sql
-- supabase/migrations/20260525132000_p11_analytics_relay_job.sql
-- C11.8 retention: drop forwarded (and any) analytics_events older than 30 days.
create or replace function purge_analytics_events() returns int
language sql security definer set search_path = public as $fn$
  with del as (
    delete from analytics_events where created_at < now() - interval '30 days' returning 1
  ) select count(*)::int from del;
$fn$;
revoke execute on function purge_analytics_events() from public, authenticated;

-- Seed a recurring drain: enqueue the first analytics_relay job (the handler re-enqueues
-- itself each run via enqueue_job with a dedup_key so exactly one is ever pending, C1).
select enqueue_job('analytics_relay', now(), '{}'::jsonb, 'analytics_relay_singleton');
```

In `supabase/functions/process-jobs/` add to the C1 runner's per-`type` dispatch:
```ts
// case 'analytics_relay':
//   1. build a SERVICE-ROLE supabase client (not the user JWT)
//   2. const ph = new PostHog(POSTHOG_KEY, { host });
//   3. await drainAnalyticsEvents(serviceClient, ph);   // flush()es internally
//   4. await ph.shutdown();                              // flush + close
//   5. await serviceClient.rpc('purge_analytics_events'); // C11.8 retention each run
//   6. re-enqueue: enqueue_job('analytics_relay', now()+interval '1 minute', '{}', 'analytics_relay_singleton')
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525132000_p11_analytics_relay_job.sql supabase/tests/p11_analytics_relay_job.sql supabase/functions/process-jobs
git commit -m "P11: analytics_relay job handler in C1 runner + 30d retention (C11.8); closes the drain seam

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Timezone/DST correctness for display (offer expiry math owned by `offer_expires_at()`)

The audit flags timezone/DST. P0 already stores everything `timestamptz` (instants are correct), so the only risk P11 owns is **display** — a "Friday evening" window must render in the **city's zone** (`cities.timezone`), not the runner's. **Expiry math is NOT P11's: `offer_expires_at()` (C11.1, owned by P2) is the single DST-safe rule, and P5's `match_make_offer` already calls it.** P11 must NOT define a second `offer_expires_at(...)` (CV8/C11.1). This task ships only the TS `formatInZone` display helper.

> **REMOVED:** the original `addOfferWindow` TS helper and the `20260525130500_p11_offer_expiry_tz.sql` migration defining a 2-arg `offer_expires_at(window_start, window_hours)` — both **DELETED**. There is one expiry rule (`offer_expires_at(p_from default now())` reading `feature_config`, C11.1) and it lives in P2. The TS layer never recomputes expiry; it only displays the server-provided `expires_at`.

**Files:**
- Create: `apps/web/lib/timezone.ts` (display only)
- Create: `apps/web/lib/timezone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/timezone.test.ts
import { describe, it, expect } from 'vitest';
import { formatInZone } from './timezone';

describe('timezone', () => {
  it('formats an instant in the city zone, not the runner zone', () => {
    // 2026-06-05T02:00:00Z is 2026-06-04 19:00 PDT (America/Vancouver, UTC-7 in summer)
    const out = formatInZone('2026-06-05T02:00:00Z', 'America/Vancouver', { weekday: 'long', hour: 'numeric' });
    expect(out).toMatch(/Thursday/);
    expect(out).toMatch(/7/);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the code** (display helper only — no expiry math in TS)

```ts
// apps/web/lib/timezone.ts
// All instants are timestamptz/ISO (correct by storage). This helper ensures DISPLAY
// resolves in the city zone (cities.timezone). Offer-window EXPIRY math is owned by the
// DB function offer_expires_at() (C11.1, P2) — never recomputed in TypeScript.
export function formatInZone(
  iso: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('en-CA', { ...options, timeZone }).format(new Date(iso));
}
```

- [ ] **Step 4: Run it, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/timezone.ts apps/web/lib/timezone.test.ts
git commit -m "P11: timezone display helper (city-zone formatInZone); expiry math stays in offer_expires_at() (C11.1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Index review — covering indexes for hot loop queries (aligned to S6 ordering)

Review the loop's hot read paths and add indexes the base-table migrations left out, **aligned to the S6 match-API's actual access patterns (C2)**. Hot paths: (a) the C1 `offer_expiry` job scans active offers by `expires_at`; (b) **auto-roll's next-standby = lowest-rank `shortlisted` row (`match_next_standby`, C2)** — NOT a `status='standby'` value, so the index must target `shortlisted`; (c) creator pulls right-swipers for a night; (d) candidate reads their queue rows. Verify each via `pg_indexes` existence + an `EXPLAIN` asserting an index scan on the standby path.

> **FIXED vs the original draft (audit §8):** the `queue_standby_rank_idx ... where status='standby'` index targeted a value the S6 next-standby path does not use. Replaced with `queue_shortlisted_rank_idx ... where status='shortlisted'` to serve `match_next_standby`'s lowest-rank-shortlisted query. Redundant `swipes`/`match_ratings` indexes that duplicate base-table ones are dropped from this task (added only if a base-table index is genuinely absent).

**Files:**
- Create: `supabase/migrations/20260525132100_p11_index_review.sql`
- Create: `supabase/tests/p11_index_review.sql`

- [ ] **Step 1: Write the failing test** (the indexes exist AND the standby path uses one)

```sql
-- supabase/tests/p11_index_review.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE plan text;
BEGIN
  PERFORM 1 FROM pg_indexes WHERE tablename='offers' AND indexname='offers_active_expiry_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'offers_active_expiry_idx missing'; END IF;
  PERFORM 1 FROM pg_indexes WHERE tablename='queue_entries' AND indexname='queue_shortlisted_rank_idx';
  IF NOT FOUND THEN RAISE EXCEPTION 'queue_shortlisted_rank_idx missing'; END IF;
  -- prove the next-standby (lowest-rank shortlisted) query uses the index, not a seq scan:
  EXPLAIN (FORMAT TEXT)
    SELECT * FROM queue_entries
     WHERE date_instance_id = gen_random_uuid() AND status='shortlisted'
     ORDER BY rank LIMIT 1
   INTO plan;
  IF plan NOT ILIKE '%queue_shortlisted_rank_idx%' THEN
    RAISE EXCEPTION 'next-standby query did not use queue_shortlisted_rank_idx: %', plan; END IF;
  RAISE NOTICE 'index review OK';
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the migration** (band `132100`)

```sql
-- supabase/migrations/20260525132100_p11_index_review.sql
-- (a) C1 offer_expiry job: "active offers due before now()" — partial, ordered by expiry.
create index if not exists offers_active_expiry_idx
  on offers (expires_at) where status = 'active';

-- (b) S6 match_next_standby (C2): next standby = lowest-rank SHORTLISTED row for the instance.
create index if not exists queue_shortlisted_rank_idx
  on queue_entries (date_instance_id, rank) where status = 'shortlisted';

-- (c) Creator shortlist screen: right-swipers on the creator's nights (add only if absent in S5).
create index if not exists swipes_creator_right_idx
  on swipes (creator_id, date_instance_id) where direction = 'right';

-- (d) Candidate "my queue" reads (status filter common).
create index if not exists queue_candidate_status_idx
  on queue_entries (candidate_id, status);
```

- [ ] **Step 4: Apply + run test, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525132100_p11_index_review.sql supabase/tests/p11_index_review.sql
git commit -m "P11: index review — partial/covering indexes aligned to S6 ordering (shortlisted next-standby)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Demand hint — use the canonical `match_demand_hint` (DELETED duplicate; CV7/DS2)

**SUPERSEDED — DO NOT BUILD.** The original `demand_hint` view + `bucket_demand()` are **DELETED**. Per **C2 / CV7 / DS2**, the **only** demand hint is **`match_demand_hint(p_instance uuid) returns text`**, owned by P5 (S6), which is presence- AND trust-weighted, capped, and honesty-guarded (spec §7.2). P11's view counted raw right-swipes with contradictory buckets (`many` vs `lots`, different ceilings) and no weighting — a CONFLICT. P11 deletes it and the candidate-facing UI calls the canonical RPC.

**Canonical ref (no P11 object):** `match_demand_hint(p_instance)` (C2). The demand-hint UI surface (the social-proof line on the night card) calls this RPC; P11 wires the display string only. There is no `demand_hint` view, no `bucket_demand()`, no `20260525130300_p11_presence_demand_hint.sql` migration.

- [ ] **Step 1: If a prior pass created `demand_hint`/`bucket_demand()`, drop them** in a band-`132xxx` cleanup migration (`drop view if exists demand_hint; drop function if exists bucket_demand(int);`) and remove `supabase/tests/p11_presence_demand_hint.sql`.
- [ ] **Step 2: Confirm the candidate night-card UI reads `match_demand_hint(instance)`** (C2) and renders its bucket text. No P11-owned bucketing.
- [ ] **Step 3: Commit (only if a cleanup was needed)**

```bash
git commit -am "P11: delete duplicate demand_hint/bucket_demand; use canonical match_demand_hint (CV7/DS2)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Notification anti-storm — use canonical `dispatch_notification` (DELETED duplicate; DS1)

**SUPERSEDED — DO NOT BUILD.** The original `notification_batches` table + `coalesce_notification()` are **DELETED**. Per **C1 / C10 / DS1**, the **only** anti-storm system is **`dispatch_notification(p_user, p_type notification_type, p_payload)`** (owned by P2), whose ordered chain is consent → quiet-hours → **rate-limit (`rate_limit_check`)** → channel (push→web→email). P11 shipping a parallel `notification_batches` island (no producer, no consumer) is a CONFLICT. P11 deletes it; any rapid-fan-out suppression is the responsibility of `dispatch_notification`'s rate-limit step.

**Canonical ref (no P11 object):** `dispatch_notification` (C1); `notification_type` enum (C1); `notification_preferences` (P2 band `123xxx`, C11.8). There is no `notification_batches`, no `coalesce_notification()`, no `20260525130400_p11_notification_batching.sql` migration.

> Safety types (`safety_checkin`, `safety_alert`) bypass consent/quiet/rate-limit and fail loud into `admin_alerts` + ops email if no device (C1, C11.8). P11 does not alter this.

- [ ] **Step 1: If a prior pass created `notification_batches`/`coalesce_notification()`, drop them** in a band-`132xxx` cleanup migration and remove `supabase/tests/p11_notification_batching.sql`.
- [ ] **Step 2: Confirm no P11 code calls a batching fn** — all notification sends go through P2's `dispatch_notification`.
- [ ] **Step 3: Commit (only if a cleanup was needed)**

```bash
git commit -am "P11: delete duplicate notification batching; use canonical dispatch_notification (DS1)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Full verification — all P11 tests + type regen

**Files:**
- Modify: `packages/types/src/database.ts` (regenerated — picks up `purge_analytics_events`, the `analytics_relay` job wiring, and any P11 index/feed changes; `analytics_events`/`feature_config` types come from S2's regen)

- [ ] **Step 1: DB reset (applies every S1–S11 + P11 migration)**

Run: `supabase db reset`
Expected: completes with no error; all migrations apply in band order (P11 at `132xxx`, feed finalization at `133000`). **No duplicate `create type`/`create table` for any shared object** (jobs, feature_config, analytics_events, notification, demand hint) — P11 owns none of those.

- [ ] **Step 2: Run all P11 psql tests**

Run:
```bash
for f in supabase/tests/p11_*.sql; do
  echo "== $f =="; psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f "$f" || exit 1;
done
```
Expected: every file exits 0; notices print `… OK`. (Files: `p11_analytics_relay_job.sql`, `p11_analytics_events_coverage.sql`, `p11_index_review.sql`, `p11_browse_feed_finalize.sql`, `p11_feature_config.sql`.)

- [ ] **Step 3: Run all web/package TS tests**

Run: `pnpm test` (P1's root vitest workspace, C12 — covers `apps/web` + `packages/*`).
Expected: all suites pass.

- [ ] **Step 4: Regenerate types**

Run: `pnpm db:types`
Expected: `packages/types/src/database.ts` regenerates without error (includes the finalized `browse_feed`).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/database.ts
git commit -m "P11: regenerate database types after feed finalization + analytics relay

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18b: `browse_feed` FINALIZATION migration (C11.3, band `133000` — P11 OWNS this)

**P11 OWNS THE FEED FINALIZATION (C11.3, supersedes C4 "defined once in P4" + the C6 `129900` slot).** The single `browse_feed` view is built here — **the very last migration**, band `133000` — via **`drop view if exists browse_feed; create view …`** (NOT `create or replace`, which forbids column changes). It runs after every base-table column it reads exists: `moderation_status` (P3/P8), `is_seed` (P4), `vibe_tags` (P0/C7), `sound_*` (P3), `account_state`/`standing` (P9/P7). This **supersedes any earlier minimal feed view** other phases used for tests. No phase uses `create or replace browse_feed`; phases only `alter table` base tables.

**Files:**
- Create: `supabase/migrations/20260525133000_p11_browse_feed_finalize.sql`
- Create: `supabase/tests/p11_browse_feed_finalize.sql`

- [ ] **Step 1: Write the failing test** — the finalized view exists, exposes the C4 projection, and the C11.3 filter hides paused/suspended creators and past/unapproved instances.

```sql
-- supabase/tests/p11_browse_feed_finalize.sql
\i 'supabase/tests/_fixtures.sql'
DO $$
DECLARE cre uuid; itin uuid; live uuid; past uuid; n int;
BEGIN
  cre  := mk_user('feedcre');
  itin := mk_itinerary(cre);
  live := mk_instance(itin, cre, now() + interval '2 days');  -- future, seeking, approved
  past := mk_instance(itin, cre, now() - interval '1 day');   -- past → must be excluded

  -- canonical projection present (identity-stripped):
  PERFORM 1 FROM information_schema.columns
   WHERE table_name='browse_feed' AND column_name IN
     ('date_instance_id','city_id','time_window_start','itinerary_id','pay_setting',
      'vibe_tags','why_note','sound_title','sound_license','venue_neighborhood','is_seed');
  IF NOT FOUND THEN RAISE EXCEPTION 'browse_feed missing canonical C4 projection'; END IF;

  -- C11.3 filter: only seeking + starts_at>now() + moderation_status=approved + active/standing creator
  PERFORM 1 FROM browse_feed WHERE date_instance_id = live;
  IF NOT FOUND THEN RAISE EXCEPTION 'live night not surfaced'; END IF;
  PERFORM 1 FROM browse_feed WHERE date_instance_id = past;
  IF FOUND THEN RAISE EXCEPTION 'past night leaked into feed'; END IF;

  -- pausing the creator removes their nights from the feed (closes the regression)
  UPDATE profiles SET account_state='paused' WHERE id=cre;
  PERFORM 1 FROM browse_feed WHERE date_instance_id = live;
  IF FOUND THEN RAISE EXCEPTION 'paused creator still browsable'; END IF;

  -- suspended standing also removes them
  UPDATE profiles SET account_state='active', standing='suspended' WHERE id=cre;
  PERFORM 1 FROM browse_feed WHERE date_instance_id = live;
  IF FOUND THEN RAISE EXCEPTION 'suspended creator still browsable'; END IF;

  RAISE NOTICE 'browse_feed finalization OK';
  ROLLBACK;
END $$;
```

- [ ] **Step 2: Run it, expect FAIL.**

- [ ] **Step 3: Write the finalization migration** (drop+create; C11.3 projection + filter exactly)

```sql
-- supabase/migrations/20260525133000_p11_browse_feed_finalize.sql
-- FEED FINALIZATION (C11.3). The single browse_feed definition; drop+create (NOT
-- create-or-replace) so column changes are allowed. Runs last, after every base column
-- it reads exists. Supersedes any earlier minimal feed view used for tests.
drop view if exists browse_feed;
create view browse_feed
with (security_invoker = true) as
select
  di.id              as date_instance_id,
  di.city_id,
  date_trunc('hour', di.starts_at) as time_window_start,   -- hour-truncated (identity-stripping)
  it.id              as itinerary_id,
  di.pay_setting,
  it.vibe_tags,
  di.why_note,
  di.sound_title,
  di.sound_license,
  di.venue_neighborhood,
  di.is_seed
from date_instances di
join itineraries it on it.id = di.itinerary_id
join profiles cr   on cr.id = di.creator_id           -- cr = creator profile (C11.3)
where di.status = 'seeking'
  and di.starts_at > now()
  and di.moderation_status = 'approved'
  and cr.account_state = 'active'
  and cr.standing not in ('suspended','locked_ban');
```

> The client entrypoint `browse_feed_for_viewer(p_viewer, p_point)` (C4) — mutual compatibility + distance + blocked/already-swiped exclusion + keyset pagination, returning every column above plus `distance_m` — is owned by **P4 (S5)** and reads this finalized view. P11 finalizes the view shape; it does not redefine the RPC.

- [ ] **Step 4: Apply + run test, expect PASS** (`supabase db reset` then the psql test — the finalization migration sorts last by its `133000` band).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260525133000_p11_browse_feed_finalize.sql supabase/tests/p11_browse_feed_finalize.sql
git commit -m "P11: browse_feed FINALIZATION (C11.3) — drop+create, full projection + account_state/standing filter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (vs S12 / roadmap P11 'Closes' list) — every primitive is wired into a real host screen (no orphans):**
- Loading/error/empty states → Task 2 (`AsyncBoundary` + `LoadState` + distinct P5-error copy), Task 3 (`useAsyncAction`), Task 4 (`LoopActionButton`) — **wired** into the S6 lock screen (Task 4b), P6 chat (Task 4c), and P4 feed (Task 9b). ✅
- A11y — non-audio ambient equivalent → **Task 6 edits P4's `AmbientPlayer`** (no duplicate component). ✅
- A11y — accessible swipe alternative → **Task 7 edits P4's `SwipeDeck`** (no duplicate; same swipe action). ✅
- A11y — accessible offer countdown → Task 8 (`OfferCountdown`, threshold-throttled, no SR spam) **mounted on the S6 lock screen (Task 4b)**. ✅
- A11y — pink-on-dark contrast → Task 5 (WCAG-AA-verified `feed.*` tokens + drift guard test). ✅
- A11y — screen-reader feed semantics → Task 9 (`feed-a11y` on the **canonical `browse_feed` columns**, no invented `timezone` field) **wired into P4's feed (Task 9b)**. ✅
- Mobile + native-push reliance → responsive Tailwind primitives; ambient gesture-gates per iOS-Safari §10; push backbone delegated to P2's C1 `dispatch_notification` (P11 ships no parallel batching). ✅
- Analytics — event for every transition → Task 10 (taxonomy of all 15 + a **coverage test** proving the 7 previously lost/mislabeled events emit distinctly; `analytics_events` table owned by S2, emits by S6/S2), Task 11 (client `track.loop`), Task 13 + **Task 13b (`analytics_relay` job + handler + 30d retention, C11.8)** — closes the drain seam. ✅
- Experiment flag to tune offer window → Task 12 (flag reader + admin write into the **P2-owned `feature_config`**, C11.1; expiry math stays in `offer_expires_at()`). ✅
- Scalability — index review (Task 15, aligned to S6 ordering); demand hint via **canonical `match_demand_hint`** (Task 16, duplicate deleted); notification anti-storm via **canonical `dispatch_notification`** (Task 17, duplicate deleted). ✅
- Timezone/DST → Task 14 (display only; expiry owned by `offer_expires_at()`). ✅
- **Feed finalization → Task 18b: P11 OWNS the `browse_feed` drop+create at band `133000` with the full C11.3 projection + filter** (closes the paused/suspended-creator regression). ✅

**Subordinate to the contract (no re-invention):** P11 creates NONE of the shared objects — `analytics_events`/`feature_config`/`offer_expires_at()`/`dispatch_notification`/`jobs`/`job_type` are owned by S1/S2 (C1/C8/C11). P11 owns only: the loop UI primitives (wired into real screens), the analytics taxonomy + relay job/handler/retention, the flag reader, the index review, and the `browse_feed` finalization. All P11 migrations are in band `132xxx` except the feed finalization at `133000`. No `create or replace browse_feed`, no duplicate `create type`/`create table`.

**Deleted vs original draft (now SUPERSEDED):** vitest bootstrap (P1 owns root config, C12); `analytics_events` table + trigger (S2 owns table, S6/S2 emit); `feature_config` table (P2 owns, C11.1); `offer_expires_at(window,hours)` DB fn + `addOfferWindow` TS (P2 owns the one expiry rule); `demand_hint`/`bucket_demand()` (canonical `match_demand_hint`, CV7); `notification_batches`/`coalesce_notification()` (canonical `dispatch_notification`, DS1); `components/loop/SwipeDeck` + `AmbientSound` (edit P4's instead, DS6); band `130xxx` timestamps (→ `132xxx`/`133000`).

**Depends on:** S1 (schema spine, `mk_user`/`mk_itinerary`/`mk_instance` fixtures, `standing`/`account_state` columns), S2 (C1 jobs/runner, `analytics_events`, `feature_config`, `offer_expires_at()`, `dispatch_notification`), P1 (root vitest config), P4/S5 (`SwipeDeck`/`AmbientPlayer`/`BrowseFeed`/`browse_feed_for_viewer`), S6 (C2 match API incl. `match_demand_hint`/`match_make_offer`/`match_accept_offer`/`match_withdraw`/`match_resolve_reciprocal` + the lock/offer screen), S7/P6 (chat thread screen), S8 (rating window for `rate_submitted`), S9 (admin console for the flag write UI). P11 finalizes last.

**Decisions:**
- **Analytics tool: PostHog** (already a dependency and wired in `PostHogProvider.tsx`). The server-authoritative transitions fire in the DB/jobs, not the browser, so the **S2-owned `analytics_events` outbox** (written by P5 RPCs / P2 jobs, C2/C8) is the durable source; P11's `analytics_relay` job + handler (Task 13b) drains it to PostHog with `flush()` (at-least-once) and 30d retention (C11.8). Client-only transitions (e.g. `feed_empty_shown`) go through `track.loop` (Task 11).
- **Flagging approach: PostHog feature flags as the experiment-assignment layer; the P2-owned `feature_config` (C11.1) is the source-of-truth** the server reads. Expiry math lives only in `offer_expires_at()` (C11.1) — P11 never recomputes it in TS. The window value is clamped to 12–72h in both layers (same clamp as `offer_expires_at()`).
- **Dark feed theme is a separate token set** (`feed.*`) from the cream marketing palette; contrast is a test, not a guideline, so it can't regress (with a drift guard, Task 5).
- **No duplicate shared systems:** demand hint = `match_demand_hint` (C2); anti-storm = `dispatch_notification` (C1); jobs = C1 enum/runner; `browse_feed` = the single C11.3 finalization (Task 18b). P11 references, never recreates.

**Placeholder scan:** none — every step has runnable code/SQL and exact commands, or an explicit edit-task against a real merged host screen. The `@ts-expect-error` lines are intentional negative tests.

**Test-harness note:** **vitest is owned by P1's single root config (C10/C12)** — P11 deletes any duplicate setup (Task 1) and runs everything under `pnpm test` (workspace covers `apps/web` + `packages/*`). psql tests follow P0's `DO $$ … RAISE EXCEPTION … END $$;` convention and seed via the C8 `mk_user`/`mk_itinerary`/`mk_instance` fixtures.

**Risk note:** `browse_feed` (Task 18b) uses `security_invoker = true` so RLS on the base tables governs visibility; the C11.3 filter (`account_state='active'` + `standing not in ('suspended','locked_ban')` + `starts_at>now()` + `moderation_status='approved'`) is the contract-mandated regression fix. The view is identity-stripped (creator columns are structurally absent), and `feed-a11y` consumes only those identity-stripped columns.

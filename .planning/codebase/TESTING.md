# Testing Patterns

**Analysis Date:** 2026-06-03

## Test Framework

**Runner:**
- Vitest (monorepo root: `vitest.config.ts`, web app: `apps/web/vitest.config.ts`)
- Version: `^2.1.8` (see `package.json`)
- Node environment for packages (pure TS, no DOM)
- jsdom environment for web app (React components + routes)
- Deno test (`deno test`) for edge functions (Deno runtime)

**Assertion Library:**
- Vitest's native `expect` assertions
- `@testing-library/react` for component DOM testing
- `@testing-library/jest-dom` matchers (imported in `apps/web/vitest.setup.ts`)
- `jest-axe` for accessibility testing (custom `toHaveNoViolations` matcher)

**Run Commands:**
```bash
pnpm test              # Run all tests (packages/* + apps/web)
pnpm test:watch       # Watch mode
turbo run test        # Turbo multi-workspace run
pnpm --filter @after5/web test  # Web app only
deno test --allow-all --import-map _test_import_map.json  # Edge functions
```

**Coverage:**
- No coverage tool configured (coverage report not enforced)
- Vitest can generate coverage if needed: `vitest --coverage`

## Test File Organization

**Location Pattern:**
- Package tests: `packages/*/src/**/*.test.ts` or `packages/*/src/__tests__/**/*.test.ts`
- Web app tests: `apps/web/app/**/*.test.{ts,tsx}`, `apps/web/lib/**/*.test.{ts,tsx}`, `apps/web/components/**/*.test.{ts,tsx}`
- E2E tests: `apps/web/e2e/**/*.spec.ts` (Playwright, not Vitest)
- Edge function tests: co-located `supabase/functions/[fn]/index.test.ts`

**Naming:**
- Unit/integration: `*.test.ts` or `*.test.tsx`
- E2E: `*.spec.ts` (Playwright convention)
- Test directory: `__tests__/` subdirectory OR file suffix (project chooses file suffix)
- Actual project uses: co-located `*.test.*` files (e.g., `LocalTime.test.tsx` next to `LocalTime.tsx`)

**Structure (File Layout):**
```
apps/web/
├── components/
│   ├── LocalTime.tsx
│   ├── LocalTime.test.tsx
│   ├── UserMenu.tsx
│   ├── UserMenu.test.tsx
│   └── __tests__/           # Alternative: grouped __tests__ for multi-test files
│       ├── notif-a11y.test.tsx
│       └── ...
├── lib/
│   ├── cn.ts
│   ├── cn.test.ts
│   └── __tests__/
├── app/
│   └── [routes]/*.test.ts

packages/business/src/
├── vibePalette.ts
├── vibePalette.test.ts    # [NOT FOUND — vibePalette untested]
└── index.ts

packages/api-client/src/
├── feed.ts
├── feed.test.ts            # Unit tests for feed normalization
└── index.ts
```

## Test Structure

**Suite Organization:**
```typescript
// packages/api-client/src/feed.test.ts — simple unit test
import { describe, it, expect } from 'vitest';
import { normalizeNightDetailStops } from './feed';

describe('normalizeNightDetailStops', () => {
  it('maps rich generated stops', () => {
    const out = normalizeNightDetailStops([{ ... }]);
    expect(out[0]!.name).toBe('The Pub');
  });

  it('maps thin {name,type} legacy stops', () => {
    const out = normalizeNightDetailStops([{ name: 'E2E Stop 1', type: 'cocktail_bar' }]);
    expect(out[0]!.name).toBe('E2E Stop 1');
  });

  it('returns [] for null/garbage', () => {
    expect(normalizeNightDetailStops(null)).toEqual([]);
  });
});
```

**React Component Pattern:**
```typescript
// apps/web/components/__tests__/LocalTime.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocalTime } from '../LocalTime';

describe('LocalTime', () => {
  it('renders a formatted date string for valid input', () => {
    const { container } = render(
      <LocalTime iso="2026-06-04T00:40:00Z" opts={{ month: 'short', day: 'numeric' }} />,
    );
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span!.textContent).not.toBe('date tbd');
  });

  it('renders the default fallback when iso is null', () => {
    render(<LocalTime iso={null} />);
    expect(screen.getByText('date tbd')).toBeInTheDocument();
  });

  it('forwards className to the span', () => {
    const { container } = render(<LocalTime iso="2026-06-04T00:40:00Z" className="text-sm" />);
    const span = container.querySelector('span');
    expect(span).toHaveClass('text-sm');
  });
});
```

**Patterns:**
- `describe()` groups related tests by function/component
- `it()` (or `test()`) describes one assertion or behavior
- `expect()` makes assertions; matchers are chainable
- Setup code in `beforeEach()` or test body; no global setup unless necessary
- Teardown in `afterEach()` for resources (DB, file cleanup)

## Mocking

**Framework:** Vitest's native `vi` (no additional mocking library needed)

**Patterns:**
```typescript
// apps/web/vitest.setup.ts — global mock setup
import { vi } from 'vitest';

// Polyfill jsdom-missing APIs
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
}

// supabase/functions/_shared/match.test.ts — stub Supabase client
import { resetStub } from './_test_supabase_stub.ts';

Deno.test('invalid JWT -> 401 auth_mismatch', async () => {
  resetStub({ userError: { message: 'invalid jwt' }, user: null });
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'POST', headers: AUTHED, body: '{}' }));
  assertEquals(res.status, 401);
});
```

**What to Mock:**
- Browser APIs not present in jsdom (e.g., `URL.createObjectURL`)
- Supabase client (use test-only import map: `_test_import_map.json` for Deno)
- External services (Resend, Twilio, Google Places) — stub only in E2E setup
- Timers: `vi.useFakeTimers()` if testing time-dependent logic

**What NOT to Mock:**
- React internals or `@testing-library/react` (`render`, `screen`)
- Component rendering (unless testing an abstraction layer)
- Real Supabase DB queries in unit tests (use fixture data)
- Network in unit tests (unit tests are local, fast, deterministic)

## Fixtures and Factories

**Test Data:**
- Edge function tests use seed data via `_test_supabase_stub.ts` (Deno test stubs)
- E2E tests use `_helpers/seed.ts` which creates real test users/dates in the local Supabase stack
- Component tests use minimal inline props (no separate fixture files unless >5 tests share the same data)

**Location:**
- `supabase/functions/_shared/_test_supabase_stub.ts` — request/response mocks for Deno edge tests
- `apps/web/e2e/_helpers/` — setup helpers (auth, seed, cleanup)
  - `_helpers/auth.ts` — `loginAs(context, email)` returns authenticated Page
  - `_helpers/seed.ts` — `seedTwoUsersAndNight()` → `{ hostEmail, candEmail, instanceId }`
  - `_helpers/global-setup.ts` — Playwright global setup (runs once before all tests)

**Example:**
```typescript
// apps/web/e2e/_helpers/seed.ts
export async function seedTwoUsersAndNight() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  
  // Create two users + one night instance
  const host = await admin.auth.admin.createUser({ email: 'host@test.local', password: 'test' });
  const cand = await admin.auth.admin.createUser({ email: 'cand@test.local', password: 'test' });
  const { data: instance } = await admin.from('date_instances').insert({...}).select().single();
  
  return { hostEmail: host.user.email, candEmail: cand.user.email, instanceId: instance.id };
}

export async function cleanup(seed: SeedResult) {
  const admin = createClient(...);
  await admin.auth.admin.deleteUser(seed.hostId);
  // ...
}
```

## Coverage

**Requirements:** None enforced (no CI gate)

**View Coverage:**
```bash
pnpm test -- --coverage    # Generates coverage report (if tool installed)
# Report location: coverage/ (gitignored)
```

**Strategy:**
- Critical paths (error handling, data normalization, RLS policies) are tested
- Test-driven for bugs: add test before fix
- E2E tests cover the happy path and critical failures (offer → accept → reveal)
- Component unit tests cover props, edge cases (null input, invalid date)
- Edge function tests cover all 8 match-* functions' scaffolding (auth, CORS, method validation)

## Test Types

**Unit Tests:**
- Scope: single function or component in isolation
- Approach: call function with known inputs, assert output
- Example: `normalizeNightDetailStops()` normalizes 3 input shapes consistently
- No external services (mocked if needed); jsdom for React
- Fast: 1–10ms per test

**Integration Tests:**
- Scope: multiple functions/layers working together
- Approach: test data flow through a feature (e.g., seed data, make offer, check email sent)
- May use real local Supabase DB (vitest integration tests) or real test users (Playwright E2E)
- 100–500ms per test

**E2E Tests:**
- Scope: full user journey in browser
- Framework: Playwright (`@playwright/test`)
- Approach: spawn two browser contexts (host + candidate), drive UI interactions, assert side effects
- Config: `apps/web/playwright.config.ts`
- Test match: `/(5b-|chat-|m5-|m2-|m3-|route-).*\.spec\.ts$/` (naming convention filters test files)
- Serial execution: `fullyParallel: false`, `workers: 1` (shared DB state across contexts)
- Run: `cd apps/web && npx playwright test` or `pnpm test:e2e` (command TBD in repo)

**E2E Setup:**
```typescript
// apps/web/e2e/5b-happy-path.spec.ts
import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './_helpers/auth';
import { seedTwoUsersAndNight, cleanup, type SeedResult } from './_helpers/seed';

let seed: SeedResult;

test.beforeAll(async () => {
  seed = await seedTwoUsersAndNight();  // One-time setup for all tests in this file
});

test.afterAll(async () => {
  if (seed) await cleanup(seed);  // Teardown
});

test('5b happy path: swipe → shortlist → offer → accept → reveal', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const candContext = await browser.newContext();
  
  const hostPage = await loginAs(hostContext, seed.hostEmail);
  const candPage = await loginAs(candContext, seed.candEmail);
  
  // Candidate swipes right
  await candPage.goto('/feed');
  const likeBtn = candPage.getByRole('button', { name: /interested/i });
  await expect(likeBtn).toBeVisible({ timeout: 20_000 });
  await likeBtn.click();
  
  // Host shortlists candidate
  await hostPage.goto(`/dates/${seed.instanceId}/interested`);
  const shortlistBtn = hostPage.getByRole('button', { name: /add .* to shortlist/i }).first();
  await expect(shortlistBtn).toBeVisible({ timeout: 20_000 });
  await shortlistBtn.click();
  
  // ... continue the flow
});
```

## Common Patterns

**Async Testing:**
```typescript
// Vitest async test
it('resolves the offer after host sends it', async () => {
  const result = await makeOffer('instance-id', 'candidate-id');
  expect(result.kind).toBe('offer');
  expect(result.offer_id).toBeTruthy();
});

// Playwright async navigation
await page.goto('/feed');
await expect(page.getByRole('button', { name: /interested/i })).toBeVisible({ timeout: 20_000 });
```

**Error Testing:**
```typescript
// Vitest: error thrown
it('throws MatchError when offer already active', async () => {
  await expect(makeOffer('instance', 'candidate')).rejects.toThrow(MatchError);
});

// Playwright: error message in UI
await expect(page.getByText(/you already have an offer out/i)).toBeVisible();
```

**Edge Function Testing (Deno):**
```typescript
// supabase/functions/_shared/match.test.ts
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';

Deno.test('OPTIONS preflight -> 200 with CORS headers', async () => {
  setEnv();
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('missing Authorization header -> 401 auth_mismatch', async () => {
  setEnv();
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'POST', body: '{}' }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.code, 'auth_mismatch');
});
```

## Accessibility Testing

**Tool:** jest-axe (integrated in Vitest setup)

**Pattern:**
```typescript
// apps/web/components/__tests__/notif-a11y.test.tsx
import { render } from '@testing-library/react';
import { expect } from 'vitest';

it('passes accessibility audit (axe)', async () => {
  const { container } = render(<NotificationToast userId="test" />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

**When to Test:**
- All interactive components (modals, buttons, forms)
- Heading hierarchy and ARIA labels
- Color contrast (should pass WCAG AA)
- Keyboard navigation in Playwright tests

## CI/CD Gates

**Vitest Tests:**
- Run on every commit (pre-commit hook or CI pipeline)
- Must pass before merging to main
- Command: `pnpm test` (all packages + web)

**Playwright E2E Tests:**
- Run in CI after Vitest passes
- Environment: spawned Next.js dev server + local Supabase stack
- Env vars overridden: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` (local stack)
- Retries in CI: 1 retry on failure
- Artifacts: HTML report, screenshots on failure, videos on failure

**Type Check:**
- `pnpm typecheck` runs `tsc --noEmit` in all packages
- Must pass before deploying

---

*Testing analysis: 2026-06-03*

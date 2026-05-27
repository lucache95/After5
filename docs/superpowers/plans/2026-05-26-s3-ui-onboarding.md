# S3-UI — Onboarding / Profile / Verification UI + First-Session Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This slice is the **UI half of S3**. It builds on the **already-merged S3 backend** (migrations `122xxx`, Edge Functions `start-verification` / `confirm-phone` / `persona-webhook` / `generate-blur`, and the `@after5/{validators,business,api-client}` profile/verification surface). **Do NOT recreate or re-migrate any backend object** — consume it. The ONE backend change in this slice is a single notification dispatch added to `supabase/functions/persona-webhook/index.ts` (Task 12).

**Goal:** Ship After5's first user-facing app screens — a guided 7-step onboarding wizard (welcome/age-gate → basics → photo → preferences → phone-verify → identity-verify → done) on top of the merged backend, PLUS a post-onboarding **first-session home** (the experience-teaser landing) that drops the user into the product's emotional loop. Success is not "account completed"; it is "the user understands the product, feels momentum, and knows what's next." The flow is **server-state-as-truth**: every step persists immediately, and a server-side **resume guard** reconstructs position on every visit so closing the tab never loses progress.

**Architecture:** Next.js App Router route group `app/onboarding/` whose `layout.tsx` is the **resume guard** — a server component that fetches `profiles.{onboarding_step, verification, dating_enabled}` via the SSR server client (`@/lib/supabase/server`) and routes: `onboarding_step !== 'done'` → render the wizard positioned at the correct step; `onboarding_step === 'done'` → the first-session home. An `OnboardingShell` (client) provides the wizard chrome (progress bar + step container — presentation **pattern C**: linear wizard with a dedicated verification status screen). Each step is a `'use client'` component that persists its data through a shared, typed `@after5/api-client` access layer (`@/lib/after5/client` — the browser SSR client cast to `After5Client`), then calls `advanceOnboarding(step)` (forward-only RPC) and routes forward. Identity verification uses the **Persona embedded SDK** (CDN `persona-v5` script, themed) constructed from the `{ inquiryId, sessionToken }` returned by `startVerification`; the verdict is owned by the webhook (the client never self-certifies), so `onComplete` advances to a `VerificationStatus` screen that polls `getMyBadge` / the profile `verification` column. The first-session home reconstructs its state (verified / pending / failed / dating-off) from server state on every visit and surfaces a read-only teaser gallery reusing existing `itineraries` content.

**Tech Stack:** Next.js 15 App Router (React 19, server + client components); `@supabase/ssr` (`createServerClient` / `createBrowserClient<Database>`, already wrapped in `apps/web/lib/supabase/{server,client}.ts`); `@after5/api-client` (`After5Client = SupabaseClient<Database>`, helpers already merged); `@after5/validators` (Zod: `ProfileInputSchema`, `PreferencesInputSchema`, `OnboardingStepSchema`, `GenderSchema`, `DealbreakerSchema`, `PROMPT_IDS`); `@after5/business` (`badgeFor`, `canEnableDating`); Tailwind "Refined Minimal" tokens (`background #FDF9F3`, `surface #F4ECDD`, `accent #C2552B`, Inter, 8px radius — `apps/web/tailwind.config.ts`); `cn()` (`@/lib/cn`); `lucide-react` icons; Persona web SDK v5 via CDN `<Script>`; Supabase Auth phone OTP (`signInWithOtp` / `verifyOtp`); **vitest + jsdom + @testing-library/react** for component tests (a new `apps/web` vitest project added in Task 0); Deno `Deno.test` for the one webhook change.

**Source documents:**
- Approved design spec (source of truth): `docs/superpowers/specs/2026-05-26-s3-ui-onboarding-design.md`
- Format/quality reference plan: `docs/superpowers/plans/2026-05-25-p1-identity-profile.md`

**Depends on (already merged to `main`, do NOT recreate):**
- Migrations: `profiles.{onboarding_step, onboarding_completed_at, verification, dating_enabled, age, first_name, vibe_tags, prompt_answers, dealbreakers, gender, gender_preferences, age_pref, distance_pref_km, blurred_photo_url, reliability_score, primary_city_id}`; `profiles_private.{bio, birthdate(service-role-write)}`; `profile_prompts`; `verifications`; `public_profile_card` view; `advance_onboarding_step(p_to_step text)` RPC; the age-gate + rollup triggers; `profile-photos` storage bucket (`<uid>/clear.jpg` owner-write, `<uid>/blurred.jpg` authenticated-read); `notification_type` enum (already includes `verification_passed`, `verification_failed`); `dispatch_notification(p_user, p_type, p_payload)`; `register_device(p_token, p_platform, p_web_push)`.
- Edge Functions: `start-verification` (returns `{ inquiryId, sessionToken }`), `confirm-phone`, `persona-webhook` (`handler` export, dispatches `verification_failed` on fail only — Task 12 adds `verification_passed`), `generate-blur` (reads `<uid>/clear.jpg`, writes `<uid>/blurred.jpg` + `profiles.blurred_photo_url`).
- Packages: `@after5/api-client` helpers `getMyProfile`, `upsertProfile(client, userId, patch)`, `savePreferences(client, userId, {gender, gender_preferences, age_min, age_max, distance_pref_km, dealbreakers})`, `getMyBadge`, `startVerification`, `confirmPhone`, `advanceOnboarding`, `registerDevice`; `@after5/validators`; `@after5/business`.

**Reconciliation notes (read before writing code):**
- The web app does **not** currently consume `@after5/api-client` (it calls `@/lib/supabase/*` directly). Task 2 standardizes a single typed accessor `@/lib/after5/client` (browser SSR client → `After5Client`) so every step uses the merged helpers, not hand-rolled queries.
- The root `vitest.config.ts` pins `root: import.meta.dirname` and `include: ['packages/*/src/**/*.test.ts', ...]` with `environment: 'node'`. Task 0 converts the runner to a **vitest workspace** (`vitest.workspace.ts`) with two projects: the existing node packages project (unchanged behavior) and a new jsdom `apps/web` project — this also makes the merged `apps/web/app/api/cron/process-jobs/route.test.ts` run.
- `apps/web/tsconfig.json` excludes `**/*.test.ts(x)` from `tsc` — **keep that exclude**; component tests are run by vitest, not typechecked by `next build`.
- Persona embedded: `startVerification` already returns `{ inquiryId, sessionToken }`. The embedded client resumes that inquiry (`{ inquiryId, sessionToken, onComplete, onCancel, onError }`). The verdict is the webhook's; `onComplete` only advances the UI to the status screen.
- The webhook today fires `dispatch_notification(refId, 'verification_failed', …)` only when `rows[0].state === 'failed'`. Task 12 adds a `verification_passed` dispatch on `name === 'inquiry.approved'`. The enum value already exists.
- The teaser gallery reuses the `itineraries` table (`is_public = true`) — the same source `app/dates/page.tsx` and `app/account/page.tsx` read. No new content system.

---

## File Structure

```
vitest.workspace.ts                                           # NEW root workspace: node(packages) + jsdom(apps/web) projects
vitest.config.ts                                              # KEPT, referenced by the node project (unchanged include/exclude)
apps/web/vitest.config.ts                                     # NEW jsdom project config for apps/web component+route tests
apps/web/vitest.setup.ts                                      # NEW: imports @testing-library/jest-dom matchers
package.json                                                  # MODIFY: devDeps (jsdom, @testing-library/*, @vitejs/plugin-react)

apps/web/lib/
  after5/
    client.ts                                                # NEW: browserAfter5Client() — @supabase/ssr browser client typed as After5Client
  onboarding/
    steps.ts                                                 # NEW: ONBOARDING_STEPS order, next-step + resume-route helpers (pure)
    teaser.ts                                                 # NEW: pure mappers — itinerary row → teaser card; verification → home state

apps/web/app/onboarding/
  layout.tsx                                                 # NEW: RESUME GUARD (server) — fetch profile, route to step or home
  page.tsx                                                   # NEW: server entry — redirects to the resume guard's chosen step route
  OnboardingShell.tsx                                        # NEW: client wizard chrome (progress bar + step container)
  ProgressBar.tsx                                            # NEW: client step progress indicator
  welcome/page.tsx                                           # NEW: step route → <WelcomeAgeGate/>
  basics/page.tsx                                            # NEW: step route → <BasicsStep/>  (server hydrates initial profile)
  photo/page.tsx                                             # NEW: step route → <PhotoStep/>
  preferences/page.tsx                                       # NEW: step route → <PreferencesStep/> (server hydrates initial prefs)
  phone/page.tsx                                             # NEW: step route → <PhoneVerifyStep/>
  verify/page.tsx                                            # NEW: step route → <IdentityVerifyStep/> + <VerificationStatus/>
  done/page.tsx                                              # NEW: step route → <DoneStep/>
  steps/
    WelcomeAgeGate.tsx                                       # NEW: client — intro + confirm 18+ → advanceOnboarding('basics')
    BasicsStep.tsx                                           # NEW: client — first name/bio/prompts/vibe tags → upsertProfile
    PhotoStep.tsx                                            # NEW: client — upload clear.jpg + invoke generate-blur
    PreferencesStep.tsx                                      # NEW: client — gender/who/age/distance/dealbreakers → savePreferences
    PhoneVerifyStep.tsx                                      # NEW: client — signInWithOtp → verifyOtp → confirmPhone
    IdentityVerifyStep.tsx                                   # NEW: client — startVerification + Persona embedded SDK
    VerificationStatus.tsx                                   # NEW: client — polls getMyBadge/verification: pending/verified/failed
    DoneStep.tsx                                             # NEW: client — Verified·New badge + "turn dating on" → routes to /home
    PersonaEmbed.tsx                                         # NEW: client — loads persona-v5 CDN script, runs inquiry, fires callbacks

apps/web/app/home/
  page.tsx                                                   # NEW: FirstSessionHome (server) — state from server, teaser gallery
  HomeStateBanner.tsx                                        # NEW: client — pending/failed/dating-off banner + primary action
  TeaserGallery.tsx                                          # NEW: client/server — read-only itinerary teaser cards
  MechanicExplainer.tsx                                      # NEW: "how After5 works" one-beat explainer
  EnableDatingButton.tsx                                     # NEW: client — re-offers "turn dating on" (age-gate guarded)
  RegisterDeviceOnLoad.tsx                                   # NEW: client — registerDevice() once on first home load

apps/web/app/onboarding/steps/__tests__/
  steps.helpers.test.ts                                      # Task 1  — pure step-order/resume-route helpers
  WelcomeAgeGate.test.tsx                                    # Task 3
  BasicsStep.test.tsx                                        # Task 4
  PhotoStep.test.tsx                                         # Task 5
  PreferencesStep.test.tsx                                   # Task 6
  PhoneVerifyStep.test.tsx                                   # Task 7
  IdentityVerifyStep.test.tsx                                # Task 8
  VerificationStatus.test.tsx                                # Task 10
apps/web/app/home/__tests__/
  teaser.test.ts                                             # Task 11 — pure home-state + card mappers
  FirstSessionHome.state.test.tsx                            # Task 11 — state selection + primary action rendering

supabase/functions/persona-webhook/
  index.ts                                                   # MODIFY (Task 12): add verification_passed dispatch on inquiry.approved
  index_test.ts                                              # MODIFY (Task 12): assert mapNotification(name) mapping
```

**Test-loop conventions:**
- **Web components / route tests (jsdom):** `pnpm --filter @after5/web test` (or `pnpm test` for the whole workspace). A passing assertion exits 0.
- **Pure helpers (node, packages OR apps/web jsdom project):** same vitest workspace.
- **Deno (webhook):** `deno test --allow-env --allow-net supabase/functions/persona-webhook/`.
- **Typecheck:** `pnpm --filter @after5/web typecheck` (`tsc --noEmit`; excludes `*.test.ts(x)`). **Lint:** `pnpm --filter @after5/web lint`.

---

## Task 0: Add an `apps/web` jsdom vitest project (workspace)

The merged root `vitest.config.ts` is scoped to `packages/*` (node env) and there is no runner for `apps/web` (so the merged `apps/web/app/api/cron/process-jobs/route.test.ts` never runs). This task introduces a vitest **workspace** with two projects — the existing node packages project (behavior unchanged) and a new jsdom project for `apps/web/**/*.test.{ts,tsx}` — proving it by making the existing route test pass.

**Files:**
- Create: `vitest.workspace.ts` (root)
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/vitest.setup.ts`
- Modify: `package.json` (root devDeps)

- [ ] **Step 1: Run the existing web test, expect FAIL (no runner picks it up)**

Run: `pnpm test -- apps/web/app/api/cron/process-jobs/route.test.ts`
Expected: FAIL — vitest reports `No test files found` (the root config's `include` only matches `packages/*`, so the route test is invisible).

- [ ] **Step 2: Install the jsdom test dependencies**

Run (root):
```bash
pnpm add -D -w jsdom@^25.0.1 @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.3 @testing-library/user-event@^14.5.2 @vitejs/plugin-react@^4.3.4
```

- [ ] **Step 3: Create the workspace + the apps/web jsdom project**

`vitest.workspace.ts` (root) — two projects; the node project reuses the existing config file, the web project lives under `apps/web`:
```ts
// vitest.workspace.ts — two projects: node (packages/*) + jsdom (apps/web).
// The node project keeps the existing root vitest.config.ts behavior unchanged;
// the web project adds jsdom so component + route tests under apps/web can run.
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './vitest.config.ts',        // node env — packages/*/src/**/*.test.ts (unchanged)
  './apps/web/vitest.config.ts', // jsdom env — apps/web/**/*.test.{ts,tsx}
]);
```

`apps/web/vitest.config.ts` — jsdom, React plugin, the `@/*` path alias mirrored from `apps/web/tsconfig.json`:
```ts
// apps/web/vitest.config.ts — jsdom project for web component + route tests.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" → apps/web/* path alias so test imports resolve.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '.next/**'],
    passWithNoTests: false,
  },
});
```

`apps/web/vitest.setup.ts` — jest-dom matchers (`toBeInTheDocument`, `toBeDisabled`, …):
```ts
// apps/web/vitest.setup.ts — register @testing-library/jest-dom matchers.
import '@testing-library/jest-dom/vitest';
```

Add a `test` script to `apps/web/package.json` (so `pnpm --filter @after5/web test` and turbo can target it). Insert after the existing `"typecheck"` line:
```json
    "typecheck": "tsc --noEmit",
    "test": "vitest run --project web"
```

- [ ] **Step 4: Run the existing route test through the new project, expect PASS**

Run: `pnpm --filter @after5/web test`
Expected: PASS — `route.test.ts` runs in the jsdom project: `2 passed` ("rejects when CRON_SECRET is wrong", "invokes the process-jobs edge function with the runner secret").

Also confirm the node project is unbroken:
Run: `pnpm test`
Expected: PASS — both projects run; `packages/*` suites (validators/business/api-client) and the web route test all green.

- [ ] **Step 5: Commit**

```bash
git add vitest.workspace.ts apps/web/vitest.config.ts apps/web/vitest.setup.ts \
  apps/web/package.json package.json pnpm-lock.yaml
git commit -m "S3-UI: add apps/web jsdom vitest project (workspace) — runs web component + route tests"
```

---

## Task 1: Onboarding route group + resume-guard layout + step-order helpers + OnboardingShell/progress

Establish the wizard skeleton: the pure step-order helpers (tested in node/jsdom), the **resume guard** (`app/onboarding/layout.tsx`, server) that reads server state and routes, the `OnboardingShell` chrome, and the `ProgressBar`. The step routes render placeholder shells that later tasks fill with real step components.

**Files:**
- Create: `apps/web/lib/onboarding/steps.ts`
- Create (test): `apps/web/app/onboarding/steps/__tests__/steps.helpers.test.ts`
- Create: `apps/web/app/onboarding/layout.tsx`
- Create: `apps/web/app/onboarding/page.tsx`
- Create: `apps/web/app/onboarding/OnboardingShell.tsx`
- Create: `apps/web/app/onboarding/ProgressBar.tsx`

- [ ] **Step 1: Write the failing test (pure step helpers)**

```ts
// apps/web/app/onboarding/steps/__tests__/steps.helpers.test.ts
import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS,
  STEP_ROUTE,
  routeForStep,
  nextStep,
  stepIndex,
} from '@/lib/onboarding/steps';

describe('onboarding step helpers', () => {
  it('lists the seven backend steps in forward order', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'age_gate', 'basics', 'photos', 'preferences', 'phone_verify', 'selfie_verify', 'done',
    ]);
  });

  it('maps each step to its wizard route', () => {
    expect(STEP_ROUTE.age_gate).toBe('/onboarding/welcome');
    expect(STEP_ROUTE.basics).toBe('/onboarding/basics');
    expect(STEP_ROUTE.photos).toBe('/onboarding/photo');
    expect(STEP_ROUTE.preferences).toBe('/onboarding/preferences');
    expect(STEP_ROUTE.phone_verify).toBe('/onboarding/phone');
    expect(STEP_ROUTE.selfie_verify).toBe('/onboarding/verify');
    expect(STEP_ROUTE.done).toBe('/home');
  });

  it('routeForStep routes done to the first-session home', () => {
    expect(routeForStep('done')).toBe('/home');
    expect(routeForStep('age_gate')).toBe('/onboarding/welcome');
  });

  it('nextStep returns the following step, and null past done', () => {
    expect(nextStep('age_gate')).toBe('basics');
    expect(nextStep('selfie_verify')).toBe('done');
    expect(nextStep('done')).toBeNull();
  });

  it('stepIndex gives a 1-based position for the progress bar (done excluded)', () => {
    expect(stepIndex('age_gate')).toBe(1);
    expect(stepIndex('selfie_verify')).toBe(6);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- steps.helpers`
Expected: FAIL — `Cannot find module '@/lib/onboarding/steps'`.

- [ ] **Step 3: Implement the helpers, guard layout, shell, progress bar, step routes**

```ts
// apps/web/lib/onboarding/steps.ts
// Pure onboarding step-order + routing helpers. Mirrors the backend
// advance_onboarding_step sequence (validators OnboardingStepSchema). NO I/O.
import type { OnboardingStep } from '@after5/validators';

export const ONBOARDING_STEPS: OnboardingStep[] = [
  'age_gate', 'basics', 'photos', 'preferences', 'phone_verify', 'selfie_verify', 'done',
];

// Each backend step → the wizard route that renders it. `done` is not a wizard
// screen; it routes to the first-session home (the post-onboarding destination).
export const STEP_ROUTE: Record<OnboardingStep, string> = {
  age_gate: '/onboarding/welcome',
  basics: '/onboarding/basics',
  photos: '/onboarding/photo',
  preferences: '/onboarding/preferences',
  phone_verify: '/onboarding/phone',
  selfie_verify: '/onboarding/verify',
  done: '/home',
};

export function routeForStep(step: OnboardingStep): string {
  return STEP_ROUTE[step];
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step);
  if (i < 0 || i >= ONBOARDING_STEPS.length - 1) return null;
  return ONBOARDING_STEPS[i + 1];
}

// 1-based position for the progress bar. `done` is not shown in the bar.
export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step) + 1;
}

// Steps shown in the progress bar (everything before `done`).
export const WIZARD_STEP_COUNT = ONBOARDING_STEPS.length - 1; // 6
```

```tsx
// apps/web/app/onboarding/layout.tsx
// RESUME GUARD (server). Server state is the single source of truth: on every
// entry to /onboarding/* we fetch the caller's onboarding_step and route them to
// the matching step (or the first-session home when done). No client-side
// progress storage — closing the tab never loses progress.
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { routeForStep } from '@/lib/onboarding/steps';
import type { OnboardingStep } from '@after5/validators';

export const dynamic = 'force-dynamic';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_step')
    .eq('id', user.id)
    .maybeSingle();

  const step = (profile?.onboarding_step ?? 'age_gate') as OnboardingStep;

  // If the user has finished onboarding, /onboarding/* must bounce to the home.
  if (step === 'done') redirect('/home');

  // Enforce the server-truth position: if the requested route is not the route
  // for the server's current step, redirect to the correct step. The pathname
  // comes from the x-pathname header set by middleware-free Next via headers().
  const pathname = (await headers()).get('x-invoke-path') ?? '';
  const expected = routeForStep(step);
  if (pathname && pathname.startsWith('/onboarding') && pathname !== expected) {
    redirect(expected);
  }

  return <>{children}</>;
}
```

> Note: Next.js does not expose the pathname to a layout reliably via `headers()` alone. The deterministic guard runs in **`app/onboarding/page.tsx`** (the route-group index) — the layout above renders children and bounces only the `done` case. Each step route additionally calls a server-side `assertStep()` (defined in Task 2's accessor module) is **not** required; instead the index page below is the single redirect authority for "land on the right step," and each step page re-reads server state on entry (idempotent — re-entering a completed step shows saved data). Keep the layout's `done → /home` bounce; do all "which step" routing in `page.tsx`:

```tsx
// apps/web/app/onboarding/page.tsx
// Onboarding entry. Reads server state and redirects to the correct step route.
// This is the single authority for "land on the right step on every open."
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { routeForStep } from '@/lib/onboarding/steps';
import type { OnboardingStep } from '@after5/validators';

export const dynamic = 'force-dynamic';

export default async function OnboardingIndex() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_step')
    .eq('id', user.id)
    .maybeSingle();

  const step = (profile?.onboarding_step ?? 'age_gate') as OnboardingStep;
  redirect(routeForStep(step));
}
```

```tsx
// apps/web/app/onboarding/ProgressBar.tsx
'use client';
import { cn } from '@/lib/cn';
import { WIZARD_STEP_COUNT } from '@/lib/onboarding/steps';

// Linear wizard progress (pattern C). `current` is 1-based; `done` step is not shown.
export function ProgressBar({ current }: { current: number }) {
  const pct = Math.round((Math.min(current, WIZARD_STEP_COUNT) / WIZARD_STEP_COUNT) * 100);
  return (
    <div className="w-full" role="progressbar" aria-valuemin={1} aria-valuemax={WIZARD_STEP_COUNT} aria-valuenow={current}>
      <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
        <span>Set up your profile</span>
        <span className="[font-variant-numeric:tabular-nums]">Step {Math.min(current, WIZARD_STEP_COUNT)} of {WIZARD_STEP_COUNT}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

```tsx
// apps/web/app/onboarding/OnboardingShell.tsx
'use client';
// Wizard chrome (pattern C). Wraps each step in the cream canvas with a header,
// progress bar, and a centered max-width card. `step` is the 1-based position.
import Link from 'next/link';
import { ProgressBar } from './ProgressBar';

export function OnboardingShell({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">After5</Link>
        </nav>
      </header>
      <div className="mx-auto max-w-xl px-6 pb-24 pt-10 md:pt-14">
        <ProgressBar current={step} />
        <div className="mt-8 rounded-card border border-border bg-white/70 p-6 shadow-subtle backdrop-blur-md md:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
```

Create the seven step route files as thin servers that wrap the (Task 3–10) client components in the shell. For Task 1, create them rendering a labelled placeholder so the routes resolve; later tasks replace the placeholder body with the real component import. Example for `welcome` (repeat the pattern for `basics`, `photo`, `preferences`, `phone`, `verify`, `done` with their `step` numbers 1–7 and matching labels):

```tsx
// apps/web/app/onboarding/welcome/page.tsx
import { OnboardingShell } from '../OnboardingShell';

export const dynamic = 'force-dynamic';

export default function WelcomePage() {
  // Replaced in Task 3 with <WelcomeAgeGate/>.
  return <OnboardingShell step={1}><p>welcome</p></OnboardingShell>;
}
```

Create the analogous files: `basics/page.tsx` (step 2), `photo/page.tsx` (step 3), `preferences/page.tsx` (step 4), `phone/page.tsx` (step 5), `verify/page.tsx` (step 6), `done/page.tsx` (step 7).

- [ ] **Step 4: Run the helper test, expect PASS**

Run: `pnpm --filter @after5/web test -- steps.helpers`
Expected: PASS — all five `onboarding step helpers` cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/onboarding/steps.ts \
  apps/web/app/onboarding/steps/__tests__/steps.helpers.test.ts \
  apps/web/app/onboarding/layout.tsx apps/web/app/onboarding/page.tsx \
  apps/web/app/onboarding/OnboardingShell.tsx apps/web/app/onboarding/ProgressBar.tsx \
  apps/web/app/onboarding/welcome/page.tsx apps/web/app/onboarding/basics/page.tsx \
  apps/web/app/onboarding/photo/page.tsx apps/web/app/onboarding/preferences/page.tsx \
  apps/web/app/onboarding/phone/page.tsx apps/web/app/onboarding/verify/page.tsx \
  apps/web/app/onboarding/done/page.tsx
git commit -m "S3-UI: onboarding route group + resume-guard + step-order helpers + OnboardingShell/progress"
```

---

## Task 2: Shared typed api-client access for the web app

The web app does not yet consume `@after5/api-client`. Standardize a single browser accessor: the `@supabase/ssr` browser client, typed as `After5Client` so every step calls the merged helpers (`upsertProfile`, `savePreferences`, `advanceOnboarding`, …) instead of hand-rolling queries. This is the seam all client steps import.

**Files:**
- Create: `apps/web/lib/after5/client.ts`
- Create (test): `apps/web/lib/after5/__tests__/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/after5/__tests__/client.test.ts
import { describe, it, expect, vi } from 'vitest';

// The browser SSR client is created by @/lib/supabase/client; browserAfter5Client
// must return exactly that instance, typed as After5Client (no second client).
vi.mock('@/lib/supabase/client', () => {
  const fake = { __brand: 'browser-ssr-client', from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() }, auth: {} };
  return { createClient: vi.fn(() => fake) };
});

describe('browserAfter5Client', () => {
  it('returns the @supabase/ssr browser client (no separate client constructed)', async () => {
    const { browserAfter5Client } = await import('../client');
    const { createClient } = await import('@/lib/supabase/client');
    const c = browserAfter5Client();
    expect((c as unknown as { __brand: string }).__brand).toBe('browser-ssr-client');
    expect(createClient).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- after5/__tests__/client`
Expected: FAIL — `Cannot find module '../client'`.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/after5/client.ts
// Single typed entry the onboarding/home client components use to call the merged
// @after5/api-client helpers. The @supabase/ssr browser client is a
// SupabaseClient<Database>, which IS After5Client — so we reuse it directly
// (one client, cookie-backed session shared with SSR). Import the helpers from
// '@after5/api-client' and pass this client.
'use client';
import { createClient } from '@/lib/supabase/client';
import type { After5Client } from '@after5/api-client';

export function browserAfter5Client(): After5Client {
  // createClient() returns createBrowserClient<Database>(...), structurally a
  // SupabaseClient<Database> === After5Client. No cast hole: the generic matches.
  return createClient();
}

// Convenience re-export so steps import client + helpers from one place.
export {
  getMyProfile, upsertProfile, savePreferences, getMyBadge,
  startVerification, confirmPhone, advanceOnboarding, registerDevice,
} from '@after5/api-client';
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- after5/__tests__/client`
Expected: PASS — `browserAfter5Client` returns the mocked browser client.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/after5/client.ts apps/web/lib/after5/__tests__/client.test.ts
git commit -m "S3-UI: shared typed @after5/api-client accessor for the web app (browserAfter5Client)"
```

---

## Task 3: Step 1 — WelcomeAgeGate

Intro + confirm 18+ (real DOB proof comes from the ID scan later). On confirm: `advanceOnboarding('basics')` then route to `/onboarding/basics`. States: loading (submitting), error (network failure on advance) + retry, success (route forward), cancel (back to `/`). The 18+ checkbox is the gate to enabling the primary button.

**Files:**
- Create: `apps/web/app/onboarding/steps/WelcomeAgeGate.tsx`
- Modify: `apps/web/app/onboarding/welcome/page.tsx`
- Create (test): `apps/web/app/onboarding/steps/__tests__/WelcomeAgeGate.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/WelcomeAgeGate.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const advanceOnboarding = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { WelcomeAgeGate } from '../WelcomeAgeGate';

beforeEach(() => { push.mockReset(); advanceOnboarding.mockReset(); });

describe('WelcomeAgeGate', () => {
  it('disables continue until 18+ is confirmed (empty/guard state)', () => {
    render(<WelcomeAgeGate />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('success: confirming 18+ advances and routes to basics', async () => {
    advanceOnboarding.mockResolvedValue('basics');
    render(<WelcomeAgeGate />);
    await userEvent.click(screen.getByLabelText(/i am 18 or older/i));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'basics'));
    expect(push).toHaveBeenCalledWith('/onboarding/basics');
  });

  it('error + retry: failed advance shows an error and a retry that re-calls', async () => {
    advanceOnboarding.mockRejectedValueOnce(new Error('network'));
    render(<WelcomeAgeGate />);
    await userEvent.click(screen.getByLabelText(/i am 18 or older/i));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t|try again|network/i));
    advanceOnboarding.mockResolvedValueOnce('basics');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/basics'));
  });

  it('loading: shows a submitting state while advancing', async () => {
    let resolve!: (v: string) => void;
    advanceOnboarding.mockReturnValue(new Promise<string>((r) => { resolve = r; }));
    render(<WelcomeAgeGate />);
    await userEvent.click(screen.getByLabelText(/i am 18 or older/i));
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByRole('button', { name: /continuing/i })).toBeDisabled();
    resolve('basics');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- WelcomeAgeGate`
Expected: FAIL — `Cannot find module '../WelcomeAgeGate'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/onboarding/steps/WelcomeAgeGate.tsx
'use client';
// Step 1 (age_gate): intro + confirm 18+. Real DOB proof is the later ID scan;
// this is the entry gate. On confirm: advanceOnboarding('basics') → route forward.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';

export function WelcomeAgeGate() {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');

  async function handleContinue() {
    setPhase('submitting');
    try {
      await advanceOnboarding(browserAfter5Client(), 'basics');
      router.push('/onboarding/basics');
    } catch {
      setPhase('error');
    }
  }

  return (
    <div>
      <div className="mb-5 inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-1.5 text-[11px] font-semibold tracking-wide text-accent">
        <Sparkles className="h-3.5 w-3.5" /> Welcome to After5 dating
      </div>
      <h1 className="font-display text-2xl font-bold leading-tight text-text md:text-3xl">
        Real people. Real Kelowna nights.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-secondary">
        After5 matches you around an actual experience — not endless swiping. We verify everyone, so the
        person you meet is who they say they are. Let&apos;s set up your profile.
      </p>

      <label className="mt-7 flex items-start gap-3 text-sm text-text">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-border text-accent focus:ring-accent"
        />
        <span>I am 18 or older.</span>
      </label>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
          We couldn&apos;t save that. Check your connection and try again.
        </div>
      )}

      <div className="mt-7 flex items-center gap-4">
        <button
          type="button"
          onClick={handleContinue}
          disabled={!confirmed || phase === 'submitting'}
          className={cn(
            'inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
            !confirmed || phase === 'submitting'
              ? 'cursor-not-allowed bg-border text-muted'
              : 'bg-text text-background hover:-translate-y-0.5',
          )}
        >
          {phase === 'submitting' ? 'Continuing…' : phase === 'error' ? 'Try again' : 'Continue'}
        </button>
        <a href="/" className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
          Not now
        </a>
      </div>
    </div>
  );
}
```

Wire it into the route:
```tsx
// apps/web/app/onboarding/welcome/page.tsx
import { OnboardingShell } from '../OnboardingShell';
import { WelcomeAgeGate } from '../steps/WelcomeAgeGate';

export const dynamic = 'force-dynamic';

export default function WelcomePage() {
  return <OnboardingShell step={1}><WelcomeAgeGate /></OnboardingShell>;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- WelcomeAgeGate`
Expected: PASS — guard (disabled), success (advance + route), error+retry, loading cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/WelcomeAgeGate.tsx \
  apps/web/app/onboarding/welcome/page.tsx \
  apps/web/app/onboarding/steps/__tests__/WelcomeAgeGate.test.tsx
git commit -m "S3-UI: step 1 WelcomeAgeGate (18+ gate → advanceOnboarding('basics'))"
```

---

## Task 4: Step 2 — BasicsStep

First name, short bio, prompt answers, vibe tags → validate with `ProfileInputSchema` → `upsertProfile(client, userId, patch)` (writes `first_name`/`vibe_tags`/`prompt_answers` to `profiles`; bio belongs to `profiles_private`, written via the helper's patch is **not** supported by the merged freeform helper which only patches `profiles` — so the step writes bio separately through the browser client to `profiles_private`). Then `advanceOnboarding('photos')` → `/onboarding/photo`. The step is idempotent: it hydrates from `getMyProfile`. States: loading (hydrate), empty (no saved data → blank form), error (validation message + save failure retry), success (route forward).

**Files:**
- Create: `apps/web/app/onboarding/steps/BasicsStep.tsx`
- Modify: `apps/web/app/onboarding/basics/page.tsx`
- Create (test): `apps/web/app/onboarding/steps/__tests__/BasicsStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/BasicsStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const upsertProfile = vi.fn();
const advanceOnboarding = vi.fn();
const updatePrivate = vi.fn().mockResolvedValue({ error: null });
const fakeClient = {
  auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  from: vi.fn(() => ({ update: () => ({ eq: updatePrivate }) })),
};
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  upsertProfile: (...a: unknown[]) => upsertProfile(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { BasicsStep } from '../BasicsStep';

beforeEach(() => { push.mockReset(); upsertProfile.mockReset(); advanceOnboarding.mockReset(); });

describe('BasicsStep', () => {
  const initial = { first_name: '', bio: '', vibe_tags: [] as string[], prompts: [] as { prompt_id: string; answer: string }[] };

  it('empty: renders a blank form with a disabled continue (no first name yet)', () => {
    render(<BasicsStep userId="u1" initial={initial} />);
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('error: shows a validation message when first name is blank on submit attempt', async () => {
    render(<BasicsStep userId="u1" initial={{ ...initial, bio: 'hi' }} />);
    // first name still empty → button disabled is the guard; type whitespace then clear
    await userEvent.type(screen.getByLabelText(/first name/i), ' ');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('success: valid basics persist (profile + private bio) and advance to photos', async () => {
    upsertProfile.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('photos');
    render(<BasicsStep userId="u1" initial={initial} />);
    await userEvent.type(screen.getByLabelText(/first name/i), 'Lee');
    await userEvent.type(screen.getByLabelText(/bio/i), 'Coffee and trails.');
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(upsertProfile).toHaveBeenCalledWith(
      fakeClient, 'u1', expect.objectContaining({ first_name: 'Lee' }),
    ));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'photos'));
    expect(push).toHaveBeenCalledWith('/onboarding/photo');
  });

  it('retry: a failed save shows retry that re-saves and advances', async () => {
    upsertProfile.mockRejectedValueOnce(new Error('save failed'));
    render(<BasicsStep userId="u1" initial={{ ...initial, first_name: 'Lee' }} />);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    upsertProfile.mockResolvedValueOnce(undefined);
    advanceOnboarding.mockResolvedValueOnce('photos');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/photo'));
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- BasicsStep`
Expected: FAIL — `Cannot find module '../BasicsStep'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/onboarding/steps/BasicsStep.tsx
'use client';
// Step 2 (basics): first name, bio, vibe tags, prompt answers. Validates with
// ProfileInputSchema, persists via upsertProfile (profiles) + a direct write of
// bio to profiles_private, then advanceOnboarding('photos'). Idempotent — the
// server page hydrates `initial` from getMyProfile.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProfileInputSchema } from '@after5/validators';
import { cn } from '@/lib/cn';
import { browserAfter5Client, upsertProfile, advanceOnboarding } from '@/lib/after5/client';

export interface BasicsInitial {
  first_name: string;
  bio: string;
  vibe_tags: string[];
  prompts: { prompt_id: string; answer: string }[];
}

export function BasicsStep({ userId, initial }: { userId: string; initial: BasicsInitial }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initial.first_name);
  const [bio, setBio] = useState(initial.bio);
  const [tagsRaw, setTagsRaw] = useState(initial.vibe_tags.join(', '));
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const canContinue = firstName.trim().length > 0 && phase !== 'saving';

  async function handleContinue() {
    const vibe_tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
    const parsed = ProfileInputSchema.safeParse({ first_name: firstName.trim(), bio, vibe_tags, prompts: [] });
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? 'Please check your entries.');
      setPhase('error');
      return;
    }
    setPhase('saving');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      await upsertProfile(client, userId, {
        first_name: parsed.data.first_name,
        vibe_tags: parsed.data.vibe_tags,
        prompt_answers: parsed.data.prompts,
      });
      // bio is PII → profiles_private (owner-write RLS). The freeform upsertProfile
      // only patches `profiles`, so write bio directly here.
      const { error } = await client.from('profiles_private').update({ bio: parsed.data.bio }).eq('user_id', userId);
      if (error) throw error;
      await advanceOnboarding(client, 'photos');
      router.push('/onboarding/photo');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('error');
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-text">The basics</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">Just enough for someone to feel the real you.</p>

      <div className="mt-7 space-y-5">
        <div>
          <label htmlFor="first_name" className="mb-1.5 block text-sm font-medium text-text">First name</label>
          <input
            id="first_name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={40}
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
        <div>
          <label htmlFor="bio" className="mb-1.5 block text-sm font-medium text-text">Short bio</label>
          <textarea
            id="bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={4}
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
        <div>
          <label htmlFor="vibe_tags" className="mb-1.5 block text-sm font-medium text-text">Vibe tags <span className="text-muted">(comma-separated)</span></label>
          <input
            id="vibe_tags" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="trails, live music, third-wave coffee"
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          />
        </div>
      </div>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <button
        type="button" onClick={handleContinue} disabled={!canContinue}
        className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
          !canContinue ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}
      >
        {phase === 'saving' ? 'Saving…' : phase === 'error' ? 'Try again' : 'Continue'}
      </button>
    </div>
  );
}
```

Wire the server route (hydrates from `getMyProfile`):
```tsx
// apps/web/app/onboarding/basics/page.tsx
import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { BasicsStep, type BasicsInitial } from '../steps/BasicsStep';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function BasicsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const [{ data: profile }, { data: priv }] = await Promise.all([
    supabase.from('profiles').select('first_name, vibe_tags, prompt_answers').eq('id', user.id).maybeSingle(),
    supabase.from('profiles_private').select('bio').eq('user_id', user.id).maybeSingle(),
  ]);

  const initial: BasicsInitial = {
    first_name: profile?.first_name ?? '',
    bio: priv?.bio ?? '',
    vibe_tags: (profile?.vibe_tags as string[] | null) ?? [],
    prompts: (profile?.prompt_answers as { prompt_id: string; answer: string }[] | null) ?? [],
  };

  return <OnboardingShell step={2}><BasicsStep userId={user.id} initial={initial} /></OnboardingShell>;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- BasicsStep`
Expected: PASS — empty (guard), error (validation), success (persist + advance), retry cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/BasicsStep.tsx \
  apps/web/app/onboarding/basics/page.tsx \
  apps/web/app/onboarding/steps/__tests__/BasicsStep.test.tsx
git commit -m "S3-UI: step 2 BasicsStep (name/bio/vibe tags → upsertProfile + private bio → advance)"
```

---

## Task 5: Step 3 — PhotoStep

Upload a clear photo to `profile-photos/<uid>/clear.jpg` via the browser storage client, then invoke `generate-blur` (which writes `<uid>/blurred.jpg` + `profiles.blurred_photo_url`). On success: `advanceOnboarding('preferences')` → `/onboarding/preferences`. States: empty (no file chosen → upload disabled), loading (upload progress), success (preview + continue), error (upload/blur failure) + retry, replace (re-pick a file resets to empty).

**Files:**
- Create: `apps/web/app/onboarding/steps/PhotoStep.tsx`
- Modify: `apps/web/app/onboarding/photo/page.tsx`
- Create (test): `apps/web/app/onboarding/steps/__tests__/PhotoStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/PhotoStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const upload = vi.fn();
const invoke = vi.fn();
const advanceOnboarding = vi.fn();
const fakeClient = { storage: { from: () => ({ upload }) }, functions: { invoke } };
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { PhotoStep } from '../PhotoStep';

function pickFile() {
  return new File(['x'], 'me.jpg', { type: 'image/jpeg' });
}

beforeEach(() => { push.mockReset(); upload.mockReset(); invoke.mockReset(); advanceOnboarding.mockReset(); });

describe('PhotoStep', () => {
  it('empty: upload button disabled until a file is chosen', () => {
    render(<PhotoStep userId="u1" />);
    expect(screen.getByRole('button', { name: /upload/i })).toBeDisabled();
  });

  it('success: uploads clear.jpg, runs generate-blur, advances to preferences', async () => {
    upload.mockResolvedValue({ error: null });
    invoke.mockResolvedValue({ data: { ok: true, blurredPath: 'u1/blurred.jpg' }, error: null });
    advanceOnboarding.mockResolvedValue('preferences');
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(upload).toHaveBeenCalledWith('u1/clear.jpg', expect.any(File), expect.objectContaining({ upsert: true })));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('generate-blur', expect.anything()));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'preferences'));
    expect(push).toHaveBeenCalledWith('/onboarding/preferences');
  });

  it('error + retry: failed upload shows error; retry re-uploads', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'storage down' } });
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/storage down|couldn.t/i));
    upload.mockResolvedValueOnce({ error: null });
    invoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    advanceOnboarding.mockResolvedValueOnce('preferences');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/preferences'));
  });

  it('cancel/replace: picking a new file clears a prior error', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'fail' } });
    render(<PhotoStep userId="u1" />);
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    await userEvent.upload(screen.getByLabelText(/choose a photo/i), pickFile());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- PhotoStep`
Expected: FAIL — `Cannot find module '../PhotoStep'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/onboarding/steps/PhotoStep.tsx
'use client';
// Step 3 (photos): upload a clear photo → profile-photos/<uid>/clear.jpg, then
// invoke generate-blur (server produces <uid>/blurred.jpg + profiles.blurred_photo_url
// for the blind feed). On success advanceOnboarding('preferences').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ImageUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';

export function PhotoStep({ userId }: { userId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPhase('idle');
    setErrorMsg('');
  }

  async function handleUpload() {
    if (!file) return;
    setPhase('uploading');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      const { error: upErr } = await client.storage
        .from('profile-photos')
        .upload(`${userId}/clear.jpg`, file, { upsert: true, contentType: file.type || 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      const { error: blurErr } = await client.functions.invoke('generate-blur', { body: {} });
      if (blurErr) throw new Error(blurErr.message ?? 'blur_failed');
      await advanceOnboarding(client, 'preferences');
      router.push('/onboarding/preferences');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "We couldn't process that photo.");
      setPhase('error');
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-text">Add a photo</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">
        We blur it for the blind feed — your clear photo is only revealed once you both match on a night out.
      </p>

      <label htmlFor="photo" className="mt-7 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-border bg-white/60 px-6 py-10 text-center text-sm text-secondary hover:border-accent">
        <ImageUp className="h-6 w-6 text-muted" />
        <span>{file ? file.name : 'Choose a photo'}</span>
        <input id="photo" type="file" accept="image/*" onChange={onPick} className="sr-only" aria-label="Choose a photo" />
      </label>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <button
        type="button" onClick={handleUpload} disabled={!file || phase === 'uploading'}
        className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
          !file || phase === 'uploading' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}
      >
        {phase === 'uploading' ? 'Uploading…' : phase === 'error' ? 'Try again' : 'Upload & continue'}
      </button>
    </div>
  );
}
```

Wire the route:
```tsx
// apps/web/app/onboarding/photo/page.tsx
import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { PhotoStep } from '../steps/PhotoStep';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PhotoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');
  return <OnboardingShell step={3}><PhotoStep userId={user.id} /></OnboardingShell>;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- PhotoStep`
Expected: PASS — empty/loading/success/error+retry/replace cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/PhotoStep.tsx \
  apps/web/app/onboarding/photo/page.tsx \
  apps/web/app/onboarding/steps/__tests__/PhotoStep.test.tsx
git commit -m "S3-UI: step 3 PhotoStep (upload clear.jpg + generate-blur → advance)"
```

---

## Task 6: Step 4 — PreferencesStep

Gender, who you want (multi), age range (min/max), distance, dealbreakers → validate with `PreferencesInputSchema` → `savePreferences(client, userId, {gender, gender_preferences, age_min, age_max, distance_pref_km, dealbreakers})` → `advanceOnboarding('phone_verify')` → `/onboarding/phone`. Idempotent: hydrates from `getMyProfile` (parsing the `age_pref` int4range into min/max). States: loading (hydrate), error (validation: age_max < age_min, no gender_preferences) + save retry, success.

**Files:**
- Create: `apps/web/app/onboarding/steps/PreferencesStep.tsx`
- Modify: `apps/web/app/onboarding/preferences/page.tsx`
- Create (test): `apps/web/app/onboarding/steps/__tests__/PreferencesStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/PreferencesStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const savePreferences = vi.fn();
const advanceOnboarding = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  savePreferences: (...a: unknown[]) => savePreferences(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { PreferencesStep } from '../PreferencesStep';

const initial = { gender: 'woman', gender_preferences: ['man'], age_min: 25, age_max: 40, distance_pref_km: 40, dealbreakers: [] as string[] };

beforeEach(() => { push.mockReset(); savePreferences.mockReset(); advanceOnboarding.mockReset(); });

describe('PreferencesStep', () => {
  it('success: valid prefs save and advance to phone', async () => {
    savePreferences.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('phone_verify');
    render(<PreferencesStep userId="u1" initial={initial} />);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(savePreferences).toHaveBeenCalledWith(
      expect.anything(), 'u1', expect.objectContaining({ gender: 'woman', age_min: 25, age_max: 40 }),
    ));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'phone_verify'));
    expect(push).toHaveBeenCalledWith('/onboarding/phone');
  });

  it('error: age_max below age_min is rejected before any save', async () => {
    render(<PreferencesStep userId="u1" initial={{ ...initial, age_min: 40, age_max: 30 }} />);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(savePreferences).not.toHaveBeenCalled();
  });

  it('retry: a failed save shows retry that re-saves and advances', async () => {
    savePreferences.mockRejectedValueOnce(new Error('save failed'));
    render(<PreferencesStep userId="u1" initial={initial} />);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    savePreferences.mockResolvedValueOnce(undefined);
    advanceOnboarding.mockResolvedValueOnce('phone_verify');
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/onboarding/phone'));
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- PreferencesStep`
Expected: FAIL — `Cannot find module '../PreferencesStep'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/onboarding/steps/PreferencesStep.tsx
'use client';
// Step 4 (preferences): orientation + age range + distance + dealbreakers. Validates
// with PreferencesInputSchema, persists via savePreferences (writes the flat profiles
// columns the S5 pre-filter reads), then advanceOnboarding('phone_verify').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PreferencesInputSchema, GenderSchema, DealbreakerSchema } from '@after5/validators';
import { cn } from '@/lib/cn';
import { browserAfter5Client, savePreferences, advanceOnboarding } from '@/lib/after5/client';

export interface PreferencesInitial {
  gender: string;
  gender_preferences: string[];
  age_min: number;
  age_max: number;
  distance_pref_km: number;
  dealbreakers: string[];
}

const GENDERS = GenderSchema.options;        // ['woman','man','nonbinary']
const DEALBREAKERS = DealbreakerSchema.options;

export function PreferencesStep({ userId, initial }: { userId: string; initial: PreferencesInitial }) {
  const router = useRouter();
  const [gender, setGender] = useState(initial.gender || 'woman');
  const [wants, setWants] = useState<string[]>(initial.gender_preferences.length ? initial.gender_preferences : ['man']);
  const [ageMin, setAgeMin] = useState(initial.age_min || 25);
  const [ageMax, setAgeMax] = useState(initial.age_max || 40);
  const [distance, setDistance] = useState(initial.distance_pref_km || 40);
  const [dealbreakers, setDealbreakers] = useState<string[]>(initial.dealbreakers);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function toggle(list: string[], v: string, set: (n: string[]) => void) {
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  }

  async function handleContinue() {
    const candidate = { gender, gender_preferences: wants, age_min: ageMin, age_max: ageMax, distance_pref_km: distance, dealbreakers };
    const parsed = PreferencesInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrorMsg(parsed.error.issues[0]?.message ?? 'Please check your preferences.');
      setPhase('error');
      return;
    }
    setPhase('saving');
    setErrorMsg('');
    try {
      const client = browserAfter5Client();
      await savePreferences(client, userId, parsed.data);
      await advanceOnboarding(client, 'phone_verify');
      router.push('/onboarding/phone');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('error');
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-text">Who you&apos;re looking for</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">This shapes who we match you with.</p>

      <fieldset className="mt-7">
        <legend className="mb-2 text-sm font-medium text-text">I am</legend>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <button key={g} type="button" onClick={() => setGender(g)}
              className={cn('rounded-pill border px-4 py-2 text-sm capitalize',
                gender === g ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-white text-secondary')}>{g}</button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-medium text-text">Interested in</legend>
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <button key={g} type="button" onClick={() => toggle(wants, g, setWants)}
              className={cn('rounded-pill border px-4 py-2 text-sm capitalize',
                wants.includes(g) ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-white text-secondary')}>{g}</button>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <label className="text-sm font-medium text-text">Age from
          <input type="number" min={18} max={99} value={ageMin} onChange={(e) => setAgeMin(Number(e.target.value))}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-3 py-2 [font-variant-numeric:tabular-nums] focus:border-accent" />
        </label>
        <label className="text-sm font-medium text-text">Age to
          <input type="number" min={18} max={99} value={ageMax} onChange={(e) => setAgeMax(Number(e.target.value))}
            className="mt-1.5 block w-full rounded-card border border-border bg-white px-3 py-2 [font-variant-numeric:tabular-nums] focus:border-accent" />
        </label>
      </div>

      <label className="mt-6 block text-sm font-medium text-text">Within {distance} km
        <input type="range" min={1} max={150} value={distance} onChange={(e) => setDistance(Number(e.target.value))} className="mt-2 w-full accent-accent" />
      </label>

      <fieldset className="mt-6">
        <legend className="mb-2 text-sm font-medium text-text">Dealbreakers</legend>
        <div className="flex flex-wrap gap-2">
          {DEALBREAKERS.map((d) => (
            <button key={d} type="button" onClick={() => toggle(dealbreakers, d, setDealbreakers)}
              className={cn('rounded-pill border px-3 py-1.5 text-[13px]',
                dealbreakers.includes(d) ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-white text-secondary')}>{d.replace(/_/g, ' ')}</button>
          ))}
        </div>
      </fieldset>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <button type="button" onClick={handleContinue} disabled={phase === 'saving'}
        className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
          phase === 'saving' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
        {phase === 'saving' ? 'Saving…' : phase === 'error' ? 'Try again' : 'Continue'}
      </button>
    </div>
  );
}
```

Wire the route (parse `age_pref` int4range `[lo,hi)` → min/max, where canonical upper is exclusive so `age_max = upper - 1`):
```tsx
// apps/web/app/onboarding/preferences/page.tsx
import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { PreferencesStep, type PreferencesInitial } from '../steps/PreferencesStep';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// age_pref is stored canonical as '[lo,hi)' (upper exclusive). Parse to inclusive min/max.
function parseAgePref(raw: unknown): { min: number; max: number } {
  if (typeof raw !== 'string') return { min: 25, max: 40 };
  const m = raw.match(/^\[(\d+),(\d+)\)$/) ?? raw.match(/^\[(\d+),(\d+)\]$/);
  if (!m) return { min: 25, max: 40 };
  const lo = Number(m[1]); const hiRaw = Number(m[2]);
  const inclusiveHi = raw.endsWith(')') ? hiRaw - 1 : hiRaw;
  return { min: lo, max: inclusiveHi };
}

export default async function PreferencesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const { data: p } = await supabase
    .from('profiles')
    .select('gender, gender_preferences, age_pref, distance_pref_km, dealbreakers')
    .eq('id', user.id).maybeSingle();

  const age = parseAgePref(p?.age_pref);
  const initial: PreferencesInitial = {
    gender: p?.gender ?? 'woman',
    gender_preferences: (p?.gender_preferences as string[] | null) ?? ['man'],
    age_min: age.min, age_max: age.max,
    distance_pref_km: p?.distance_pref_km ?? 40,
    dealbreakers: (p?.dealbreakers as string[] | null) ?? [],
  };

  return <OnboardingShell step={4}><PreferencesStep userId={user.id} initial={initial} /></OnboardingShell>;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- PreferencesStep`
Expected: PASS — success/error(age range)/retry cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/PreferencesStep.tsx \
  apps/web/app/onboarding/preferences/page.tsx \
  apps/web/app/onboarding/steps/__tests__/PreferencesStep.test.tsx
git commit -m "S3-UI: step 4 PreferencesStep (orientation/age/distance/dealbreakers → savePreferences → advance)"
```

---

## Task 7: Step 5 — PhoneVerifyStep

Phone entry → `supabase.auth.signInWithOtp({ phone })` → code entry → `verifyOtp({ phone, token, type:'sms' })` → `confirmPhone(client)` (writes the verified phone row service-role) → `advanceOnboarding('selfie_verify')` → `/onboarding/verify`. States: empty (phone field, send disabled until valid), loading (sending OTP / verifying), success (route forward), error (invalid/expired code, send failure) + resend (cooldown), rate-limit messaging, cancel (back to edit phone).

**Files:**
- Create: `apps/web/app/onboarding/steps/PhoneVerifyStep.tsx`
- Modify: `apps/web/app/onboarding/phone/page.tsx`
- Create (test): `apps/web/app/onboarding/steps/__tests__/PhoneVerifyStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/PhoneVerifyStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const confirmPhone = vi.fn();
const advanceOnboarding = vi.fn();
const fakeClient = { auth: { signInWithOtp, verifyOtp } };
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => fakeClient,
  confirmPhone: (...a: unknown[]) => confirmPhone(...a),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));

import { PhoneVerifyStep } from '../PhoneVerifyStep';

beforeEach(() => { push.mockReset(); signInWithOtp.mockReset(); verifyOtp.mockReset(); confirmPhone.mockReset(); advanceOnboarding.mockReset(); });

describe('PhoneVerifyStep', () => {
  it('empty: send-code disabled until a phone is entered', () => {
    render(<PhoneVerifyStep />);
    expect(screen.getByRole('button', { name: /send code/i })).toBeDisabled();
  });

  it('success: send OTP → enter code → verify → confirmPhone → advance', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
    confirmPhone.mockResolvedValue(undefined);
    advanceOnboarding.mockResolvedValue('selfie_verify');
    render(<PhoneVerifyStep />);
    await userEvent.type(screen.getByLabelText(/phone/i), '+12505551234');
    await userEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+12505551234' }));
    await userEvent.type(screen.getByLabelText(/code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ phone: '+12505551234', token: '123456', type: 'sms' }));
    await waitFor(() => expect(confirmPhone).toHaveBeenCalledWith(fakeClient));
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(fakeClient, 'selfie_verify'));
    expect(push).toHaveBeenCalledWith('/onboarding/verify');
  });

  it('error: invalid/expired code surfaces a message and does not advance', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: 'Token has expired or is invalid' } });
    render(<PhoneVerifyStep />);
    await userEvent.type(screen.getByLabelText(/phone/i), '+12505551234');
    await userEvent.click(screen.getByRole('button', { name: /send code/i }));
    await userEvent.type(screen.getByLabelText(/code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/expired|invalid/i));
    expect(advanceOnboarding).not.toHaveBeenCalled();
  });

  it('rate-limit: a send rate-limit error is translated to friendly copy', async () => {
    signInWithOtp.mockResolvedValue({ error: { message: 'rate limit exceeded' } });
    render(<PhoneVerifyStep />);
    await userEvent.type(screen.getByLabelText(/phone/i), '+12505551234');
    await userEvent.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/wait|moment|too many/i));
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- PhoneVerifyStep`
Expected: FAIL — `Cannot find module '../PhoneVerifyStep'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/onboarding/steps/PhoneVerifyStep.tsx
'use client';
// Step 5 (phone_verify): Supabase Auth phone OTP. signInWithOtp → verifyOtp →
// confirmPhone (server writes the verified phone row) → advanceOnboarding('selfie_verify').
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { browserAfter5Client, confirmPhone, advanceOnboarding } from '@/lib/after5/client';

export function PhoneVerifyStep() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'enter_phone' | 'enter_code'>('enter_phone');
  const [phase, setPhase] = useState<'idle' | 'sending' | 'verifying' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  function friendly(msg: string): string {
    return /rate.?limit|too.?many|over_/i.test(msg)
      ? 'You just asked for a code. Wait a moment and try again.'
      : msg || 'Something went wrong.';
  }

  async function sendCode() {
    setPhase('sending');
    setErrorMsg('');
    const { error } = await browserAfter5Client().auth.signInWithOtp({ phone });
    if (error) { setErrorMsg(friendly(error.message)); setPhase('error'); return; }
    setStage('enter_code');
    setPhase('idle');
  }

  async function verify() {
    setPhase('verifying');
    setErrorMsg('');
    const client = browserAfter5Client();
    const { data, error } = await client.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error || !data?.session) { setErrorMsg(friendly(error?.message ?? 'That code didn’t work.')); setPhase('error'); return; }
    try {
      await confirmPhone(client);
      await advanceOnboarding(client, 'selfie_verify');
      router.push('/onboarding/verify');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'We couldn’t confirm your number.');
      setPhase('error');
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-text">Verify your phone</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">A real number keeps After5 trustworthy. We text a 6-digit code.</p>

      <div className="mt-7 space-y-4">
        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-text">Phone</label>
          <input id="phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 250 555 1234"
            disabled={stage === 'enter_code'}
            className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60" />
        </div>
        {stage === 'enter_code' && (
          <div>
            <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-text">6-digit code</label>
            <input id="code" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)}
              className="block w-full rounded-card border border-border bg-white px-4 py-3 text-[15px] tracking-[0.4em] [font-variant-numeric:tabular-nums] outline-none focus:border-accent" />
          </div>
        )}
      </div>

      {phase === 'error' && (
        <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <div className="mt-7 flex items-center gap-4">
        {stage === 'enter_phone' ? (
          <button type="button" onClick={sendCode} disabled={!phone || phase === 'sending'}
            className={cn('inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
              !phone || phase === 'sending' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
            {phase === 'sending' ? 'Sending…' : 'Send code'}
          </button>
        ) : (
          <>
            <button type="button" onClick={verify} disabled={code.length < 6 || phase === 'verifying'}
              className={cn('inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
                code.length < 6 || phase === 'verifying' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
              {phase === 'verifying' ? 'Verifying…' : 'Verify'}
            </button>
            <button type="button" onClick={() => { setStage('enter_phone'); setCode(''); setPhase('idle'); }}
              className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
              Use a different number
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

Wire the route:
```tsx
// apps/web/app/onboarding/phone/page.tsx
import { OnboardingShell } from '../OnboardingShell';
import { PhoneVerifyStep } from '../steps/PhoneVerifyStep';

export const dynamic = 'force-dynamic';

export default function PhonePage() {
  return <OnboardingShell step={5}><PhoneVerifyStep /></OnboardingShell>;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- PhoneVerifyStep`
Expected: PASS — empty/success/error(invalid code)/rate-limit cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/PhoneVerifyStep.tsx \
  apps/web/app/onboarding/phone/page.tsx \
  apps/web/app/onboarding/steps/__tests__/PhoneVerifyStep.test.tsx
git commit -m "S3-UI: step 5 PhoneVerifyStep (signInWithOtp → verifyOtp → confirmPhone → advance)"
```

---

## Task 8: Step 6a — IdentityVerifyStep (front door + start of the Persona embed)

The selfie/ID step's front-half: on "Start verification" call `startVerification(client)` (returns `{ inquiryId, sessionToken }`), then mount the Persona embed. This task builds `IdentityVerifyStep` and a thin `PersonaEmbed` client wrapper around the Persona v5 CDN script, constructed with `{ inquiryId, sessionToken }` and `onComplete`/`onCancel`/`onError`. On `onComplete` the step sets a "submitted" flag and reveals `<VerificationStatus/>` (Task 10). States: empty (pre-start CTA), loading (calling startVerification), error (network failure on startVerification) + retry, cancel (Persona onCancel → back to CTA), success (onComplete → show status). `advanceOnboarding('selfie_verify')` already happened at the end of the phone step, so this step does not advance onboarding itself; it advances to `done` only when verification reads `verified` (handled in Task 10's status screen).

**Files:**
- Create: `apps/web/app/onboarding/steps/PersonaEmbed.tsx`
- Create: `apps/web/app/onboarding/steps/IdentityVerifyStep.tsx`
- Create (test): `apps/web/app/onboarding/steps/__tests__/IdentityVerifyStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/IdentityVerifyStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const startVerification = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  startVerification: (...a: unknown[]) => startVerification(...a),
}));

// Stub the Persona embed so the test drives onComplete/onCancel without the CDN.
let lastProps: { onComplete?: () => void; onCancel?: () => void; onError?: (e: unknown) => void } = {};
vi.mock('../PersonaEmbed', () => ({
  PersonaEmbed: (props: typeof lastProps & { inquiryId: string }) => { lastProps = props; return <div data-testid="persona-embed" />; },
}));

// VerificationStatus is a separate unit (Task 10); stub it to a marker.
vi.mock('../VerificationStatus', () => ({ VerificationStatus: () => <div data-testid="verification-status" /> }));

import { IdentityVerifyStep } from '../IdentityVerifyStep';

beforeEach(() => { startVerification.mockReset(); lastProps = {}; });

describe('IdentityVerifyStep', () => {
  it('empty: shows the start CTA before any inquiry', () => {
    render(<IdentityVerifyStep />);
    expect(screen.getByRole('button', { name: /start verification/i })).toBeInTheDocument();
    expect(screen.queryByTestId('persona-embed')).not.toBeInTheDocument();
  });

  it('loading→success: startVerification mounts the embed with inquiryId+sessionToken', async () => {
    startVerification.mockResolvedValue({ inquiryId: 'inq_1', sessionToken: 'sess_1' });
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() => expect(screen.getByTestId('persona-embed')).toBeInTheDocument());
  });

  it('error + retry: a failed startVerification shows an error and retries', async () => {
    startVerification.mockRejectedValueOnce(new Error('persona_error'));
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    startVerification.mockResolvedValueOnce({ inquiryId: 'inq_2', sessionToken: 'sess_2' });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.getByTestId('persona-embed')).toBeInTheDocument());
  });

  it('complete: onComplete reveals the VerificationStatus screen', async () => {
    startVerification.mockResolvedValue({ inquiryId: 'inq_1', sessionToken: 'sess_1' });
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() => expect(lastProps.onComplete).toBeTypeOf('function'));
    lastProps.onComplete?.();
    await waitFor(() => expect(screen.getByTestId('verification-status')).toBeInTheDocument());
  });

  it('cancel: onCancel returns to the start CTA', async () => {
    startVerification.mockResolvedValue({ inquiryId: 'inq_1', sessionToken: 'sess_1' });
    render(<IdentityVerifyStep />);
    await userEvent.click(screen.getByRole('button', { name: /start verification/i }));
    await waitFor(() => expect(lastProps.onCancel).toBeTypeOf('function'));
    lastProps.onCancel?.();
    await waitFor(() => expect(screen.getByRole('button', { name: /start verification/i })).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- IdentityVerifyStep`
Expected: FAIL — `Cannot find module '../IdentityVerifyStep'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/onboarding/steps/PersonaEmbed.tsx
'use client';
// Persona embedded SDK (v5) loaded via the CDN script. Resumes the inquiry created
// by start-verification using { inquiryId, sessionToken }. The verdict is NOT decided
// here — the persona-webhook is the source of truth; onComplete only signals the
// client to move to the status screen.
import { useEffect, useRef } from 'react';
import Script from 'next/script';

interface PersonaClientCtor {
  new (opts: {
    inquiryId: string;
    sessionToken?: string;
    onComplete?: (args: { inquiryId: string; status: string }) => void;
    onCancel?: () => void;
    onError?: (error: unknown) => void;
  }): { open: () => void };
}
declare global {
  interface Window { Persona?: { Client: PersonaClientCtor } }
}

export function PersonaEmbed({
  inquiryId, sessionToken, onComplete, onCancel, onError,
}: {
  inquiryId: string;
  sessionToken?: string;
  onComplete?: () => void;
  onCancel?: () => void;
  onError?: (e: unknown) => void;
}) {
  const opened = useRef(false);

  function launch() {
    if (opened.current || !window.Persona?.Client) return;
    opened.current = true;
    const client = new window.Persona.Client({
      inquiryId,
      sessionToken,
      onComplete: () => onComplete?.(),
      onCancel: () => onCancel?.(),
      onError: (e) => onError?.(e),
    });
    client.open();
  }

  // If the script is already present (e.g. returning to the step), launch on mount.
  useEffect(() => { if (window.Persona?.Client) launch(); /* eslint-disable-next-line */ }, []);

  return (
    <>
      <Script
        src="https://cdn.withpersona.com/dist/persona-v5.1.2.js"
        strategy="afterInteractive"
        onLoad={launch}
      />
      <div aria-live="polite" className="rounded-card border border-border bg-white/60 px-4 py-6 text-center text-sm text-secondary">
        Opening secure verification…
      </div>
    </>
  );
}
```

```tsx
// apps/web/app/onboarding/steps/IdentityVerifyStep.tsx
'use client';
// Step 6 (selfie_verify): the front door + embedded capture. startVerification
// returns { inquiryId, sessionToken }; PersonaEmbed runs the government-ID + selfie
// capture; onComplete reveals VerificationStatus which reads the webhook verdict.
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, startVerification } from '@/lib/after5/client';
import { PersonaEmbed } from './PersonaEmbed';
import { VerificationStatus } from './VerificationStatus';

type Stage = 'idle' | 'starting' | 'capturing' | 'submitted' | 'error';

export function IdentityVerifyStep() {
  const [stage, setStage] = useState<Stage>('idle');
  const [inquiry, setInquiry] = useState<{ inquiryId: string; sessionToken?: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  async function start() {
    setStage('starting');
    setErrorMsg('');
    try {
      const res = await startVerification(browserAfter5Client()) as { inquiryId: string; sessionToken?: string };
      if (!res?.inquiryId) throw new Error('Verification could not start.');
      setInquiry(res);
      setStage('capturing');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Verification could not start.');
      setStage('error');
    }
  }

  if (stage === 'submitted') return <VerificationStatus />;

  return (
    <div>
      <div className="mb-5 inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-1.5 text-[11px] font-semibold tracking-wide text-accent">
        <ShieldCheck className="h-3.5 w-3.5" /> One last step
      </div>
      <h1 className="font-display text-2xl font-bold text-text">Verify it&apos;s really you</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">
        A quick government-ID + selfie scan, handled securely by Persona. This is how we keep After5 real and confirm you&apos;re 18+.
      </p>

      {stage === 'capturing' && inquiry ? (
        <div className="mt-7">
          <PersonaEmbed
            inquiryId={inquiry.inquiryId}
            sessionToken={inquiry.sessionToken}
            onComplete={() => setStage('submitted')}
            onCancel={() => { setStage('idle'); setInquiry(null); }}
            onError={(e) => { setErrorMsg(e instanceof Error ? e.message : 'Verification was interrupted.'); setStage('error'); }}
          />
        </div>
      ) : (
        <>
          {stage === 'error' && (
            <div role="alert" className="mt-5 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
          )}
          <button type="button" onClick={start} disabled={stage === 'starting'}
            className={cn('mt-7 inline-flex items-center justify-center rounded-pill px-7 py-3 text-[15px] font-medium transition-all',
              stage === 'starting' ? 'cursor-not-allowed bg-border text-muted' : 'bg-text text-background hover:-translate-y-0.5')}>
            {stage === 'starting' ? 'Starting…' : stage === 'error' ? 'Try again' : 'Start verification'}
          </button>
        </>
      )}
    </div>
  );
}
```

Wire the route (renders the step; the step internally switches to status):
```tsx
// apps/web/app/onboarding/verify/page.tsx
import { OnboardingShell } from '../OnboardingShell';
import { IdentityVerifyStep } from '../steps/IdentityVerifyStep';

export const dynamic = 'force-dynamic';

export default function VerifyPage() {
  return <OnboardingShell step={6}><IdentityVerifyStep /></OnboardingShell>;
}
```

> Note: `VerificationStatus` is imported here but implemented in Task 10. Create a minimal placeholder export now so this task compiles and tests pass (the test stubs it). Create `apps/web/app/onboarding/steps/VerificationStatus.tsx` with `export function VerificationStatus() { return null; }` as a stub; Task 10 replaces its body and adds its test.

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- IdentityVerifyStep`
Expected: PASS — empty/loading→success/error+retry/complete/cancel cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/PersonaEmbed.tsx \
  apps/web/app/onboarding/steps/IdentityVerifyStep.tsx \
  apps/web/app/onboarding/steps/VerificationStatus.tsx \
  apps/web/app/onboarding/verify/page.tsx \
  apps/web/app/onboarding/steps/__tests__/IdentityVerifyStep.test.tsx
git commit -m "S3-UI: step 6a IdentityVerifyStep + PersonaEmbed (startVerification → embedded capture)"
```

---

## Task 9: DoneStep (step 7) + dating-enable control

`done` step — reached only after verification flips to verified (Task 10 routes here). Shows the **Verified · New** badge (from `getMyBadge`), the "turn dating on" moment, and routes to `/home`. On mount it ensures `advanceOnboarding('done')` (idempotent if already done — the RPC rejects backward, so guard by reading current step first OR catch the backward error). Enabling dating calls a direct `profiles.update({ dating_enabled: true })` (the DB age-gate trigger enforces 18+). States: loading (badge fetch), success (badge shown + dating toggled), error (enable failure — surfaces the age-gate rejection) + retry, then `Enter After5` → `/home`.

**Files:**
- Create: `apps/web/app/onboarding/steps/DoneStep.tsx`
- Modify: `apps/web/app/onboarding/done/page.tsx`
- Create (test): `apps/web/app/onboarding/steps/__tests__/DoneStep.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/DoneStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const enableEq = vi.fn().mockResolvedValue({ error: null });
const fakeClient = { from: vi.fn(() => ({ update: () => ({ eq: enableEq }) })) };
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => fakeClient }));

import { DoneStep } from '../DoneStep';

beforeEach(() => { push.mockReset(); enableEq.mockClear(); });

describe('DoneStep', () => {
  it('success: shows the Verified · New badge', () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(screen.getByText(/new/i)).toBeInTheDocument();
  });

  it('success: turning dating on writes dating_enabled then routes home', async () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    await userEvent.click(screen.getByRole('button', { name: /turn dating on/i }));
    await waitFor(() => expect(enableEq).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /enter after5/i }));
    expect(push).toHaveBeenCalledWith('/home');
  });

  it('error + retry: an enable failure (age gate) surfaces and retries', async () => {
    enableEq.mockResolvedValueOnce({ error: { message: 'age gate: must be 18+' } });
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    await userEvent.click(screen.getByRole('button', { name: /turn dating on/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/18\+/i));
    enableEq.mockResolvedValueOnce({ error: null });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- DoneStep`
Expected: FAIL — `Cannot find module '../DoneStep'`.

- [ ] **Step 3: Implement**

```tsx
// apps/web/app/onboarding/steps/DoneStep.tsx
'use client';
// Step 7 (done): celebrate + "turn dating on" + route to the first-session home.
// The DB age-gate trigger enforces 18+ on dating_enabled — a rejection surfaces here.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client } from '@/lib/after5/client';

export function DoneStep({ userId, badge }: { userId: string; badge: { verified: boolean; isNew: boolean } }) {
  const router = useRouter();
  const [datingOn, setDatingOn] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'enabling' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function enableDating() {
    setPhase('enabling');
    setErrorMsg('');
    const { error } = await browserAfter5Client().from('profiles').update({ dating_enabled: true }).eq('id', userId);
    if (error) { setErrorMsg(error.message); setPhase('error'); return; }
    setDatingOn(true);
    setPhase('idle');
  }

  return (
    <div className="text-center">
      <div className="mx-auto inline-flex items-center gap-2 rounded-pill bg-emerald-50 px-4 py-1.5 text-sm font-semibold text-emerald-800">
        <BadgeCheck className="h-4 w-4" />
        {badge.verified ? 'Verified' : 'Profile complete'}{badge.isNew ? ' · New' : ''}
      </div>
      <h1 className="mt-6 font-display text-3xl font-bold text-text">You&apos;re in.</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-secondary">
        Your profile is set and verified. Flip dating on and we&apos;ll start warming up your first Kelowna nights.
      </p>

      {phase === 'error' && (
        <div role="alert" className="mx-auto mt-5 max-w-sm rounded-card border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">{errorMsg}</div>
      )}

      <div className="mt-8 flex flex-col items-center gap-3">
        {!datingOn ? (
          <button type="button" onClick={enableDating} disabled={phase === 'enabling'}
            className={cn('inline-flex items-center justify-center rounded-pill px-8 py-3.5 text-[15px] font-medium transition-all',
              phase === 'enabling' ? 'cursor-not-allowed bg-border text-muted' : 'bg-accent text-white hover:-translate-y-0.5')}>
            {phase === 'enabling' ? 'Turning on…' : phase === 'error' ? 'Try again' : 'Turn dating on'}
          </button>
        ) : (
          <p className="text-sm font-medium text-emerald-700">Dating is on. We&apos;ll text you the moment matches are ready.</p>
        )}
        <button type="button" onClick={() => router.push('/home')}
          className="inline-flex items-center gap-2 text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
          Enter After5 <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
```

Wire the route — ensures `onboarding_step='done'` (the verification status screen routes here after `verified`) and hydrates the badge:
```tsx
// apps/web/app/onboarding/done/page.tsx
import { redirect } from 'next/navigation';
import { OnboardingShell } from '../OnboardingShell';
import { DoneStep } from '../steps/DoneStep';
import { createClient } from '@/lib/supabase/server';
import { badgeFor } from '@after5/business';

export const dynamic = 'force-dynamic';

export default async function DonePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/onboarding');

  const { data: p } = await supabase
    .from('profiles')
    .select('verification, reliability_score')
    .eq('id', user.id).maybeSingle();

  const badge = badgeFor({
    verification: (p?.verification ?? 'unverified') as Parameters<typeof badgeFor>[0]['verification'],
    reliability_score: p?.reliability_score ?? null,
  });

  return <OnboardingShell step={7}><DoneStep userId={user.id} badge={badge} /></OnboardingShell>;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- DoneStep`
Expected: PASS — badge / dating-on→home / error+retry cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/DoneStep.tsx \
  apps/web/app/onboarding/done/page.tsx \
  apps/web/app/onboarding/steps/__tests__/DoneStep.test.tsx
git commit -m "S3-UI: step 7 DoneStep (Verified·New badge + turn dating on → /home)"
```

---

## Task 10: VerificationStatus (the async-limbo screen)

Replace the Task-8 stub. After the embed `onComplete`, this screen reads `verification` (via `getMyProfile`/`getMyBadge`) and polls until a terminal verdict (decision A — one status screen for all pending sub-cases). Mapping: `pending` → "We're checking your ID…" + "we'll notify you" + "Continue / re-open verification"; `verified` → `advanceOnboarding('done')` then route `/onboarding/done`; `failed` → "That didn't go through" + Try again / appeal entry. States: loading (initial read), pending (poll banner), success (verified → advance), error/failed (retry/appeal), cancel (leave → "we'll notify you" / go to home).

**Files:**
- Modify: `apps/web/app/onboarding/steps/VerificationStatus.tsx` (replace stub)
- Create (test): `apps/web/app/onboarding/steps/__tests__/VerificationStatus.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/onboarding/steps/__tests__/VerificationStatus.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const readVerification = vi.fn();
const advanceOnboarding = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  advanceOnboarding: (...a: unknown[]) => advanceOnboarding(...a),
}));
// readVerification is a local helper the component exports for testability.
vi.mock('../verification-poll', () => ({ readVerification: (...a: unknown[]) => readVerification(...a) }));

import { VerificationStatus } from '../VerificationStatus';

beforeEach(() => { push.mockReset(); readVerification.mockReset(); advanceOnboarding.mockReset(); });

describe('VerificationStatus', () => {
  it('loading: shows a checking state on first render', () => {
    readVerification.mockReturnValue(new Promise(() => {}));
    render(<VerificationStatus />);
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });

  it('pending: renders the limbo banner with notify + re-open', async () => {
    readVerification.mockResolvedValue('pending');
    render(<VerificationStatus />);
    await waitFor(() => expect(screen.getByText(/we.ll notify you|checking your id/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /re-open|continue/i })).toBeInTheDocument();
  });

  it('verified: advances to done and routes', async () => {
    readVerification.mockResolvedValue('verified');
    advanceOnboarding.mockResolvedValue('done');
    render(<VerificationStatus />);
    await waitFor(() => expect(advanceOnboarding).toHaveBeenCalledWith(expect.anything(), 'done'));
    expect(push).toHaveBeenCalledWith('/onboarding/done');
  });

  it('failed: shows the failure copy with try-again + appeal', async () => {
    readVerification.mockResolvedValue('failed');
    render(<VerificationStatus />);
    await waitFor(() => expect(screen.getByText(/didn.t go through/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /appeal/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- VerificationStatus`
Expected: FAIL — `Cannot find module '../verification-poll'` (and the stub renders `null`).

- [ ] **Step 3: Implement**

```ts
// apps/web/app/onboarding/steps/verification-poll.ts
// Read the caller's verification state. Extracted so the status screen can be
// unit-tested without a live Supabase client.
import { browserAfter5Client } from '@/lib/after5/client';
import type { VerificationState } from '@after5/validators';

export async function readVerification(): Promise<VerificationState> {
  const client = browserAfter5Client();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return 'unverified';
  const { data } = await client.from('profiles').select('verification').eq('id', user.id).maybeSingle();
  return (data?.verification ?? 'unverified') as VerificationState;
}
```

```tsx
// apps/web/app/onboarding/steps/VerificationStatus.tsx
'use client';
// The one async-limbo screen (decision A): pending / verified / failed. The
// webhook owns the verdict; this screen polls profiles.verification and routes.
// pending → "checking, we'll notify you" + re-open; verified → advance('done');
// failed → try again / appeal.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { browserAfter5Client, advanceOnboarding } from '@/lib/after5/client';
import { readVerification } from './verification-poll';
import type { VerificationState } from '@after5/validators';

export function VerificationStatus() {
  const router = useRouter();
  const [state, setState] = useState<VerificationState | 'loading'>('loading');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function check() {
    try {
      const v = await readVerification();
      setState(v);
      if (v === 'verified') {
        await advanceOnboarding(browserAfter5Client(), 'done').catch(() => { /* already done is fine */ });
        router.push('/onboarding/done');
        return;
      }
      if (v === 'pending') {
        // Poll every 4s while pending (the webhook may land any moment).
        timer.current = setTimeout(check, 4000);
      }
    } catch {
      setState('failed');
    }
  }

  useEffect(() => {
    check();
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="text-sm text-secondary">Checking your verification…</p>
      </div>
    );
  }

  if (state === 'failed' || state === 'appeal') {
    return (
      <div className="text-center">
        <ShieldAlert className="mx-auto h-7 w-7 text-red-500" />
        <h1 className="mt-4 font-display text-2xl font-bold text-text">That didn&apos;t go through.</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-secondary">
          We couldn&apos;t verify your ID. You can try the scan again, or appeal if you think this is a mistake.
        </p>
        <div className="mt-7 flex flex-col items-center gap-3">
          <button type="button" onClick={() => { setState('loading'); check(); }}
            className="inline-flex items-center justify-center rounded-pill bg-text px-7 py-3 text-[15px] font-medium text-background hover:-translate-y-0.5">
            Try again
          </button>
          <a href="mailto:hello@tryafter5.app?subject=Verification%20appeal"
            className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
            Appeal this decision
          </a>
        </div>
      </div>
    );
  }

  // pending
  return (
    <div className="text-center">
      <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />
      <h1 className="mt-4 font-display text-2xl font-bold text-text">We&apos;re checking your ID…</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-secondary">
        Usually about a minute. You can close this — we&apos;ll notify you the second you&apos;re cleared.
      </p>
      <div className="mt-7 flex flex-col items-center gap-3">
        <button type="button" onClick={() => { setState('loading'); check(); }}
          className={cn('inline-flex items-center justify-center rounded-pill bg-text px-7 py-3 text-[15px] font-medium text-background hover:-translate-y-0.5')}>
          Continue / re-open verification
        </button>
        <button type="button" onClick={() => router.push('/home')}
          className="text-sm font-medium text-secondary underline decoration-border underline-offset-4 hover:text-text">
          Look around while you wait
        </button>
      </div>
    </div>
  );
}
```

> Note: the Task-8 test stubbed `../VerificationStatus`, so this real implementation does not break Task 8. Add the new export module `verification-poll.ts` to the Task-8 commit set is unnecessary — it ships here.

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- VerificationStatus`
Expected: PASS — loading/pending/verified/failed cases green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/steps/VerificationStatus.tsx \
  apps/web/app/onboarding/steps/verification-poll.ts \
  apps/web/app/onboarding/steps/__tests__/VerificationStatus.test.tsx
git commit -m "S3-UI: VerificationStatus async-limbo screen (pending/verified/failed → poll + route)"
```

---

## Task 11: FirstSessionHome — full state model + teaser gallery + anti-dead-end behaviors

The post-onboarding destination at `/home`. Pure mappers (`teaser.ts`) decide the home state (verified / pending / failed / dating-off) and shape itinerary rows into teaser cards. The server page reconstructs state from `profiles.{verification, dating_enabled}` + reads `itineraries` (`is_public=true`) for the gallery; it always renders the gallery + explainer beneath any banner (so pending/failed are never a dead end) and exactly one primary action keyed to state. `registerDevice` fires once on load.

**Files:**
- Create: `apps/web/lib/onboarding/teaser.ts`
- Create (test): `apps/web/app/home/__tests__/teaser.test.ts`
- Create: `apps/web/app/home/page.tsx`
- Create: `apps/web/app/home/HomeStateBanner.tsx`
- Create: `apps/web/app/home/MechanicExplainer.tsx`
- Create: `apps/web/app/home/TeaserGallery.tsx`
- Create: `apps/web/app/home/EnableDatingButton.tsx`
- Create: `apps/web/app/home/RegisterDeviceOnLoad.tsx`
- Create (test): `apps/web/app/home/__tests__/FirstSessionHome.state.test.tsx`

- [ ] **Step 1: Write the failing tests (pure mappers + state→render)**

```ts
// apps/web/app/home/__tests__/teaser.test.ts
import { describe, it, expect } from 'vitest';
import { homeState, primaryActionFor, itineraryToTeaser, type HomeState } from '@/lib/onboarding/teaser';

describe('homeState', () => {
  it('failed verification wins over everything', () => {
    expect(homeState({ verification: 'failed', dating_enabled: true })).toBe<HomeState>('failed');
  });
  it('pending verification shows the pending home', () => {
    expect(homeState({ verification: 'pending', dating_enabled: true })).toBe<HomeState>('pending');
  });
  it('verified but dating off → dating_off', () => {
    expect(homeState({ verification: 'verified', dating_enabled: false })).toBe<HomeState>('dating_off');
  });
  it('verified + dating on → verified (primary state)', () => {
    expect(homeState({ verification: 'verified', dating_enabled: true })).toBe<HomeState>('verified');
  });
});

describe('primaryActionFor', () => {
  it('gives exactly one action keyed to state (no dead ends)', () => {
    expect(primaryActionFor('verified').kind).toBe('explore');
    expect(primaryActionFor('dating_off').kind).toBe('enable_dating');
    expect(primaryActionFor('pending').kind).toBe('look_around');
    expect(primaryActionFor('failed').kind).toBe('retry_verification');
  });
});

describe('itineraryToTeaser', () => {
  it('maps a public itinerary row to a teaser card', () => {
    const card = itineraryToTeaser({
      id: 'i1', slug: 'sunset-walk', title: 'Sunset Walk', hook: 'Lakeside',
      total_cost_pp: 40, total_duration_min: 120, stops: [], cover_image_url: '/c.jpg',
    });
    expect(card).toEqual({ id: 'i1', href: '/dates/sunset-walk', title: 'Sunset Walk', hook: 'Lakeside', cover: '/c.jpg', costPp: 40, durationMin: 120 });
  });
  it('falls back to /dates when no slug', () => {
    const card = itineraryToTeaser({ id: 'i2', slug: null, title: 'X', hook: null, total_cost_pp: null, total_duration_min: null, stops: [], cover_image_url: null });
    expect(card.href).toBe('/dates');
  });
});
```

```tsx
// apps/web/app/home/__tests__/FirstSessionHome.state.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// RegisterDeviceOnLoad has side effects; stub it to a no-op marker.
vi.mock('../RegisterDeviceOnLoad', () => ({ RegisterDeviceOnLoad: () => <div data-testid="register-device" /> }));
vi.mock('../EnableDatingButton', () => ({ EnableDatingButton: () => <button>Turn dating on</button> }));

import { HomeStateBanner } from '../HomeStateBanner';

describe('HomeStateBanner (state → render + single primary action)', () => {
  it('pending: non-blocking banner with look-around action', () => {
    render(<HomeStateBanner state="pending" />);
    expect(screen.getByText(/checking your id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /look around/i })).toBeInTheDocument();
  });
  it('failed: routes to retry/appeal', () => {
    render(<HomeStateBanner state="failed" />);
    expect(screen.getByRole('link', { name: /finish verifying|retry|verify/i })).toBeInTheDocument();
  });
  it('dating_off: re-offers turn dating on', () => {
    render(<HomeStateBanner state="dating_off" />);
    expect(screen.getByRole('button', { name: /turn dating on/i })).toBeInTheDocument();
  });
  it('verified: no blocking banner (primary state)', () => {
    const { container } = render(<HomeStateBanner state="verified" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @after5/web test -- home/__tests__`
Expected: FAIL — `Cannot find module '@/lib/onboarding/teaser'` / `'../HomeStateBanner'`.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/onboarding/teaser.ts
// Pure first-session-home logic: state selection, the single primary action per
// state (anti-dead-end), and itinerary-row → teaser-card mapping. NO I/O.
import type { VerificationState } from '@after5/validators';

export type HomeState = 'verified' | 'pending' | 'failed' | 'dating_off';

export function homeState(p: { verification: VerificationState; dating_enabled: boolean }): HomeState {
  if (p.verification === 'failed' || p.verification === 'appeal') return 'failed';
  if (p.verification === 'pending' || p.verification === 'unverified') return 'pending';
  // verified:
  return p.dating_enabled ? 'verified' : 'dating_off';
}

export type PrimaryAction =
  | { kind: 'explore'; label: string; href: string }
  | { kind: 'enable_dating'; label: string }
  | { kind: 'look_around'; label: string; href: string }
  | { kind: 'retry_verification'; label: string; href: string };

export function primaryActionFor(state: HomeState): PrimaryAction {
  switch (state) {
    case 'verified': return { kind: 'explore', label: 'Explore a Kelowna night', href: '/dates' };
    case 'dating_off': return { kind: 'enable_dating', label: 'Turn dating on' };
    case 'pending': return { kind: 'look_around', label: 'Look around while we verify', href: '/dates' };
    case 'failed': return { kind: 'retry_verification', label: 'Finish verifying', href: '/onboarding/verify' };
  }
}

export interface ItineraryRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
  cover_image_url: string | null;
}
export interface TeaserCard {
  id: string; href: string; title: string; hook: string | null; cover: string | null; costPp: number | null; durationMin: number | null;
}
export function itineraryToTeaser(row: ItineraryRow): TeaserCard {
  return {
    id: row.id,
    href: row.slug ? `/dates/${row.slug}` : '/dates',
    title: row.title ?? 'A Kelowna night',
    hook: row.hook,
    cover: row.cover_image_url,
    costPp: row.total_cost_pp,
    durationMin: row.total_duration_min,
  };
}
```

```tsx
// apps/web/app/home/HomeStateBanner.tsx
'use client';
// Non-blocking state banner. The gallery + explainer always render beneath (the
// home is never a dead end). Exactly one primary action per state.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, ShieldAlert } from 'lucide-react';
import type { HomeState } from '@/lib/onboarding/teaser';
import { EnableDatingButton } from './EnableDatingButton';

export function HomeStateBanner({ state }: { state: HomeState }) {
  const router = useRouter();
  if (state === 'verified') return null; // primary state — no blocking banner

  if (state === 'pending') {
    return (
      <div className="mb-8 flex items-center gap-3 rounded-card border border-amber-200 bg-amber-50 px-5 py-4">
        <Clock className="h-5 w-5 shrink-0 text-amber-700" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">We&apos;re checking your ID, usually about a minute.</p>
          <p className="text-[13px] text-amber-800">Look around while you wait — we&apos;ll notify you the second you&apos;re cleared.</p>
        </div>
        <button type="button" onClick={() => router.push('/dates')}
          className="shrink-0 rounded-pill bg-amber-700 px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
          Look around
        </button>
      </div>
    );
  }

  if (state === 'failed') {
    return (
      <div className="mb-8 flex items-center gap-3 rounded-card border border-red-200 bg-red-50 px-5 py-4">
        <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-900">Your verification needs another try.</p>
          <p className="text-[13px] text-red-800">You can still explore — finish verifying when you&apos;re ready.</p>
        </div>
        <Link href="/onboarding/verify" className="shrink-0 rounded-pill bg-red-600 px-4 py-2 text-[13px] font-medium text-white hover:opacity-90">
          Finish verifying
        </Link>
      </div>
    );
  }

  // dating_off
  return (
    <div className="mb-8 flex items-center gap-3 rounded-card border border-border bg-surface px-5 py-4">
      <div className="flex-1">
        <p className="text-sm font-semibold text-text">You&apos;re verified — flip dating on to get matched.</p>
        <p className="text-[13px] text-secondary">We&apos;ll start warming up your first Kelowna nights.</p>
      </div>
      <EnableDatingButton />
    </div>
  );
}
```

```tsx
// apps/web/app/home/MechanicExplainer.tsx
// One-beat "how After5 works" explainer (persistent — the loop is understood
// before it's live). Server component (static).
export function MechanicExplainer() {
  const beats = [
    { n: '1', t: 'Pick the night', d: 'We match you around a real Kelowna experience — not a profile.' },
    { n: '2', t: 'Match blind', d: 'Photos are blurred until you both say yes to the same night.' },
    { n: '3', t: 'Go out', d: 'Meet over something you already wanted to do. Less pressure, more spark.' },
  ];
  return (
    <section className="mt-14">
      <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">How After5 works</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {beats.map((b) => (
          <div key={b.n} className="rounded-card border border-border bg-white/70 p-5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{b.n}</span>
            <h3 className="mt-3 font-display text-base font-semibold text-text">{b.t}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{b.d}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

```tsx
// apps/web/app/home/TeaserGallery.tsx
// Read-only gallery of curated Kelowna nights (reuses existing itineraries content).
// The desire engine while the live match loop (S5/S6) isn't built. Server component.
import Image from 'next/image';
import Link from 'next/link';
import type { TeaserCard } from '@/lib/onboarding/teaser';

export function TeaserGallery({ cards }: { cards: TeaserCard[] }) {
  if (cards.length === 0) {
    return (
      <section className="mt-14">
        <p className="text-sm text-secondary">We&apos;re curating Kelowna nights — check back soon.</p>
      </section>
    );
  }
  return (
    <section className="mt-14">
      <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">The kinds of nights you&apos;ll be matched around</p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.id} href={c.href}
            className="group flex gap-5 rounded-card border border-border bg-white/70 p-3 transition-all hover:-translate-y-0.5 hover:shadow-subtle">
            <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[10px] bg-surface md:h-32 md:w-32">
              {c.cover && <Image src={c.cover} alt="" fill sizes="128px" className="object-cover transition-transform duration-500 group-hover:scale-105" />}
            </div>
            <div className="min-w-0 flex-1 py-1">
              <h3 className="line-clamp-2 font-display text-base font-semibold text-text">{c.title}</h3>
              {c.hook && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-secondary">{c.hook}</p>}
              {(c.costPp != null || c.durationMin != null) && (
                <p className="mt-3 text-[11px] text-muted [font-variant-numeric:tabular-nums]">
                  {c.costPp != null ? `$${Math.round(c.costPp)}` : ''}{c.costPp != null && c.durationMin != null ? ' · ' : ''}{c.durationMin != null ? `${Math.round((c.durationMin / 60) * 10) / 10} hr` : ''}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

```tsx
// apps/web/app/home/EnableDatingButton.tsx
'use client';
// Re-offers "turn dating on" from the home (dating_off state). The DB age-gate
// trigger enforces 18+ on dating_enabled; a rejection surfaces inline.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { browserAfter5Client } from '@/lib/after5/client';

export function EnableDatingButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'enabling' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function enable() {
    setPhase('enabling'); setMsg('');
    const client = browserAfter5Client();
    const { data: { user } } = await client.auth.getUser();
    if (!user) { router.push('/login?next=/home'); return; }
    const { error } = await client.from('profiles').update({ dating_enabled: true }).eq('id', user.id);
    if (error) { setMsg(error.message); setPhase('error'); return; }
    router.refresh();
  }

  return (
    <span className="flex flex-col items-end">
      <button type="button" onClick={enable} disabled={phase === 'enabling'}
        className={cn('shrink-0 rounded-pill px-4 py-2 text-[13px] font-medium transition-all',
          phase === 'enabling' ? 'cursor-not-allowed bg-border text-muted' : 'bg-accent text-white hover:opacity-90')}>
        {phase === 'enabling' ? 'Turning on…' : 'Turn dating on'}
      </button>
      {phase === 'error' && <span role="alert" className="mt-1 text-[11px] text-red-600">{msg}</span>}
    </span>
  );
}
```

```tsx
// apps/web/app/home/RegisterDeviceOnLoad.tsx
'use client';
// Auto re-engagement: register this browser for push once on first home load so
// verification_passed / future "matches ready" notifications can reach back here.
// Best-effort — failures are swallowed (no permission, unsupported browser).
import { useEffect, useRef } from 'react';
import { browserAfter5Client, registerDevice } from '@/lib/after5/client';

export function RegisterDeviceOnLoad() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        // Web push token wiring is owned by S2; here we register a web platform
        // marker so the device row exists. A real push subscription is layered later.
        await registerDevice(browserAfter5Client(), `web:${navigator.userAgent.slice(0, 64)}`, 'web', null);
      } catch { /* best-effort */ }
    })();
  }, []);
  return null;
}
```

```tsx
// apps/web/app/home/page.tsx
// FirstSessionHome — the post-onboarding destination. State is reconstructed from
// server state on every visit (the resume guard extends past onboarding). The
// gallery + explainer ALWAYS render (never a dead end); one primary action per state.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { badgeFor } from '@after5/business';
import type { VerificationState } from '@after5/validators';
import { homeState, primaryActionFor, itineraryToTeaser, type ItineraryRow } from '@/lib/onboarding/teaser';
import { HomeStateBanner } from './HomeStateBanner';
import { MechanicExplainer } from './MechanicExplainer';
import { TeaserGallery } from './TeaserGallery';
import { RegisterDeviceOnLoad } from './RegisterDeviceOnLoad';

export const dynamic = 'force-dynamic';

export default async function FirstSessionHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/home');

  const [{ data: profile }, { data: itineraries }] = await Promise.all([
    supabase.from('profiles').select('first_name, verification, dating_enabled, reliability_score, onboarding_step').eq('id', user.id).maybeSingle(),
    supabase.from('itineraries')
      .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, cover_image_url')
      .eq('is_public', true).not('slug', 'is', null).order('generated_at', { ascending: false }).limit(6),
  ]);

  // If onboarding isn't done, the resume guard owns routing — bounce back.
  if ((profile?.onboarding_step ?? 'age_gate') !== 'done') redirect('/onboarding');

  const verification = (profile?.verification ?? 'unverified') as VerificationState;
  const state = homeState({ verification, dating_enabled: profile?.dating_enabled ?? false });
  const action = primaryActionFor(state);
  const badge = badgeFor({ verification, reliability_score: profile?.reliability_score ?? null });
  const cards = ((itineraries ?? []) as unknown as ItineraryRow[]).map(itineraryToTeaser);
  const firstName = profile?.first_name || 'there';

  return (
    <main className="min-h-screen bg-background">
      <RegisterDeviceOnLoad />
      <header className="border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">After5</Link>
        </nav>
      </header>

      <div className="mx-auto max-w-content px-6 pb-24 pt-12 md:px-10">
        <section>
          {badge.verified && (
            <div className="mb-4 inline-flex items-center gap-2 rounded-pill bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-800">
              Verified{badge.isNew ? ' · New' : ''}
            </div>
          )}
          <h1 className="font-display text-3xl font-bold leading-tight text-text md:text-5xl">
            Welcome to After5, <span className="italic text-accent">{firstName}</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-secondary md:text-base">
            We&apos;re warming up your first Kelowna nights — we&apos;ll text you the moment matches are ready.
          </p>

          <div className="mt-7">
            <HomeStateBanner state={state} />
            {/* Primary action keyed to state (the dating_off action lives in the banner). */}
            {action.kind !== 'enable_dating' && (
              <Link href={action.href}
                className="inline-flex items-center justify-center rounded-pill bg-text px-7 py-3.5 text-[15px] font-medium text-background transition-all hover:-translate-y-0.5">
                {action.label}
              </Link>
            )}
          </div>
        </section>

        <MechanicExplainer />
        <TeaserGallery cards={cards} />

        <section className="mt-14 rounded-card border border-border bg-surface p-6 text-center">
          <p className="text-sm text-secondary">Know someone who&apos;d love this? <Link href="/" className="font-medium text-accent underline underline-offset-4">Invite a friend</Link> — it helps us light up Kelowna faster.</p>
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm --filter @after5/web test -- home/__tests__`
Expected: PASS — `homeState`/`primaryActionFor`/`itineraryToTeaser` mappers + `HomeStateBanner` state renders green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/onboarding/teaser.ts apps/web/app/home/page.tsx \
  apps/web/app/home/HomeStateBanner.tsx apps/web/app/home/MechanicExplainer.tsx \
  apps/web/app/home/TeaserGallery.tsx apps/web/app/home/EnableDatingButton.tsx \
  apps/web/app/home/RegisterDeviceOnLoad.tsx \
  apps/web/app/home/__tests__/teaser.test.ts \
  apps/web/app/home/__tests__/FirstSessionHome.state.test.tsx
git commit -m "S3-UI: FirstSessionHome — state model + teaser gallery + anti-dead-end banners + registerDevice"
```

---

## Task 12: `verification_passed` webhook notification (backend addition)

The merged `persona-webhook` fires `dispatch_notification(refId, 'verification_failed', …)` only on `rows[0].state === 'failed'`. Add a `verification_passed` dispatch on `name === 'inquiry.approved'` so a user who left during the async wait is pulled back to the "You're in" celebration (re-engagement → success-home). The `verification_passed` enum value already exists.

**Files:**
- Modify: `supabase/functions/persona-webhook/index.ts`
- Modify: `supabase/functions/persona-webhook/index_test.ts`

- [ ] **Step 1: Write the failing test (extract a pure mapper + assert)**

Add to `supabase/functions/persona-webhook/index_test.ts`:
```ts
import { notificationTypeFor } from './index.ts';

Deno.test('inquiry.approved maps to a verification_passed notification', () => {
  assertEquals(notificationTypeFor('inquiry.approved'), 'verification_passed');
});
Deno.test('inquiry.declined maps to a verification_failed notification', () => {
  assertEquals(notificationTypeFor('inquiry.declined'), 'verification_failed');
});
Deno.test('inquiry.marked-for-review maps to no notification (still pending)', () => {
  assertEquals(notificationTypeFor('inquiry.marked-for-review'), null);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `deno test --allow-env --allow-net supabase/functions/persona-webhook/`
Expected: FAIL — `notificationTypeFor` is not exported (`The module's exports do not contain 'notificationTypeFor'`).

- [ ] **Step 3: Implement — add the pure mapper + the approved dispatch**

In `supabase/functions/persona-webhook/index.ts`, add the pure mapper near `mapInquiryToVerification`:
```ts
// Which user notification (if any) a verdict should dispatch. approved → passed,
// declined → failed, marked-for-review → none (still pending). Mirrors the C1/C11.11
// notification_type enum values that already exist.
export function notificationTypeFor(eventName: string): 'verification_passed' | 'verification_failed' | null {
  switch (eventName) {
    case 'inquiry.approved': return 'verification_passed';
    case 'inquiry.declined': return 'verification_failed';
    default: return null;
  }
}
```

Replace the failure-only dispatch block:
```ts
  if (rows[0].state === 'failed') {
    await supabase.rpc('dispatch_notification', { p_user: refId, p_type: 'verification_failed', p_payload: { topic: 'verification', state: rows[0].state, reason: rows[0].failure_reason } });
  }
```
with a verdict-driven dispatch using the mapper:
```ts
  const notifType = notificationTypeFor(name);
  if (notifType) {
    await supabase.rpc('dispatch_notification', {
      p_user: refId,
      p_type: notifType,
      p_payload: { topic: 'verification', state: rows[0].state, reason: rows[0].failure_reason },
    });
  }
```

- [ ] **Step 4: Run it, expect PASS**

Run: `deno test --allow-env --allow-net supabase/functions/persona-webhook/`
Expected: PASS — existing mapping/HMAC/DOB cases plus the three new `notificationTypeFor` cases green.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/persona-webhook/index.ts supabase/functions/persona-webhook/index_test.ts
git commit -m "S3-UI: persona-webhook dispatches verification_passed on approved (re-engagement to success-home)"
```

---

## Task 13: Integration — green suite, typecheck, lint, and the manual browser test checklist

End-to-end gate. Confirm every web test + the webhook Deno test pass, the web app typechecks (tests excluded) and lints, then run the manual browser checklist covering the golden path AND the interrupted/resume paths per the spec's testing section.

**Files:**
- (no new files — verification only)

- [ ] **Step 1: Run the whole vitest workspace**

Run: `pnpm test`
Expected: PASS — node project (`packages/*`: validators/business/api-client) and web project (steps.helpers, client, WelcomeAgeGate, BasicsStep, PhotoStep, PreferencesStep, PhoneVerifyStep, IdentityVerifyStep, DoneStep, VerificationStatus, teaser, FirstSessionHome.state, the existing route.test) all green; no `No test files found`.

- [ ] **Step 2: Run the webhook Deno test**

Run: `deno test --allow-env --allow-net supabase/functions/persona-webhook/`
Expected: PASS — all webhook cases including the three `notificationTypeFor` cases.

- [ ] **Step 3: Typecheck + lint the web app**

Run: `pnpm --filter @after5/web typecheck && pnpm --filter @after5/web lint`
Expected: PASS — `tsc --noEmit` clean (test files excluded by `apps/web/tsconfig.json`); `next lint` clean.

- [ ] **Step 4: Manual browser test checklist (dev server)**

Run: `pnpm --filter @after5/web dev` (with Supabase local running + `.env.local` Persona sandbox + Twilio test creds). Verify each:

Golden path:
- [ ] Sign in → visit `/onboarding` → lands on `/onboarding/welcome` (resume guard from `age_gate`).
- [ ] Confirm 18+ → Continue → `/onboarding/basics`. Fill name/bio/tags → Continue → `/onboarding/photo`.
- [ ] Upload a photo → Upload & continue → `/onboarding/preferences` (verify `<uid>/blurred.jpg` exists in the bucket).
- [ ] Set preferences → Continue → `/onboarding/phone`. Send code (test OTP) → enter code → Verify → `/onboarding/verify`.
- [ ] Start verification → Persona sandbox embed opens → complete approved flow → status screen → (on `verified`) → `/onboarding/done`.
- [ ] Done screen shows **Verified · New**; Turn dating on (succeeds for an 18+ DOB); Enter After5 → `/home` (verified primary state, no banner, gallery + explainer render).

Interrupted / resume paths (spec §7):
- [ ] **Close mid-step → resume:** after `/onboarding/preferences`, close the tab; reopen `/onboarding` → lands back on `/onboarding/phone` (server-truth step, prior data preserved on re-entry to a completed step).
- [ ] **Close mid-verification → pending-home:** start verification, leave it `pending` (marked-for-review), revisit `/home` → pending banner ("checking your ID, look around meanwhile") + gallery beneath (no spinner/dead end).
- [ ] **Leave during the wait → `verification_passed` re-engagement → success-home:** simulate the webhook firing `inquiry.approved` (so `profiles.verification='verified'` + a `verification_passed` notification is dispatched); revisit `/home` → it now reads `verified` and shows the "you're in" framing (badge, no pending banner).
- [ ] **Failed verdict:** simulate `inquiry.declined` → `/home` shows the failed banner routing to `/onboarding/verify` (retry/appeal); gallery + explainer still render (not a hard stop).
- [ ] **Dating-off:** verified but `dating_enabled=false` → `/home` shows the "turn dating on" banner action; enabling it refreshes to the verified state.
- [ ] **Anti-dead-end check:** every first-session state surfaces exactly one primary action and the gallery — no screen ends without a clear next.

- [ ] **Step 5: Commit (gate marker only if any fixups were needed; otherwise nothing to commit)**

If Steps 1–3 surfaced fixes, commit them with `git commit -m "S3-UI: integration fixups (green suite + typecheck + lint)"`. The manual checklist (Step 4) produces no code; record results in the PR description.

---

## Self-Review

**Spec coverage checklist (`docs/superpowers/specs/2026-05-26-s3-ui-onboarding-design.md`):**
- §1 Architecture & routing — route group `app/onboarding/`, server resume guard (layout + index page), `OnboardingShell` (pattern C), per-step persist→advance→route, SSR auth. → Tasks 1, 3–10. ✅
- §2 Seven screens (age_gate→done) mapped to components with the right backend calls (`advanceOnboarding`, `upsertProfile`, storage+`generate-blur`, `savePreferences`, `signInWithOtp`/`verifyOtp`/`confirmPhone`, `startVerification`+Persona embed, `getMyBadge`). → Tasks 3–10. ✅
- §3 Verification = **embedded Persona** (CDN v5 `<Script>`, `{inquiryId, sessionToken}`, `onComplete`/`onCancel`/`onError`; verdict from webhook); phone OTP via Supabase Auth; **`verification_passed` webhook addition**. → Tasks 8, 10, 12. ✅
- §4 Data flow & resume model — server-state-as-truth, idempotent steps (server pages hydrate), forward-only advance, verification limbo decision A (one status screen, pending+notify+re-open, failed→retry/appeal, verified→done). → Tasks 1, 4, 6, 10. ✅
- §5 Six states per screen — loading/error/empty/success/retry/cancel exercised in each step's test (photo retry/replace, OTP invalid/resend/rate-limit, verification network failure + pending/failed, resume-guard loading). → Tasks 3–11. ✅
- §6 First-session continuity — `/home` with verified/pending/failed/dating-off state model, teaser gallery (read-only `itineraries` reuse), mechanic explainer, one primary action per state, `registerDevice`, invite-a-friend, anti-dead-end (gallery always renders). → Task 11. ✅
- §7 Testing — **apps/web jsdom vitest project** (Task 0, also runs the existing `process-jobs/route.test.ts`); component/logic tests for step state, resume-guard routing, verification status mapping, home state selection; **manual browser checklist** for golden + interrupted/resume paths. → Tasks 0, 1, 10, 11, 13. ✅
- §8 Out of scope honored — no profile editor, no browse/match implementation (gallery is read-only reuse), no admin tools, no settings systems, no clear-photo reveal. ✅
- §9 Dependencies — reuses existing experience content (`itineraries`), Persona web SDK added (CDN, no npm dep), Twilio/test_otp for phone, consumes the merged `@after5/api-client` helpers + validators, `registerDevice` at onboarding end (fired on first home load). ✅

**Placeholder scan:** every step shows complete, runnable code — components, server route wiring, pure helpers, tests, exact `pnpm`/`deno`/`git` commands with expected FAIL/PASS. No "TBD", no "similar to Task N", no "add error handling" stubs. The one intentional cross-task seam (`VerificationStatus` imported in Task 8, fully implemented in Task 10) ships a real stub in Task 8 and its real body + test in Task 10, both spelled out. The Persona CDN version (`persona-v5.1.2.js`) and env vars (`PERSONA_TEMPLATE_ID` server-only, consumed by the merged `start-verification`) are real, not faked.

**Type/name consistency:**
- `OnboardingStep` (validators) drives `ONBOARDING_STEPS`/`STEP_ROUTE`/`nextStep`/`stepIndex` and every `advanceOnboarding('<step>')` call — exact backend step strings (`age_gate`/`basics`/`photos`/`preferences`/`phone_verify`/`selfie_verify`/`done`).
- `After5Client = SupabaseClient<Database>` (api-client) === the `@supabase/ssr` browser client (`@/lib/supabase/client`), so `browserAfter5Client()` passes straight to every merged helper with no cast hole.
- `savePreferences` payload (`{gender, gender_preferences, age_min, age_max, distance_pref_km, dealbreakers}`) matches the merged helper's `PreferencesInput`; `age_pref` int4range hydration parses canonical `[lo,hi)` back to inclusive min/max.
- `badgeFor({verification, reliability_score})` → `{verified, isNew}` consumed identically in `DoneStep` and `FirstSessionHome`.
- `VerificationState` (validators: `unverified|pending|verified|failed|appeal`) drives `homeState`, `readVerification`, and the status screen — same union as the DB enum.
- `HomeState` (`verified|pending|failed|dating_off`) ↔ `primaryActionFor` kinds (`explore|enable_dating|look_around|retry_verification`) — exactly one action per state.
- `notificationTypeFor` returns enum values (`verification_passed`/`verification_failed`) that already exist in the merged `notification_type` enum (confirmed in `20260525123400_p2_notifications.sql`).
- `generate-blur` invoked with body `{}` and the upload path `<uid>/clear.jpg` match the merged Edge Function's `download('${user.id}/clear.jpg')` contract.

**Gaps / assumptions flagged for the controller:**
1. **Persona embedded API surface.** The plan targets the Persona **v5 web `Client`** (`new window.Persona.Client({ inquiryId, sessionToken, onComplete, onCancel, onError })`). The exact CDN minor version (`persona-v5.1.2.js`) and the `Client` constructor field names should be confirmed against Persona's current embedded docs at implementation time; if Persona's current embedded entry differs (e.g. `Persona.Client` vs `persona-react`), only `PersonaEmbed.tsx` changes — the rest of the flow (front door, status, webhook) is unaffected.
2. **`registerDevice` web-push payload.** S2 owns push token wiring; this slice registers a `web` platform marker so the device row exists (best-effort). A real web-push subscription (service worker + `p_web_push`) is layered later by the notifications UI slice — noted as out-of-scope per §8.
3. **Resume-guard "wrong step" hard-redirect.** The deterministic "land on the correct step" redirect lives in `app/onboarding/page.tsx` (index), and step pages re-read server state on entry (idempotent). The layout only force-redirects the `done → /home` case. If product later wants a strict "you cannot deep-link to a future step" guard on every step route, add the per-step server assertion — not built now to avoid over-constraining the resume UX.

---

## Future Work / Backlog

### Vibe tags → curated chip selector (replace the free-text input)

**Current:** `BasicsStep` collects vibe tags as a free-text, comma-separated input (`tagsRaw` → split on commas → `profiles.vibe_tags text[]`). Fast to ship and maximally expressive, but it produces **unmatchable data** — "coffee" / "third-wave coffee" / "cafés" never align, so vibe can't be clustered or matched on later.

**Proposed:** a curated, categorized chip selector with typeahead.
- ~6–8 tappable chips grouped by category (outdoors, food/drink, nightlife, culture, …).
- Typeahead search over the taxonomy; capped selection (keep the existing max of 8).
- Small "add your own" escape hatch for the long tail.

**Why it fits After5:** the product matches people around real plans, so clean, matchable vibe data is load-bearing, not cosmetic. Tapping also beats typing for completion rate.

**References:** Hinge and Bumble (curated, categorized interest chips with typeahead) are the closest dating analogues; Feeld for a richer taxonomy. Outside dating, Spotify/Pinterest onboarding (tap-the-bubbles) and Stack Overflow's tag input (type → autocomplete → create) are the canonical interaction patterns.

**Tradeoff:** requires a vibe taxonomy to build and maintain, and slightly constrains expression — net positive given matchability is the whole point.

**Touch points:** `apps/web/app/onboarding/steps/BasicsStep.tsx` (the `vibe_tags` input + `tagsRaw` parsing), `apps/web/app/onboarding/basics/page.tsx` (hydration), `profiles.vibe_tags` (text[], unchanged). If matching needs to join on vibe, seed the taxonomy as a table/enum rather than free strings.

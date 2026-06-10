# Date Customization Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After generating, show the user ONE date on an editable "canvas" (the night is the hero) where they can shape the title, cover, and stops via focused bottom-sheets, then publish — turning an AI draft into "my night."

**Architecture:** Reuse what exists (generation, the `generate-plan` improve dispatch, `generate-cover`, the `/dates/[slug]` rendering, `PostNightForm` publish). Net-new is: generate **1** itinerary instead of 3, a `DateCanvas` client component with edit chips, three editor sheets (`TitleEditor`, `CoverEditor`, `StopsEditor`), and two new `generate-plan` improve actions (`regenerate_title`, `remove_stop`). The canvas owns title/image/stops; Publish routes the customized itinerary into the existing `/nights/new`.

**Tech Stack:** Next.js 15 App Router (client components), Supabase Edge Functions (Deno), `generate-plan` improve dispatch, sonner toasts, Tailwind shell.* tokens, vitest + React Testing Library (web), deno test (edge), Playwright (visual @420px).

**Spec:** `docs/superpowers/specs/2026-06-08-date-customization-canvas-design.md`

**Copy rule (from the spec):** the word "regenerate" must NOT appear in UI copy. Use "another take", "fresh cover", "swap this stop", "change the ending", "make it more romantic".

---

## File Structure

**Modify:**
- `supabase/functions/generate-plan/providers/pipeline.ts` — generate 1 itinerary, not 3 (a `TARGET_ITINERARY_COUNT` constant).
- `supabase/functions/generate-plan/improve.ts` — add `regenerate_title` and `remove_stop` actions to `ImproveInputSchema` + `handleImprove`.
- `apps/web/app/api/create-plan/route.ts` — return the single itinerary (already forwards an array; no shape change needed, just document the 1-item expectation).
- `apps/web/app/create/CreateFlow.tsx` — after generate, render `DateCanvas` for the single itinerary instead of the 3-candidate `Results` list.

**Create:**
- `apps/web/app/create/canvas/DateCanvas.tsx` — the canvas: renders the night + edit chips + Publish; owns working itinerary state.
- `apps/web/app/create/canvas/TitleEditor.tsx` — title/hook sheet (another take / tone / write my own).
- `apps/web/app/create/canvas/CoverEditor.tsx` — cover sheet (fresh cover / use a venue photo).
- `apps/web/app/create/canvas/StopsEditor.tsx` — stops sheet (swap this stop / change the ending / drop this stop). Reuses the existing `swap_stop` improve action.
- Tests colocated under `apps/web/app/create/canvas/__tests__/`.

**Reuse unchanged:** `generate-cover` edge fn, `PostNightForm` (`/nights/new`), `@/lib/itinerary-types` (`Stop`, `Itinerary`), `@/lib/after5/client` (`browserAfter5Client`), `@/lib/cn`.

**Deferred to v1.1 (NOT in this plan):** fold logistics/audience into canvas sheets; upload-your-own cover; manual stop reorder; `search a specific venue` + `add stop` (needs a new venue-search action — staged as the final optional tasks).

---

## Task 1: Generate one itinerary, not three ✅ DONE (commit 21cdfb2)

**Files:**
- Modify: `supabase/functions/generate-plan/providers/pipeline.ts:47-188`
- Test: `supabase/functions/generate-plan/providers/pipeline.test.ts`

- [ ] **Step 1: Read the current count logic**

Read `providers/pipeline.ts` around lines 47, 109 (`.slice(0, 3)`), and 184-188 (the "fewer than 3 → fill from remaining templates" loop). Confirm 3 is the only target.

- [ ] **Step 2: Add a target-count constant**

At the top of `pipeline.ts` (after imports), add:

```ts
// One AI draft per request (the customization canvas shapes that single date;
// the old 3-candidate picker was removed). See the date-customization-canvas spec.
const TARGET_ITINERARY_COUNT = 1;
```

- [ ] **Step 3: Use the constant at the three sites**

Replace `.slice(0, 3)` (≈line 109) with `.slice(0, TARGET_ITINERARY_COUNT)`. Replace the loop guards `itineraries.length < 3` (≈185) and `itineraries.length >= 3` (≈188) with `< TARGET_ITINERARY_COUNT` and `>= TARGET_ITINERARY_COUNT`. Leave the per-template retry (`MIN_USABLE`/retry-3) untouched — that is candidate quality, not itinerary count.

- [ ] **Step 4: Update the existing pipeline test expectation**

In `providers/pipeline.test.ts`, find the assertion on `itineraries.length` (was expecting 3). Change it to expect `1`. If the test fixture only supplies enough candidates for fewer than 3 it may already pass; run it to see.

- [ ] **Step 5: Run the edge tests**

Run: `cd supabase/functions/generate-plan && deno test pipeline.test.ts --allow-net --allow-env --no-check`
Expected: PASS, itineraries length asserted as 1.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-plan/providers/pipeline.ts supabase/functions/generate-plan/providers/pipeline.test.ts
git commit -m "feat(generate-plan): produce one itinerary per request (canvas flow)"
```

---

## Task 2: `regenerate_title` improve action (backend) ✅ DONE (commits f0b6dc2, 3e07f0f)

**Files:**
- Modify: `supabase/functions/generate-plan/improve.ts` (schema ≈322, `handleImprove` ≈437)
- Test: `supabase/functions/generate-plan/improve.test.ts`

Context: `improve.ts` has `ImproveInputSchema = z.discriminatedUnion('action', [...])` with `swap_stop` and `nl_tweak`. `handleImprove` loads the itinerary row (`select('id,user_id,template_id,stops,inputs,city_id,title')`), dispatches per action, and returns `ImproveResult`. `rewriteStopCopy` already calls the LLM for copy. We add a `regenerate_title` action that rewrites title+hook over the FROZEN stops (the LLM never changes places).

- [ ] **Step 1: Write the failing test**

In `improve.test.ts`:

```ts
Deno.test('ImproveInputSchema: accepts regenerate_title with optional tone', () => {
  const ok = ImproveInputSchema.safeParse({
    action: 'regenerate_title', itinerary_id: 'abc', tone: 'romantic',
  });
  assertEquals(ok.success, true);
  const okNoTone = ImproveInputSchema.safeParse({ action: 'regenerate_title', itinerary_id: 'abc' });
  assertEquals(okNoTone.success, true);
  const badTone = ImproveInputSchema.safeParse({ action: 'regenerate_title', itinerary_id: 'abc', tone: 'nope' });
  assertEquals(badTone.success, false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd supabase/functions/generate-plan && deno test improve.test.ts --allow-net --allow-env --no-check`
Expected: FAIL (`regenerate_title` not in the union).

- [ ] **Step 3: Extend the schema**

In `improve.ts`, add to the `ImproveInputSchema` discriminated union (after the `nl_tweak` member):

```ts
  z.object({
    action: z.literal('regenerate_title'),
    itinerary_id: z.string().min(1),
    // Optional tone nudge for the new title/hook. Omitted = a fresh take, same tone.
    tone: z.enum(['romantic', 'playful', 'casual']).optional(),
  }),
```

- [ ] **Step 4: Run the schema test — PASS**

Run: `cd supabase/functions/generate-plan && deno test improve.test.ts --allow-net --allow-env --no-check`
Expected: PASS.

- [ ] **Step 5: Add the handler test (title rewrite returns new title/hook, frozen stops)**

```ts
Deno.test('handleImprove regenerate_title: returns a new title without touching stops', async () => {
  const stops = [{ place_id: 'p1', place_name: 'A' }, { place_id: 'p2', place_name: 'B' }];
  const fakeSupabase = makeFakeSupabaseWithItinerary({ id: 'it1', user_id: 'u1', stops, title: 'Old Title' });
  const env = makeFakeImproveEnv({ titleResult: { title: 'Golden Hour & Good Talk', hook: 'two hours, one sunset' } });
  const res = await handleImprove({ action: 'regenerate_title', itinerary_id: 'it1', tone: 'romantic' }, fakeSupabase, env);
  assertEquals(res.ok, true);
  assertEquals(res.title, 'Golden Hour & Good Talk');
  assertEquals(res.stops?.map((s) => s.place_id), ['p1', 'p2']); // frozen
});
```

(Reuse or add `makeFakeSupabaseWithItinerary` / `makeFakeImproveEnv` test helpers in `improve.test.ts` mirroring the existing `swap_stop` test's fakes. If those helpers don't exist yet, create them in the test file modeled on how the existing `swap_stop`/`nl_tweak` tests stub `supabase.from().select().eq().single()` and the env's LLM call.)

- [ ] **Step 6: Run it to confirm it fails**

Run: `cd supabase/functions/generate-plan && deno test improve.test.ts --allow-net --allow-env --no-check`
Expected: FAIL (handler has no `regenerate_title` branch).

- [ ] **Step 7: Implement the handler branch**

In `handleImprove`, after the `if (input.action === 'swap_stop') {...}` block, add:

```ts
  if (input.action === 'regenerate_title') {
    // Rewrite ONLY the title + hook over the frozen stops. The LLM never sees
    // a place-selection task — same contract as rewriteStopCopy.
    const newCopy = await regenerateTitle(env, {
      stops: row.stops as ItineraryStop[],
      currentTitle: row.title as string,
      tone: input.tone,
    });
    const { error } = await supabase
      .from('itineraries')
      .update({ title: newCopy.title, hook: newCopy.hook })
      .eq('id', input.itinerary_id);
    if (error) return { ok: false, issues: [{ kind: 'persist', message: error.message }] };
    return { ok: true, itinerary_id: input.itinerary_id, stops: row.stops as ItineraryStop[], title: newCopy.title, hook: newCopy.hook };
  }
```

Then add the `regenerateTitle` helper near `rewriteStopCopy`:

```ts
async function regenerateTitle(
  env: ImproveEnv,
  args: { stops: ItineraryStop[]; currentTitle: string; tone?: 'romantic' | 'playful' | 'casual' },
): Promise<{ title: string; hook: string }> {
  const stopList = args.stops.map((s) => s.place_name).join(' → ');
  const toneLine = args.tone ? `Make it feel more ${args.tone}.` : 'Give it a fresh, different angle from the current title.';
  const system = `You write short, evocative date-night titles for After5. Lowercase-friendly, no clichés, no em-dashes. ${toneLine}`;
  const user = `Stops: ${stopList}\nCurrent title: "${args.currentTitle}"\nReturn a NEW title (max 6 words) and a one-line hook (max 12 words). Do not change the stops.`;
  // Mirror how rewriteStopCopy calls the Anthropic SDK in this file (env.anthropicKey / haiku model + the tool-use or JSON pattern already used). Parse { title, hook }.
  return await callTitleModel(env, system, user);
}
```

> Implementation note for the engineer: `rewriteStopCopy` (≈line 385) already shows the exact Anthropic SDK call + parse pattern used in this file (model id from `env`, the structured-output approach). Mirror it in `callTitleModel` returning `{ title, hook }`. Reuse the Haiku model (cheap) like the improve loop does.

- [ ] **Step 8: Add `title`/`hook` to `ImproveResult`**

Ensure `ImproveResult` (≈line 343) includes `title?: string` and `hook?: string` (it already has `title: string | null` near line 360 — add `hook?: string | null` if missing).

- [ ] **Step 9: Run tests — PASS**

Run: `cd supabase/functions/generate-plan && deno test improve.test.ts --allow-net --allow-env --no-check`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/generate-plan/improve.ts supabase/functions/generate-plan/improve.test.ts
git commit -m "feat(generate-plan): add regenerate_title improve action (frozen stops)"
```

---

## Task 3: `remove_stop` improve action (backend) ✅ DONE (commit ab15da6)

> **Integration fix (commit baa0790):** wired `regenerate_title` + `remove_stop` into the `index.ts` improve dispatch guard (they were unrouted → dead), added `title`/`hook` to the improve response, made `regenerate_title` persist owner-safe (`.select('id')` → `not_owner` 403 on RLS silent-deny). Required for Tasks 2/3 to function in prod.

**Files:**
- Modify: `supabase/functions/generate-plan/improve.ts`
- Test: `supabase/functions/generate-plan/improve.test.ts`

Removing a stop must re-validate coherence (a 1-stop night is still valid; an empty night is not). Reuse `validateCoherence` (≈line 262) and `reflowStops` (≈532) so times/drive-tos recompute.

- [ ] **Step 1: Write the failing test**

```ts
Deno.test('handleImprove remove_stop: drops the stop, reflows, stays coherent', async () => {
  const stops = [{ place_id: 'p1', place_name: 'A' }, { place_id: 'p2', place_name: 'B' }, { place_id: 'p3', place_name: 'C' }];
  const fakeSupabase = makeFakeSupabaseWithItinerary({ id: 'it1', user_id: 'u1', stops });
  const res = await handleImprove({ action: 'remove_stop', itinerary_id: 'it1', stop_index: 1 }, fakeSupabase, makeFakeImproveEnv({}));
  assertEquals(res.ok, true);
  assertEquals(res.stops?.map((s) => s.place_id), ['p1', 'p3']);
});

Deno.test('handleImprove remove_stop: refuses to leave fewer than 1 stop', async () => {
  const stops = [{ place_id: 'p1', place_name: 'A' }];
  const fakeSupabase = makeFakeSupabaseWithItinerary({ id: 'it1', user_id: 'u1', stops });
  const res = await handleImprove({ action: 'remove_stop', itinerary_id: 'it1', stop_index: 0 }, fakeSupabase, makeFakeImproveEnv({}));
  assertEquals(res.ok, false);
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `cd supabase/functions/generate-plan && deno test improve.test.ts --allow-net --allow-env --no-check`
Expected: FAIL.

- [ ] **Step 3: Extend the schema**

Add to `ImproveInputSchema`:

```ts
  z.object({
    action: z.literal('remove_stop'),
    itinerary_id: z.string().min(1),
    stop_index: z.number().int().min(0),
  }),
```

- [ ] **Step 4: Implement the handler branch**

```ts
  if (input.action === 'remove_stop') {
    const stops = row.stops as ItineraryStop[];
    if (input.stop_index < 0 || input.stop_index >= stops.length) {
      return { ok: false, issues: [{ kind: 'bounds', message: 'that stop is no longer here.' }] };
    }
    const next = stops.filter((_, i) => i !== input.stop_index);
    if (next.length < 1) {
      return { ok: false, issues: [{ kind: 'too_few', message: 'a night needs at least one stop.' }] };
    }
    const pool = await loadCandidatePool(supabase, row);
    const inputs = row.inputs as PlanInputs;
    const reflowed = reflowStops(next, pool, inputs);
    const coherence = validateCoherence(reflowed, pool, inputs);
    if (!coherence.ok) return { ok: false, issues: coherence.issues };
    const { error } = await supabase.from('itineraries').update({ stops: reflowed }).eq('id', input.itinerary_id);
    if (error) return { ok: false, issues: [{ kind: 'persist', message: error.message }] };
    return { ok: true, itinerary_id: input.itinerary_id, stops: reflowed };
  }
```

> Note: `loadCandidatePool` (≈416), `reflowStops` (≈532), `validateCoherence` (≈262), and `PlanInputs` already exist in this file — reuse them exactly as `swap_stop` does.

- [ ] **Step 5: Run — PASS**

Run: `cd supabase/functions/generate-plan && deno test improve.test.ts --allow-net --allow-env --no-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/generate-plan/improve.ts supabase/functions/generate-plan/improve.test.ts
git commit -m "feat(generate-plan): add remove_stop improve action (reflow + coherence)"
```

---

## Task 4: Deploy the updated edge function ✅ DONE (2026-06-09)

> Full deno suite 96/96 via `--node-modules-dir=none` (closes the known "needs node_modules" env
> gap — and avoids the `--node-modules-dir=auto` hazard, which drops a `.deno` dir into pnpm's
> root node_modules and breaks vitest's jest-dom setup repo-wide). Deployed `generate-plan` to
> prod `ufufmcpnysvwtutpbian`; smoke: Kelowna generate returned exactly 1 itinerary.

**Files:** none (deploy step).

- [ ] **Step 1: Run the full generate-plan deno suite**

Run: `cd supabase/functions/generate-plan && deno test --allow-net --allow-env --no-check --node-modules-dir=auto`
Expected: PASS. Then restore root deps: `cd /Users/lucas/projects/After5 && pnpm install --frozen-lockfile`.

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy generate-plan --project-ref ufufmcpnysvwtutpbian`
Expected: "Deployed Functions ... generate-plan".

- [ ] **Step 3: Smoke (generate-1)**

Invoke generate-plan with a Kelowna request (anon key) and assert the response has exactly **1** itinerary. (Use the curl pattern from the prior cutover; expect `itineraries.length === 1`.)

- [ ] **Step 4: Commit** (no code; this is a deploy checkpoint — skip commit).

---

## Task 5: `DateCanvas` — the night + edit chips + publish ✅ DONE (commits 1cffe35, 30ee7eb) — folded in Task 10 (hint + quiet start-over)

**Files:**
- Create: `apps/web/app/create/canvas/DateCanvas.tsx`
- Create: `apps/web/app/create/canvas/__tests__/DateCanvas.test.tsx`

`DateCanvas` takes an `Itinerary`, renders the night (cover, title/hook, ordered stops, total time/$), a row of edit chips (title/image/stops), and a Publish CTA that routes to `/nights/new?itinerary=<id>`. It holds the working itinerary in state so applied edits re-render. Editor sheets (Tasks 6-8) mount from chips. Logistics/audience are handled by `/nights/new` (publish), per the planning decision.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import { DateCanvas } from '../DateCanvas';
const itin = {
  id: 'it1', title: 'Golden Hour', hook: 'two hours, one sunset',
  stops: [{ place_id: 'p1', place_name: 'Mission Hill', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }],
  total_cost_pp: 20, total_duration_min: 60, template_id: 't', template_name: 't', why_it_works: 'x', vibe: ['romantic'],
  cover_image_url: '/x.jpg',
};
test('renders the night and the edit chips', () => {
  render(<DateCanvas itinerary={itin as never} />);
  expect(screen.getByText('Golden Hour')).toBeInTheDocument();
  expect(screen.getByText('Mission Hill')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /title/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /image/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /stops/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /publish/i })).toHaveAttribute('href', '/nights/new?itinerary=it1');
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `cd apps/web && pnpm vitest run app/create/canvas/__tests__/DateCanvas.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `DateCanvas`**

```tsx
'use client';
// The customization canvas: the generated night is the hero; edit chips open
// focused sheets. Publish carries the customized itinerary into /nights/new.
// Copy rule: never the word "regenerate".
import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/cn';
import type { Itinerary, Stop } from '@/lib/itinerary-types';
import { TitleEditor } from './TitleEditor';
import { CoverEditor } from './CoverEditor';
import { StopsEditor } from './StopsEditor';

type Sheet = 'title' | 'image' | 'stops' | null;

export function DateCanvas({ itinerary }: { itinerary: Itinerary }) {
  const [draft, setDraft] = useState<Itinerary>(itinerary);
  const [sheet, setSheet] = useState<Sheet>(null);
  const id = draft.id ?? '';

  const chip = 'inline-flex min-h-[44px] items-center gap-1.5 rounded-pill bg-white/80 px-4 py-2 font-body text-sm lowercase text-shell-ink ring-1 ring-shell-ink/10 transition active:scale-95';

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] bg-shell-base px-5 pb-28 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <span className="font-heading text-xl lowercase text-shell-ink">your night</span>
        <Link href={`/nights/new?itinerary=${id}`}
          className="inline-flex min-h-[44px] items-center rounded-pill bg-shell-accent px-5 font-body text-sm font-semibold lowercase text-white shadow-fun active:scale-95">
          publish →
        </Link>
      </header>

      {/* the night (hero) */}
      <section className="overflow-hidden rounded-3xl bg-shell-pink/40 ring-1 ring-shell-ink/10">
        <div className="relative aspect-[4/3] w-full">
          {draft.cover_image_url && <Image src={draft.cover_image_url} alt="" fill sizes="480px" className="object-cover" />}
        </div>
        <div className="p-5">
          <h1 className="font-heading text-2xl lowercase leading-tight text-shell-ink">{draft.title}</h1>
          {draft.hook && <p className="mt-1 font-body text-sm text-shell-ink/70">{draft.hook}</p>}
          <ol className="mt-4 space-y-1.5">
            {draft.stops.map((s, i) => (
              <li key={`${s.place_id}-${i}`} className="font-body text-sm lowercase text-shell-ink">
                {i > 0 && <span className="mr-2 text-shell-ink/30">↓</span>}{s.place_name}
              </li>
            ))}
          </ol>
          <p className="mt-3 font-body text-xs lowercase tabular-nums text-shell-ink/55">
            {Math.round((draft.total_duration_min / 60) * 10) / 10} hr · ${Math.round(draft.total_cost_pp)}
          </p>
        </div>
      </section>

      {/* edit chips */}
      <p className="mt-6 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-ink/55">make it yours</p>
      <div className="mt-3 flex flex-wrap gap-2.5">
        <button type="button" className={chip} onClick={() => setSheet('title')}>✏️ title</button>
        <button type="button" className={chip} onClick={() => setSheet('image')}>🖼 image</button>
        <button type="button" className={chip} onClick={() => setSheet('stops')}>📍 stops</button>
      </div>

      {sheet === 'title' && (
        <TitleEditor itineraryId={id} current={{ title: draft.title, hook: draft.hook }}
          onApply={(t) => setDraft((d) => ({ ...d, title: t.title, hook: t.hook }))} onClose={() => setSheet(null)} />
      )}
      {sheet === 'image' && (
        <CoverEditor itineraryId={id} stops={draft.stops} current={draft.cover_image_url ?? null}
          onApply={(url) => setDraft((d) => ({ ...d, cover_image_url: url }))} onClose={() => setSheet(null)} />
      )}
      {sheet === 'stops' && (
        <StopsEditor itineraryId={id} stops={draft.stops}
          onApply={(stops) => setDraft((d) => ({ ...d, stops }))} onClose={() => setSheet(null)} />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run — PASS**

Run: `cd apps/web && pnpm vitest run app/create/canvas/__tests__/DateCanvas.test.tsx`
Expected: PASS. (The three editor modules must exist as stubs to import — if Tasks 6-8 aren't done yet, create empty stub components returning `null` so this compiles, then flesh them out.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/create/canvas/DateCanvas.tsx apps/web/app/create/canvas/__tests__/DateCanvas.test.tsx
git commit -m "feat(create): DateCanvas — night hero + edit chips + publish CTA"
```

---

## Task 6: `TitleEditor` sheet ✅ DONE (commit a909537)

**Files:**
- Create: `apps/web/app/create/canvas/TitleEditor.tsx`
- Create: `apps/web/app/create/canvas/__tests__/TitleEditor.test.tsx`

Mirrors the `callImprove` pattern in `ImproveControls.tsx` (invoke `generate-plan` via `browserAfter5Client().functions.invoke`, read `{ ok, title, hook, issues, error }`, toast on failure).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TitleEditor } from '../TitleEditor';
const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ functions: { invoke } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

test('another take applies the new title', async () => {
  invoke.mockResolvedValue({ data: { ok: true, title: 'New Title', hook: 'new hook' }, error: null });
  const onApply = vi.fn();
  render(<TitleEditor itineraryId="it1" current={{ title: 'Old', hook: 'h' }} onApply={onApply} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /another take/i }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith({ title: 'New Title', hook: 'new hook' }));
});
```

- [ ] **Step 2: Run — confirm FAIL**

Run: `cd apps/web && pnpm vitest run app/create/canvas/__tests__/TitleEditor.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `TitleEditor`**

```tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { browserAfter5Client } from '@/lib/after5/client';

type Tone = 'romantic' | 'playful' | 'casual';

export function TitleEditor({ itineraryId, current, onApply, onClose }: {
  itineraryId: string;
  current: { title: string; hook: string };
  onApply: (t: { title: string; hook: string }) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(current.title);

  async function call(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const { data, error } = await browserAfter5Client().functions.invoke<{ ok: boolean; title?: string; hook?: string; issues?: { message: string }[]; error?: string }>('generate-plan', { body });
      if (error || !data?.ok || !data.title) { toast.error(data?.issues?.[0]?.message ?? data?.error ?? 'that one slipped away. try again?'); return; }
      onApply({ title: data.title, hook: data.hook ?? current.hook });
      toast.success('new title.');
    } finally { setBusy(false); }
  }

  const btn = 'min-h-[44px] rounded-pill px-4 font-body text-sm lowercase ring-1 ring-shell-ink/15 bg-white/80 text-shell-ink active:scale-95 disabled:opacity-40';

  return (
    <Sheet onClose={onClose} title="the title">
      <button className={btn} disabled={busy} onClick={() => call({ action: 'regenerate_title', itinerary_id: itineraryId })}>another take</button>
      <div className="mt-3 flex flex-wrap gap-2">
        {(['romantic', 'playful', 'casual'] as Tone[]).map((t) => (
          <button key={t} className={btn} disabled={busy} onClick={() => call({ action: 'regenerate_title', itinerary_id: itineraryId, tone: t })}>more {t}</button>
        ))}
      </div>
      <div className="mt-4">
        <input value={manual} onChange={(e) => setManual(e.target.value)} aria-label="title"
          className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink" />
        <button className={cn(btn, 'mt-2')} disabled={busy || !manual.trim()}
          onClick={() => { onApply({ title: manual.trim(), hook: current.hook }); toast.success('saved.'); }}>
          write my own
        </button>
      </div>
    </Sheet>
  );
}

// Minimal bottom-sheet shell (extract to its own file if reused — for now colocate).
function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-shell-ink/30" onClick={onClose}>
      <div className="w-full rounded-t-3xl bg-shell-base p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <p className="font-heading text-lg lowercase text-shell-ink">{title}</p>
          <button aria-label="close" onClick={onClose} className="min-h-[44px] px-2 text-shell-ink/60">done</button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

> Note: when `write my own` writes a manual title, persist it. For MVP, the manual title is applied to the canvas state and will be saved at publish (carry it in the `/nights/new` payload) OR add a `manual_title` persist call mirroring `regenerate_title`'s update. Simplest: also send `{ action: 'regenerate_title', itinerary_id, manual: text }` — but that requires a schema field. For MVP, persist manual title via a tiny `itineraries` update from a server route, OR defer manual persistence and only apply visually. **Decision for MVP: manual title updates canvas state only; it is included in the publish payload at `/nights/new`.** (If `/nights/new` reads the title from the itinerary row, add a one-line `update({title})` in the publish handler — flag during execution.)

- [ ] **Step 4: Run — PASS**

Run: `cd apps/web && pnpm vitest run app/create/canvas/__tests__/TitleEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/create/canvas/TitleEditor.tsx apps/web/app/create/canvas/__tests__/TitleEditor.test.tsx
git commit -m "feat(create): TitleEditor sheet (another take / tone / write my own)"
```

---

## Task 7: `CoverEditor` sheet ✅ DONE (commits 80e3336, bbc7ce2)

> **MVP scope cut:** in-editor "fresh cover" (AI) DEFERRED to v1.1 — `generate-cover` is service-role/admin-only (Replicate cost) and would need an authed + rate-limited server route. CoverEditor ships venue-photo-selection only (free, client-only). Props are now `{ stops, onApply, onClose }` (no `itineraryId`/`current`). Shared `Sheet` extracted to `canvas/Sheet.tsx`.

**Files:**
- Create: `apps/web/app/create/canvas/CoverEditor.tsx`
- Create: `apps/web/app/create/canvas/__tests__/CoverEditor.test.tsx`

Two controls: **fresh cover** (invoke `generate-cover` for the itinerary, get a new `cover_image_url`) and **use a venue photo** (pick any stop's `photo_url` as the cover — client-only, then persist `cover_image_url`). Reuse the `Sheet` shell (extract it to `apps/web/app/create/canvas/Sheet.tsx` in this task so Title/Cover/Stops share it — DRY).

- [ ] **Step 1: Extract `Sheet` to its own file**

Move the `Sheet` component from `TitleEditor.tsx` into `apps/web/app/create/canvas/Sheet.tsx` (export it) and import it in `TitleEditor.tsx`. Re-run the TitleEditor test to confirm still green.

- [ ] **Step 2: Write the failing test**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverEditor } from '../CoverEditor';
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ functions: { invoke: vi.fn() } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

test('use a venue photo applies that stop photo as the cover', async () => {
  const onApply = vi.fn();
  const stops = [{ place_id: 'p1', place_name: 'A', photo_url: '/a.jpg' }];
  render(<CoverEditor itineraryId="it1" stops={stops as never} current={null} onApply={onApply} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /a\.jpg|use this photo|A/i }));
  expect(onApply).toHaveBeenCalledWith('/a.jpg');
});
```

- [ ] **Step 3: Run — confirm FAIL.** `cd apps/web && pnpm vitest run app/create/canvas/__tests__/CoverEditor.test.tsx`

- [ ] **Step 4: Implement `CoverEditor`**

```tsx
'use client';
import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';
import { Sheet } from './Sheet';

export function CoverEditor({ itineraryId, stops, current, onApply, onClose }: {
  itineraryId: string; stops: Stop[]; current: string | null;
  onApply: (url: string) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const photos = stops.map((s) => s.photo_url).filter((u): u is string => !!u);

  async function freshCover() {
    setBusy(true);
    try {
      const { data, error } = await browserAfter5Client().functions.invoke<{ cover_image_url?: string }>('generate-cover', { body: { itinerary_id: itineraryId } });
      if (error || !data?.cover_image_url) { toast.error('that one slipped away. try again?'); return; }
      onApply(data.cover_image_url); toast.success('fresh cover.');
    } finally { setBusy(false); }
  }

  const btn = 'min-h-[44px] rounded-pill px-4 font-body text-sm lowercase ring-1 ring-shell-ink/15 bg-white/80 text-shell-ink active:scale-95 disabled:opacity-40';

  return (
    <Sheet title="the cover" onClose={onClose}>
      <button className={btn} disabled={busy} onClick={freshCover}>fresh cover</button>
      {photos.length > 0 && (
        <>
          <p className="mt-4 font-body text-xs lowercase text-shell-ink/55">or use a venue photo</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((url, i) => (
              <button key={i} aria-label={`use ${url}`} onClick={() => { onApply(url); toast.success('cover set.'); }}
                className="relative aspect-square overflow-hidden rounded-2xl ring-1 ring-shell-ink/10">
                <Image src={url} alt="" fill sizes="120px" className="object-cover" />
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
```

> Note: confirm `generate-cover`'s request/response shape during execution (it's deployed; check `supabase/functions/generate-cover/index.ts` for the body it expects and whether it persists `cover_image_url` to the itinerary row — if it does, `onApply` just reflects it; if not, add an `itineraries.update({cover_image_url})` via a small server route). Also confirm `next.config` allows the cover image host.

- [ ] **Step 5: Run — PASS.** `cd apps/web && pnpm vitest run app/create/canvas/__tests__/CoverEditor.test.tsx`

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/create/canvas/CoverEditor.tsx apps/web/app/create/canvas/Sheet.tsx apps/web/app/create/canvas/TitleEditor.tsx apps/web/app/create/canvas/__tests__/CoverEditor.test.tsx
git commit -m "feat(create): CoverEditor sheet (fresh cover / use a venue photo) + shared Sheet"
```

---

## Task 8: `StopsEditor` sheet (swap + remove) ✅ DONE (commits f4900f7, 26d29e7)

**Files:**
- Create: `apps/web/app/create/canvas/StopsEditor.tsx`
- Create: `apps/web/app/create/canvas/__tests__/StopsEditor.test.tsx`

Reuses the existing `swap_stop` action and the new `remove_stop` (Task 3). Mirrors `ImproveControls`' coherence handling: `{ ok:false, issues }` → toast, never a silent change.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StopsEditor } from '../StopsEditor';
const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ functions: { invoke } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

test('swap this stop applies returned stops', async () => {
  invoke.mockResolvedValue({ data: { ok: true, stops: [{ place_id: 'pX', place_name: 'X' }] }, error: null });
  const onApply = vi.fn();
  render(<StopsEditor itineraryId="it1" stops={[{ place_id: 'p1', place_name: 'A' }] as never} onApply={onApply} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /swap this stop/i }));
  await waitFor(() => expect(onApply).toHaveBeenCalledWith([{ place_id: 'pX', place_name: 'X' }]));
});

test('incoherent change surfaces an error, no apply', async () => {
  invoke.mockResolvedValue({ data: { ok: false, issues: [{ message: 'breaks the flow' }] }, error: null });
  const onApply = vi.fn();
  render(<StopsEditor itineraryId="it1" stops={[{ place_id: 'p1', place_name: 'A' }] as never} onApply={onApply} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /swap this stop/i }));
  await waitFor(() => expect(onApply).not.toHaveBeenCalled());
});
```

- [ ] **Step 2: Run — confirm FAIL.** `cd apps/web && pnpm vitest run app/create/canvas/__tests__/StopsEditor.test.tsx`

- [ ] **Step 3: Implement `StopsEditor`**

```tsx
'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';
import { Sheet } from './Sheet';

export function StopsEditor({ itineraryId, stops, onApply, onClose }: {
  itineraryId: string; stops: Stop[];
  onApply: (stops: Stop[]) => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);

  async function act(body: Record<string, unknown>, idx: number) {
    if (busy !== null) return;
    setBusy(idx);
    try {
      const { data, error } = await browserAfter5Client().functions.invoke<{ ok: boolean; stops?: Stop[]; issues?: { message: string }[]; error?: string }>('generate-plan', { body });
      if (error || !data?.ok || !data.stops) { toast.error(data?.issues?.[0]?.message ?? data?.error ?? 'that change breaks the flow of the night.'); return; }
      onApply(data.stops); toast.success('updated.');
    } finally { setBusy(null); }
  }

  const btn = 'min-h-[44px] rounded-pill px-3 font-body text-xs lowercase ring-1 ring-shell-ink/15 bg-white/80 text-shell-ink active:scale-95 disabled:opacity-40';
  const isLast = (i: number) => i === stops.length - 1;

  return (
    <Sheet title="the stops" onClose={onClose}>
      <ul className="space-y-3">
        {stops.map((s, i) => (
          <li key={`${s.place_id}-${i}`} className="rounded-2xl border border-shell-ink/10 bg-white/70 p-3">
            <p className="font-body text-sm lowercase text-shell-ink">{s.place_name}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button className={btn} disabled={busy !== null}
                onClick={() => act({ action: 'swap_stop', itinerary_id: itineraryId, stop_index: i }, i)}>
                {isLast(i) ? 'change the ending' : 'swap this stop'}
              </button>
              {stops.length > 1 && (
                <button className={btn} disabled={busy !== null}
                  onClick={() => act({ action: 'remove_stop', itinerary_id: itineraryId, stop_index: i }, i)}>
                  drop this stop
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run — PASS.** `cd apps/web && pnpm vitest run app/create/canvas/__tests__/StopsEditor.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/create/canvas/StopsEditor.tsx apps/web/app/create/canvas/__tests__/StopsEditor.test.tsx
git commit -m "feat(create): StopsEditor sheet (swap / change the ending / drop a stop)"
```

---

## Task 9: Wire the canvas into the create flow ✅ DONE — REVISED BY CONVERGENCE DECISION (commits 60a8707, 41330df)

> **CONVERGENCE DECISION (2026-06-09, user-approved):** mid-execution we found the codebase already
> had a richer canvas — `ItineraryEditor` at `/plans/[id]/edit` (#85 "§2A canvas": manual title,
> cover pick + upload, stop rename/reorder/remove, custom venue search/add, publish CTA). Building
> `DateCanvas` alongside it would have duplicated a better surface. Resolution:
> - **Scrapped** `app/create/canvas/` (DateCanvas, TitleEditor, CoverEditor, StopsEditor, Sheet) — deleted in 41330df.
> - **ItineraryEditor gained the net-new AI affordances** (60a8707): "another take" / tone title chips
>   (the `regenerate_title` backend from Task 2) + `ImproveControls` (swap/NL-tweak) mounted for
>   generated nights (`city_id` present), placed before publish to keep FLOW-01 intact.
> - **CreateFlow** now lands authed generations directly on `/plans/[id]/edit` (door 1 = door 2);
>   anon teaser + authed-without-id fallback unchanged. FLOW-01 wiring spec updated accordingly.
> - Tasks 5–8 and 10 below produced components that were superseded and deleted; their reviewed
>   patterns (invoke/toast idioms, copy rules) carried into the editor work. Backend Tasks 1–3 stand.

**Files:**
- Modify: `apps/web/app/create/CreateFlow.tsx` (the `Results` render path + the `generate()` success branch)
- Test: `apps/web/app/create/__tests__/primary-path-wiring.test.tsx` (extend the existing wiring test)

- [ ] **Step 1: Read the current results branch**

In `CreateFlow.tsx`, find where `phase === 'results'` renders the `Results` component over `itineraries` (multiple candidates). The generated response now has 1 itinerary.

- [ ] **Step 2: Render `DateCanvas` for the single itinerary**

Replace the `Results` render in the `results` phase with:

```tsx
{phase === 'results' && itineraries[0] && (
  <DateCanvas itinerary={itineraries[0]} />
)}
```

Add `import { DateCanvas } from './canvas/DateCanvas';` at the top. Leave `Results` in the file for now (dead) or delete it if nothing else references it — confirm with a grep before deleting.

- [ ] **Step 3: Update/extend the wiring test**

In `primary-path-wiring.test.tsx`, after a mocked generation, assert the canvas renders (the title + a `publish` link) instead of a 3-candidate list. Use the existing mock-generation setup in that file; assert `screen.getByText(<mocked title>)` and the publish link href.

- [ ] **Step 4: Run the create suite**

Run: `cd apps/web && pnpm vitest run app/create`
Expected: PASS (canvas wiring + the editors).

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: clean (TC: 0).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/create/CreateFlow.tsx apps/web/app/create/__tests__/primary-path-wiring.test.tsx
git commit -m "feat(create): land single generated date on DateCanvas (retire 3-candidate picker)"
```

---

## Task 10: First-run hint + quiet restart ✅ DONE (folded into Task 5, commit 1cffe35)

**Files:**
- Modify: `apps/web/app/create/canvas/DateCanvas.tsx`
- Test: `apps/web/app/create/canvas/__tests__/DateCanvas.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
test('shows a first-run hint', () => {
  render(<DateCanvas itinerary={itin as never} />);
  expect(screen.getByText(/tap any chip to make it yours/i)).toBeInTheDocument();
});
test('start over is present and quiet (links back to filters)', () => {
  render(<DateCanvas itinerary={itin as never} />);
  expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — confirm FAIL.**

- [ ] **Step 3: Implement**

Add under the chips a one-line hint `<p className="mt-3 font-body text-xs lowercase text-shell-ink/45">tap any chip to make it yours</p>` and a small quiet "start over" button at the very bottom that calls a confirm then navigates back to the filters step (e.g. `router.replace('/create/generate')` or resets the parent `phase` to `'input'`). It must be visually de-emphasized (small, muted) — NOT a primary CTA. Show a confirm (`window.confirm('start over? you'll lose your tweaks.')`).

- [ ] **Step 4: Run — PASS.** `cd apps/web && pnpm vitest run app/create/canvas`

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/create/canvas/DateCanvas.tsx apps/web/app/create/canvas/__tests__/DateCanvas.test.tsx
git commit -m "feat(create): first-run hint + quiet confirmed start-over on the canvas"
```

---

## Task 11: Visual verification @420px ✅ DONE (2026-06-09, commit 42de272)

> Scripted-Playwright capture of `/plans/[id]/edit` @420px (spec `apps/web/e2e/m3-canvas-visual.spec.ts`,
> CAPTURE_VISUAL-gated). Rubric: all PASS. One real defect found+fixed: stop-card start-time input
> clipped at 420px (w-24 siblings squeezed it) → w-20. Reported non-blocking: save+publish are two
> identical stacked primaries (consider demoting save); the global "first 100 members" banner is
> off-voice for dating surfaces (pre-existing, out of scope).

**Files:** none (verification).

- [ ] **Step 1: Capture the canvas + one open sheet** using the repo's scripted-Playwright recipe (`docs/superpowers/playwright-authed-flow.md`): authed local session, navigate to a generated date, screenshot the canvas, open the title sheet, screenshot it — all at 420px.

- [ ] **Step 2: Review against the design rubric** (Barbiecore: shell tokens, lowercase/dry copy, ≥44px taps, the night is visually the hero, chips clearly secondary, no "regenerate" wording anywhere). Fix any drift, re-capture.

- [ ] **Step 3: Commit** any visual fixes with `style(create): @420px canvas polish`.

---

## Optional follow-on (stage only if MVP lands well — NOT required for launch)

- **`search a specific venue` + `add stop`:** add a `search_venue` improve action that name-searches the `places` corpus near the itinerary's city (and, per the Google-seed decision, optionally live FSQ/Google), returns candidates, and an `add_stop` action that inserts a chosen place + reflows + validates coherence. Add a search field + results list to `StopsEditor`. This is the heaviest new backend — do it as its own plan once the core canvas proves out.
- **Fold logistics/audience into canvas sheets** (the spec's preferred publish path) instead of routing to `/nights/new`.

---

## Self-Review

- **Spec coverage:** generate-1 (T1) ✓ · canvas/night-hero (T5) ✓ · title another-take/tone/manual (T2,T6) ✓ · cover fresh/venue-photo (T7) ✓ · stops swap/change-ending/drop (T3,T8) ✓ · publish via /nights/new (T5 CTA) ✓ · no-re-roll + quiet restart + first-run hint (T10) ✓ · ownership copy / no "regenerate" (enforced in every editor's labels) ✓ · logistics/audience (reused via /nights/new per planning decision) ✓ · visual-verify @420px (T11) ✓. Search/add-venue + fold-in-publish are explicitly staged as optional follow-on (spec "In" for search/add is consciously deferred to keep MVP shippable — flagged here, not silently dropped).
- **Placeholders:** the two "confirm during execution" notes (generate-cover shape; manual-title persistence) are real, bounded verification steps with the exact file to check + the fallback action, not vague TODOs.
- **Type consistency:** `Itinerary`/`Stop` from `@/lib/itinerary-types` used throughout; editor `onApply` signatures match what `DateCanvas` passes (`{title,hook}` / `string` url / `Stop[]`); improve actions (`regenerate_title`, `remove_stop`, `swap_stop`) match the schema added in T2/T3.

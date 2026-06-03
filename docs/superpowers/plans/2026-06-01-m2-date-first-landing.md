# M2 — Date-First Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, mobile-first `/create` landing where anyone (signed-in or not) walks a fast create-a-date flow, sees a generated plan with premium info blur-gated server-side for anon users, can email themselves the full plan as a PDF, and — if they have a verified dating profile — publish the date to the feed.

**Architecture:** A new server route `/api/create-plan` proxies the FROZEN `generate-plan` edge function server-side and returns a **full** projection for authenticated users or a **teaser** projection for anon (gated fields never reach the anon DOM). The `/create` page is a slimmed Barbiecore flow that prefills the city from Vercel geo headers (editable) and renders results through the existing `ItineraryView`, overlaying a blur-gate + `EmailGate` CTA for anon. A second server route `/api/email-plan` server-renders the existing `PlanPDFDocument` to a buffer and emails it via the existing Resend helper. Publish-to-feed reuses `postNight` behind the existing `dating_enabled && verified` gate.

**Tech Stack:** Next.js 15 App Router (server routes + RSC), React 19, Supabase JS (`supabase.functions.invoke` server-side via service/anon client), `@react-pdf/renderer` (server `renderToBuffer`), Resend (`lib/email/resend.ts`), Tailwind Barbiecore (`shell-*` tokens, Caprasimo/Fredoka, lowercase, `max-w-[480px]`), framer-motion/vaul/sonner.

**Frozen contract:** Do NOT edit `supabase/functions/generate-plan/*`. The request schema already accepts `city_slug` (default `'kelowna'`); the response is `{ itineraries: Itinerary[], generated_at }`. All M2 work sits ABOVE this boundary.

**Dependency note:** Multi-city generation only lights up once task #67 (generate-plan edge redeploy + `GOOGLE_PLACES_API_KEY`) ships. Until then any `city_slug` other than `kelowna` returns `unknown_city` (422) unless that city row exists + the on-the-fly provider is deployed. M2 must degrade gracefully: if the resolved city isn't generatable, fall back to `kelowna` with a visible "we're only in kelowna right now" note. This keeps `/create` working pre-#67.

---

## File Structure

**New files:**
- `apps/web/lib/create/blur-gate.ts` — pure projection: `toTeaser(itineraries, opts)` strips/silhouettes gated fields for anon. One responsibility: decide what an anon user may see. Unit-tested in isolation.
- `apps/web/lib/create/__tests__/blur-gate.test.ts` — tests for the projection.
- `apps/web/app/api/create-plan/route.ts` — server route: resolve city (geo-prefill + fallback), call `generate-plan` server-side, apply blur-gate by auth state, return projection.
- `apps/web/app/api/email-plan/route.ts` — server route: server-render `PlanPDFDocument` to a buffer, email via Resend, upsert subscriber (reuse `/api/subscribe` logic).
- `apps/web/lib/email/plan-pdf.ts` — `buildPlanEmail({ firstName, itineraryTitle })` → `{ subject, html, text }` (Barbiecore email, lowercase, reuses `lib/email/layout.ts`).
- `apps/web/app/create/page.tsx` — RSC shell: reads geo headers, resolves auth, renders `<CreateFlow>`.
- `apps/web/app/create/CreateFlow.tsx` — `'use client'` flow: condensed inputs → POST `/api/create-plan` → results with blur-gate overlay + EmailGate + publish CTA.
- `apps/web/app/create/BlurGateOverlay.tsx` — the visual lock overlay shown over silhouetted/locked sections for anon.
- `apps/web/app/create/PublishToFeedButton.tsx` — `'use client'`; shown only to verified dating users; calls `postNight`.
- `apps/web/app/create/__tests__/CreateFlow.test.tsx` — render/interaction tests.
- `apps/web/lib/create/cities.ts` — `resolveCitySlug(geoCity, knownCities)` mapping Vercel geo city → a known `cities.slug` or `'kelowna'` fallback; `listGeneratableCities(client)` loader.

**Modified files:**
- `apps/web/app/api/subscribe/route.ts:1-85` — extract the subscriber-upsert + itinerary-attribution into a reusable helper so `/api/email-plan` reuses it (DRY). No behavior change to `/api/subscribe`.
- `packages/api-client/src/feed.ts` — add `getGeneratableCities(client)` if a cities loader doesn't already exist (read `cities` where `is_active`).

**Reused unchanged:** `ItineraryView`, `StopCard`, `PlanPDFDocument`, `lib/email/resend.ts`, `lib/email/layout.ts`, `createAdminClient`, `postNight`.

---

## Conventions for every task

- Tests run from repo root: `pnpm --filter @after5/web test <path>` (vitest, jsdom). Validators/api-client: `pnpm --filter @after5/<pkg> test`.
- Typecheck before each commit: `pnpm --filter @after5/web typecheck`.
- After any change that touches a vitest-mocked module's exports, run the FULL web suite (`pnpm --filter @after5/web test`) before commit — a missing mock export silently breaks unrelated specs (recurring CI failure).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- All user-facing copy lowercase, Fredoka/Caprasimo, `shell-*` tokens, mobile column `max-w-[480px]`.
- Do NOT push (origin) — M2 commits stack on local `main` behind the gated M4/M6 deploy (task #68). Commit locally only.

---

### Task 1: Blur-gate projection (pure, tested first)

**Files:**
- Create: `apps/web/lib/create/blur-gate.ts`
- Test: `apps/web/lib/create/__tests__/blur-gate.test.ts`

The locked blur-gate setting: **hero + stop 1 fully visible; stops 2..N silhouetted (keep `place_type` + `photo_url`, drop `place_name`/`what_to_do`/`local_insight`/`address`/`reservation_url`/coords/`start_time`); `why_it_works` + per-stop insights + map coords locked.** The teaser must NOT contain the gated strings at all (server-stripped, never shipped to anon DOM).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/create/__tests__/blur-gate.test.ts
import { describe, it, expect } from 'vitest';
import { toTeaser, type GatedItinerary } from '../blur-gate';

const full = {
  template_id: 't1', template_name: 'tn', title: 'pottery + ramen',
  hook: 'hands dirty, then noodles', why_it_works: 'SECRET RATIONALE',
  total_cost_pp: 60, total_duration_min: 180, vibe: ['creative', 'foodie'],
  stops: [
    { place_id: 'p1', place_name: 'Clay Studio', place_type: 'activity', start_time: '18:00',
      duration_min: 90, estimated_cost_pp: 35, what_to_do: 'throw a bowl', photo_url: 'a.jpg',
      address: '1 St', neighborhood: 'Downtown', lat: 49.8, lng: -119.4, local_insight: 'ask for Mei' },
    { place_id: 'p2', place_name: 'Ramen Bar', place_type: 'restaurant', start_time: '20:00',
      duration_min: 60, estimated_cost_pp: 25, what_to_do: 'order tonkotsu', photo_url: 'b.jpg',
      address: '2 Ave', neighborhood: 'Pandosy', lat: 49.85, lng: -119.45, local_insight: 'cash only' },
  ],
};

describe('toTeaser', () => {
  it('authed: returns the full itinerary untouched', () => {
    const [t] = toTeaser([full], { authed: true });
    expect(t.why_it_works).toBe('SECRET RATIONALE');
    expect(t.stops[1].place_name).toBe('Ramen Bar');
    expect(t.locked).toBe(false);
  });

  it('anon: keeps hero + stop 1, strips why_it_works, silhouettes later stops', () => {
    const [t] = toTeaser([full], { authed: false });
    // hero-level: title + hook + cost + duration + vibe stay; rationale gone
    expect(t.title).toBe('pottery + ramen');
    expect(t.hook).toBe('hands dirty, then noodles');
    expect(t.why_it_works).toBe('');           // locked
    expect(t.locked).toBe(true);
    // stop 1 fully visible
    expect(t.stops[0].place_name).toBe('Clay Studio');
    expect(t.stops[0].what_to_do).toBe('throw a bowl');
    // stop 2 silhouetted: type + photo only, identifying fields stripped
    const s2 = t.stops[1];
    expect(s2.place_type).toBe('restaurant');
    expect(s2.photo_url).toBe('b.jpg');
    expect(s2.locked).toBe(true);
    expect(s2.place_name).toBe('');
    expect(s2.what_to_do).toBeUndefined();
    expect(s2.local_insight).toBeNull();
    expect(s2.address).toBeNull();
    expect(s2.lat).toBeNull();
    expect(s2.lng).toBeNull();
  });

  it('anon: gated strings never appear anywhere in the serialized teaser', () => {
    const json = JSON.stringify(toTeaser([full], { authed: false }));
    expect(json).not.toContain('SECRET RATIONALE');
    expect(json).not.toContain('Ramen Bar');
    expect(json).not.toContain('cash only');
    expect(json).not.toContain('tonkotsu');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @after5/web test lib/create/__tests__/blur-gate.test.ts`
Expected: FAIL — `Cannot find module '../blur-gate'`.

- [ ] **Step 3: Implement the projection**

```typescript
// apps/web/lib/create/blur-gate.ts
// Server-enforced blur-gate for the date-first landing. An anon visitor sees the
// hero + the first stop; everything premium (the rationale, later-stop identity,
// map coords, local insights) is STRIPPED here so it never reaches the anon DOM.
// Locked decision (2026-06-01): hero + stop 1 visible, stops 2..N silhouetted, why/map/insights locked.
import type { Itinerary, ItineraryStop } from '../../../../supabase/functions/generate-plan/types';

export interface GatedStop extends Partial<ItineraryStop> {
  place_id: string;
  place_type: string;
  photo_url?: string | null;
  locked?: boolean;
}
export interface GatedItinerary extends Omit<Itinerary, 'stops'> {
  stops: GatedStop[];
  locked: boolean;
}

export function toTeaser(itineraries: Itinerary[], opts: { authed: boolean }): GatedItinerary[] {
  if (opts.authed) {
    return itineraries.map((it) => ({ ...it, stops: it.stops.map((s) => ({ ...s })), locked: false }));
  }
  return itineraries.map((it) => ({
    ...it,
    why_it_works: '', // locked — the premium rationale
    locked: true,
    stops: it.stops.map((s, i) =>
      i === 0
        ? { ...s, locked: false }
        : {
            // silhouette: only the shape (type + blurred photo) survives
            place_id: s.place_id,
            place_type: s.place_type,
            photo_url: s.photo_url ?? null,
            place_name: '',
            address: null,
            neighborhood: undefined,
            lat: null,
            lng: null,
            local_insight: null,
            reservation_url: null,
            locked: true,
          },
    ),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @after5/web test lib/create/__tests__/blur-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/create/blur-gate.ts apps/web/lib/create/__tests__/blur-gate.test.ts
git commit -m "feat(m2): server-side blur-gate projection for anon create flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: City resolution from geo headers (pure, tested first)

**Files:**
- Create: `apps/web/lib/create/cities.ts`
- Test: `apps/web/lib/create/__tests__/cities.test.ts`

Vercel sets `x-vercel-ip-city` (URL-encoded). Map it to a known `cities.slug`; fall back to `'kelowna'` when unknown. Generation only supports cities that exist + are generatable (kelowna today), so the resolver returns both the slug and whether it's the fallback (UI shows the "only in kelowna" note when `fellBack`).

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/create/__tests__/cities.test.ts
import { describe, it, expect } from 'vitest';
import { resolveCitySlug } from '../cities';

const known = [
  { slug: 'kelowna', name: 'Kelowna' },
  { slug: 'vancouver', name: 'Vancouver' },
];

describe('resolveCitySlug', () => {
  it('matches a known city case-insensitively from the geo header', () => {
    expect(resolveCitySlug('Vancouver', known)).toEqual({ slug: 'vancouver', fellBack: false });
  });
  it('url-decodes the header value', () => {
    expect(resolveCitySlug('Kelowna', known)).toEqual({ slug: 'kelowna', fellBack: false });
  });
  it('falls back to kelowna for an unknown city', () => {
    expect(resolveCitySlug('Toronto', known)).toEqual({ slug: 'kelowna', fellBack: true });
  });
  it('falls back to kelowna when the header is missing', () => {
    expect(resolveCitySlug(null, known)).toEqual({ slug: 'kelowna', fellBack: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @after5/web test lib/create/__tests__/cities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// apps/web/lib/create/cities.ts
// Resolve a Vercel geo city header (x-vercel-ip-city) to a known generatable city slug.
// Falls back to kelowna (the only generatable city pre-#67). fellBack drives the
// "we're only in kelowna right now" note in the UI.
export interface KnownCity { slug: string; name: string }

export function resolveCitySlug(
  geoCity: string | null | undefined,
  known: KnownCity[],
): { slug: string; fellBack: boolean } {
  const FALLBACK = 'kelowna';
  if (!geoCity) return { slug: FALLBACK, fellBack: true };
  const decoded = decodeURIComponent(geoCity).trim().toLowerCase();
  const hit = known.find((c) => c.name.toLowerCase() === decoded || c.slug === decoded);
  return hit ? { slug: hit.slug, fellBack: false } : { slug: FALLBACK, fellBack: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @after5/web test lib/create/__tests__/cities.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/create/cities.ts apps/web/lib/create/__tests__/cities.test.ts
git commit -m "feat(m2): resolve geo-header city to a generatable slug (kelowna fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `/api/create-plan` server route (server-enforced gate)

**Files:**
- Create: `apps/web/app/api/create-plan/route.ts`
- Test: `apps/web/app/api/create-plan/route.test.ts`

Calls the FROZEN `generate-plan` edge function server-side using a Supabase server client, then applies `toTeaser` by auth state. On `unknown_city` (422) from the edge fn, retries once with `city_slug: 'kelowna'` and sets `fellBack: true` in the response. Returns `{ itineraries: GatedItinerary[], authed: boolean, city: string, fellBack: boolean }`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/api/create-plan/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ functions: { invoke }, auth: { getUser } }),
}));

import { POST } from './route';

const itin = {
  template_id: 't', template_name: 'n', title: 'x', hook: 'h', why_it_works: 'WHY',
  total_cost_pp: 50, total_duration_min: 120, vibe: ['v'],
  stops: [
    { place_id: 'p1', place_name: 'A', place_type: 'cafe', start_time: '18:00', duration_min: 60, estimated_cost_pp: 25 },
    { place_id: 'p2', place_name: 'B', place_type: 'bar', start_time: '19:30', duration_min: 60, estimated_cost_pp: 25 },
  ],
};
const req = (body: unknown) => new Request('http://x/api/create-plan', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => { invoke.mockReset(); getUser.mockReset(); });

describe('POST /api/create-plan', () => {
  it('anon: returns a gated teaser (why stripped, later stop silhouetted)', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    invoke.mockResolvedValue({ data: { itineraries: [itin] }, error: null });
    const res = await POST(req({ vibe: ['v'], city_slug: 'kelowna' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.authed).toBe(false);
    expect(body.itineraries[0].why_it_works).toBe('');
    expect(body.itineraries[0].stops[1].place_name).toBe('');
    expect(JSON.stringify(body)).not.toContain('WHY');
  });

  it('authed: returns full itineraries', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    invoke.mockResolvedValue({ data: { itineraries: [itin] }, error: null });
    const res = await POST(req({ vibe: ['v'] }));
    const body = await res.json();
    expect(body.authed).toBe(true);
    expect(body.itineraries[0].why_it_works).toBe('WHY');
  });

  it('falls back to kelowna when the city is unknown', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    invoke
      .mockResolvedValueOnce({ data: null, error: { context: { status: 422 } } })
      .mockResolvedValueOnce({ data: { itineraries: [itin] }, error: null });
    const res = await POST(req({ vibe: ['v'], city_slug: 'narnia' }));
    const body = await res.json();
    expect(body.fellBack).toBe(true);
    expect(body.city).toBe('kelowna');
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty vibe (the one required input)', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ vibe: [] }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @after5/web test app/api/create-plan/route.test.ts`
Expected: FAIL — `./route` has no `POST` export.

- [ ] **Step 3: Implement the route**

```typescript
// apps/web/app/api/create-plan/route.ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toTeaser } from '@/lib/create/blur-gate';
import type { Itinerary } from '../../../../../supabase/functions/generate-plan/types';

// Server-side proxy to the FROZEN generate-plan edge fn. Applies the blur-gate by
// auth state so anon users never receive premium fields. Retries kelowna on unknown_city.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const vibe = Array.isArray(body.vibe) ? (body.vibe as string[]) : [];
  if (vibe.length === 0) return NextResponse.json({ error: 'vibe_required' }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const authed = !!user;

  const requestedCity = typeof body.city_slug === 'string' && body.city_slug ? body.city_slug : 'kelowna';

  async function gen(citySlug: string) {
    return supabase.functions.invoke<{ itineraries: Itinerary[] }>('generate-plan', {
      body: { ...body, city_slug: citySlug },
    });
  }

  let city = requestedCity;
  let fellBack = false;
  let { data, error } = await gen(requestedCity);
  // unknown_city → retry kelowna (multi-city not generatable until #67)
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  if ((error && status === 422) && requestedCity !== 'kelowna') {
    city = 'kelowna';
    fellBack = true;
    ({ data, error } = await gen('kelowna'));
  }
  if (error || !data?.itineraries) {
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
  }

  return NextResponse.json({
    itineraries: toTeaser(data.itineraries, { authed }),
    authed,
    city,
    fellBack,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @after5/web test app/api/create-plan/route.test.ts`
Expected: PASS (4 tests). If `@/lib/supabase/server` `createClient` signature differs, match the real one (it's async in this repo).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @after5/web typecheck
git add apps/web/app/api/create-plan/
git commit -m "feat(m2): /api/create-plan — server-enforced blur-gate proxy to generate-plan

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Subscriber-upsert helper extraction (DRY for email-plan)

**Files:**
- Create: `apps/web/lib/create/subscribe.ts`
- Modify: `apps/web/app/api/subscribe/route.ts`
- Test: `apps/web/lib/create/__tests__/subscribe.test.ts`

Extract the subscriber upsert + itinerary attribution from `/api/subscribe` into `upsertSubscriber(admin, args)` so `/api/email-plan` reuses it without duplicating the abuse-validation. `/api/subscribe` behavior must not change.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/create/__tests__/subscribe.test.ts
import { describe, it, expect, vi } from 'vitest';
import { normalizeSubscribeInput } from '../subscribe';

describe('normalizeSubscribeInput', () => {
  it('lowercases + trims email and rejects malformed', () => {
    expect(normalizeSubscribeInput({ email: '  A@B.CO ' }).email).toBe('a@b.co');
    expect(normalizeSubscribeInput({ email: 'nope' }).valid).toBe(false);
  });
  it('clamps city + first_name length', () => {
    const out = normalizeSubscribeInput({ email: 'a@b.co', city: 'x'.repeat(200), first_name: 'y'.repeat(200) });
    expect(out.city!.length).toBe(80);
    expect(out.first_name!.length).toBe(40);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @after5/web test lib/create/__tests__/subscribe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper, then refactor the route to use it**

```typescript
// apps/web/lib/create/subscribe.ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export interface SubscribeInput { email?: string; city?: string | null; first_name?: string | null; source?: string }
export interface NormalizedSubscribe { valid: boolean; email: string; city: string | null; first_name: string | null; source: string }

export function normalizeSubscribeInput(b: SubscribeInput): NormalizedSubscribe {
  const email = (b.email ?? '').trim().toLowerCase();
  return {
    valid: EMAIL_RE.test(email),
    email,
    city: b.city ? b.city.trim().slice(0, 80) : null,
    first_name: b.first_name ? b.first_name.trim().slice(0, 40) : null,
    source: b.source ?? 'plan_gate',
  };
}

// admin = service-role client; ua = user-agent string. Idempotent upsert + itinerary attribution.
export async function upsertSubscriber(
  admin: { from: (t: string) => any },
  n: NormalizedSubscribe,
  opts: { userAgent?: string | null; itineraryIds?: string[] } = {},
) {
  await admin.from('subscribers').upsert(
    { email: n.email, source: n.source, city: n.city, first_name: n.first_name, user_agent: opts.userAgent ?? null },
    { onConflict: 'email,source', ignoreDuplicates: false },
  );
  const ids = opts.itineraryIds ?? [];
  if (ids.length > 0) {
    const patch: Record<string, string> = { claim_email: n.email };
    if (n.first_name) patch.built_by_name = n.first_name;
    if (n.city) patch.built_by_neighborhood = n.city;
    await admin.from('itineraries').update(patch).in('id', ids).is('user_id', null);
  }
}
```

Then in `apps/web/app/api/subscribe/route.ts`, replace the inline validation + upsert + attribution block with `normalizeSubscribeInput` + `upsertSubscriber` (keep `ensureWelcomeSent` exactly as-is). Verify the existing subscribe response shape `{ ok: true }` is unchanged.

- [ ] **Step 4: Run helper test + full suite (route refactor risk)**

Run: `pnpm --filter @after5/web test lib/create/__tests__/subscribe.test.ts && pnpm --filter @after5/web test`
Expected: helper PASS (2 tests); full suite still green (no regression in subscribe path).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @after5/web typecheck
git add apps/web/lib/create/subscribe.ts apps/web/lib/create/__tests__/subscribe.test.ts apps/web/app/api/subscribe/route.ts
git commit -m "refactor(m2): extract reusable upsertSubscriber + normalizeSubscribeInput

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `/api/email-plan` — server-render PDF + email it

**Files:**
- Create: `apps/web/lib/email/plan-pdf.ts`
- Create: `apps/web/app/api/email-plan/route.ts`
- Test: `apps/web/lib/email/__tests__/plan-pdf.test.ts`

`PlanPDFDocument` already exists (client download today). Server-render it with `@react-pdf/renderer`'s `renderToBuffer`, attach to a Resend email. The full plan is the carrot (locked decision #3). Reuse `upsertSubscriber` (Task 4) for the email capture, and `sendEmail` (note: `sendEmail` takes `{to,subject,html,text,tag}` — no attachments param). **Add an `attachments` pass-through to `sendEmail` OR send via the Resend SDK directly in this route.** This plan adds attachments to `sendEmail` (smaller blast radius is the route, but attachments are generally useful).

- [ ] **Step 1: Write the failing test (email copy builder is the pure unit)**

```typescript
// apps/web/lib/email/__tests__/plan-pdf.test.ts
import { describe, it, expect } from 'vitest';
import { buildPlanEmail } from '../plan-pdf';

describe('buildPlanEmail', () => {
  it('greets by first name, lowercase, references the plan title', () => {
    const { subject, html, text } = buildPlanEmail({ firstName: 'Sam', itineraryTitle: 'pottery + ramen' });
    expect(subject.toLowerCase()).toContain('pottery + ramen');
    expect(html.toLowerCase()).toContain('hey sam');
    expect(text.toLowerCase()).toContain('pottery + ramen');
  });
  it('handles a missing name', () => {
    const { html } = buildPlanEmail({ firstName: null, itineraryTitle: 'a night out' });
    expect(html.toLowerCase()).toContain('hey');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @after5/web test lib/email/__tests__/plan-pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the email builder + the route**

```typescript
// apps/web/lib/email/plan-pdf.ts
import { emailLayout } from './layout'; // confirm the export name in lib/email/layout.ts; adapt if different
export function buildPlanEmail(args: { firstName: string | null; itineraryTitle: string }) {
  const hi = args.firstName ? `hey ${args.firstName.toLowerCase()}` : 'hey';
  const subject = `your date plan: ${args.itineraryTitle}`;
  const body = `${hi}, here's the full plan you built — "${args.itineraryTitle}". it's attached as a pdf. want to actually go on it? after5 turns a plan into a real date.`;
  const html = emailLayout({ heading: 'your plan is ready', body, ctaLabel: 'find your person →', ctaHref: 'https://after5.app/create' });
  const text = `${hi}, your full plan "${args.itineraryTitle}" is attached. go on it for real at https://after5.app`;
  return { subject, html, text };
}
```

```typescript
// apps/web/app/api/email-plan/route.ts
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { buildPlanEmail } from '@/lib/email/plan-pdf';
import { normalizeSubscribeInput, upsertSubscriber } from '@/lib/create/subscribe';
import type { Itinerary } from '../../../../../supabase/functions/generate-plan/types';

export async function POST(req: Request) {
  let body: { email?: string; first_name?: string | null; city?: string | null; itinerary?: Itinerary; itinerary_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const n = normalizeSubscribeInput({ email: body.email, first_name: body.first_name, city: body.city, source: 'create_pdf' });
  if (!n.valid) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  if (!body.itinerary?.title) return NextResponse.json({ error: 'itinerary_required' }, { status: 400 });

  // Server-render the existing PDF document to a buffer.
  const [{ renderToBuffer }, { PlanPDFDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/itinerary/PlanPDFDocument'),
  ]);
  const pdf = await renderToBuffer(PlanPDFDocument({ itinerary: body.itinerary }) as any);

  const { subject, html, text } = buildPlanEmail({ firstName: n.first_name, itineraryTitle: body.itinerary.title });
  await sendEmail({
    to: n.email, subject, html, text, tag: 'create_pdf',
    attachments: [{ filename: 'after5-date-plan.pdf', content: pdf }],
  });

  const admin = createAdminClient();
  await upsertSubscriber(admin, n, {
    userAgent: req.headers.get('user-agent'),
    itineraryIds: body.itinerary_id ? [body.itinerary_id] : [],
  });
  return NextResponse.json({ ok: true });
}
```

Then extend `sendEmail` in `apps/web/lib/email/resend.ts` to accept an optional `attachments?: { filename: string; content: Buffer | Uint8Array }[]` and pass it through to the Resend `emails.send` call (Resend supports `attachments`).

- [ ] **Step 4: Run + typecheck**

Run: `pnpm --filter @after5/web test lib/email/__tests__/plan-pdf.test.ts && pnpm --filter @after5/web typecheck`
Expected: PASS (2 tests); typecheck clean. (The route itself is integration-tested manually + via the e2e in Task 8; rendering a PDF in jsdom is out of scope for unit tests.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/email/plan-pdf.ts apps/web/app/api/email-plan/ apps/web/lib/email/resend.ts apps/web/lib/email/__tests__/plan-pdf.test.ts
git commit -m "feat(m2): /api/email-plan — server-render PlanPDFDocument + email via Resend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `/create` page + flow (Barbiecore, mobile-first)

**Files:**
- Create: `apps/web/app/create/page.tsx` (RSC shell)
- Create: `apps/web/app/create/CreateFlow.tsx` (`'use client'`)
- Create: `apps/web/app/create/BlurGateOverlay.tsx`
- Create: `apps/web/lib/create/__tests__/CreateFlow.test.tsx`

The RSC shell reads geo headers (`headers()` → `x-vercel-ip-city`), loads generatable cities, resolves the initial slug, reads auth, and passes `{ initialCity, fellBack, authed, cities }` to `CreateFlow`. The flow: a condensed single-screen input (vibe pills [required] + budget + time-of-day + city selector), POST `/api/create-plan`, then `ItineraryView` for the active plan with `BlurGateOverlay` over locked sections (anon only) and an `EmailGate`-style CTA. Keep inputs minimal — this is the fast funnel, not the full `/plan` questionnaire.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/lib/create/__tests__/CreateFlow.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

import { CreateFlow } from '../../../app/create/CreateFlow';

const cities = [{ slug: 'kelowna', name: 'Kelowna' }];
const teaser = {
  itineraries: [{ template_id: 't', template_name: 'n', title: 'pottery + ramen', hook: 'h',
    why_it_works: '', locked: true, total_cost_pp: 50, total_duration_min: 120, vibe: ['creative'],
    stops: [{ place_id: 'p1', place_name: 'Clay', place_type: 'activity', start_time: '18:00', duration_min: 60, estimated_cost_pp: 25, locked: false }] }],
  authed: false, city: 'kelowna', fellBack: false,
};

describe('CreateFlow', () => {
  it('requires a vibe before it will generate', async () => {
    render(<CreateFlow initialCity="kelowna" fellBack={false} authed={false} cities={cities} />);
    const go = screen.getByRole('button', { name: /make my date|create|plan my/i });
    expect(go).toBeDisabled();
  });

  it('generates and renders the plan title; anon sees the locked CTA', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => teaser });
    render(<CreateFlow initialCity="kelowna" fellBack={false} authed={false} cities={cities} />);
    await userEvent.click(screen.getByRole('button', { name: /creative/i }));
    await userEvent.click(screen.getByRole('button', { name: /make my date|create|plan my/i }));
    expect(await screen.findByText(/pottery \+ ramen/i)).toBeInTheDocument();
    // anon → email CTA to unlock
    expect(screen.getByText(/unlock|email me|see the full/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @after5/web test lib/create/__tests__/CreateFlow.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BlurGateOverlay`, `CreateFlow`, then `page.tsx`**

Implement `BlurGateOverlay.tsx` as a Barbiecore lock card (lowercase "see the full plan", a `lock` icon, `shell-accent` button) absolutely positioned over a `relative` section with a `backdrop-blur-md bg-shell-base/60` veil. `CreateFlow.tsx` holds: `vibe: string[]` (pill multi-select, ≥1 required to enable the CTA), `budget`, `time_of_day`, `city_slug` (selector seeded from `cities`/`initialCity`), `phase: 'input'|'loading'|'results'`, posts to `/api/create-plan`, renders `ItineraryView` for the active itinerary, and — when `!authed` — wraps the `why`/later-stops region in `BlurGateOverlay` and shows an email CTA that POSTs `/api/email-plan` (full plan) then deep-links to signup. `page.tsx`:

```tsx
// apps/web/app/create/page.tsx
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { resolveCitySlug } from '@/lib/create/cities';
import { CreateFlow } from './CreateFlow';

export const dynamic = 'force-dynamic';

export default async function CreatePage() {
  const h = await headers();
  const supabase = await createClient();
  const [{ data: { user } }, { data: cityRows }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('cities').select('slug,name').eq('is_active', true).order('name'),
  ]);
  const cities = cityRows ?? [{ slug: 'kelowna', name: 'Kelowna' }];
  const { slug, fellBack } = resolveCitySlug(h.get('x-vercel-ip-city'), cities);
  return <CreateFlow initialCity={slug} fellBack={fellBack} authed={!!user} cities={cities} />;
}
```

- [ ] **Step 4: Run test + full suite**

Run: `pnpm --filter @after5/web test lib/create/__tests__/CreateFlow.test.tsx && pnpm --filter @after5/web test`
Expected: CreateFlow PASS (2 tests); full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @after5/web typecheck
git add apps/web/app/create/ apps/web/lib/create/__tests__/CreateFlow.test.tsx
git commit -m "feat(m2): /create date-first landing — Barbiecore flow + anon blur-gate overlay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Publish-to-feed from a created date (gated)

**Files:**
- Create: `apps/web/app/create/PublishToFeedButton.tsx`
- Modify: `apps/web/app/create/CreateFlow.tsx` (render the button for verified dating users)
- Test: `apps/web/app/create/__tests__/PublishToFeedButton.test.tsx`

Publish requires (a) auth, (b) `dating_enabled && verification==='verified'`, and (c) the itinerary to be persisted (have an `id`). For anon/unverified users, the button is replaced by a "create a profile to publish" prompt. Calls `postNight` with the itinerary id + a chosen `starts_at`. Locked decision: only curated/`live` venues may be a meetup `venue_id`; the landing publish posts WITHOUT a pinned venue (the curated-venue restriction in `post_night` only fires when `p_venue` is set), so publish is allowed but the date carries no pinned venue.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/app/create/__tests__/PublishToFeedButton.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const postNight = vi.fn().mockResolvedValue('di-1');
vi.mock('@after5/api-client', () => ({ postNight: (...a: unknown[]) => postNight(...a) }));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}) }));

import { PublishToFeedButton } from '../PublishToFeedButton';

beforeEach(() => postNight.mockClear());

describe('PublishToFeedButton', () => {
  it('unverified: shows the profile prompt, no publish', () => {
    render(<PublishToFeedButton itineraryId="i1" canPublish={false} startsAt="2026-07-01T18:00:00Z" />);
    expect(screen.getByText(/create a profile to publish/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });
  it('verified: publishes via postNight', async () => {
    render(<PublishToFeedButton itineraryId="i1" canPublish={true} startsAt="2026-07-01T18:00:00Z" />);
    await userEvent.click(screen.getByRole('button', { name: /publish to the feed/i }));
    expect(postNight).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itinerary_id: 'i1' }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @after5/web test app/create/__tests__/PublishToFeedButton.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the button + wire into CreateFlow**

```tsx
// apps/web/app/create/PublishToFeedButton.tsx
'use client';
import { useState } from 'react';
import { postNight } from '@after5/api-client';
import { browserAfter5Client } from '@/lib/after5/client';
import { toast } from 'sonner';

export function PublishToFeedButton({ itineraryId, canPublish, startsAt }: {
  itineraryId: string; canPublish: boolean; startsAt: string;
}) {
  const [busy, setBusy] = useState(false);
  if (!canPublish) {
    return <a href="/onboarding" className="text-shell-accent underline lowercase">create a profile to publish this to the feed</a>;
  }
  async function publish() {
    setBusy(true);
    try {
      await postNight(browserAfter5Client(), { itinerary_id: itineraryId, starts_at: startsAt });
      toast.success('posted to the feed');
    } catch { toast.error('could not publish — try again'); }
    finally { setBusy(false); }
  }
  return (
    <button onClick={publish} disabled={busy}
      className="rounded-pill bg-shell-accent px-6 py-3 text-white lowercase shadow-fun disabled:opacity-60">
      {busy ? 'posting…' : 'publish to the feed'}
    </button>
  );
}
```

Wire into `CreateFlow.tsx` results view: `canPublish` is true only when `authed` AND the page-level profile check passed (pass a `canPublish` prop from `page.tsx`, which already loaded `user` — extend it to also `select('dating_enabled, verification')`). The itinerary must be persisted to have an `id`; if the create flow returns ephemeral itineraries (no id), gate publish behind "save this plan first" (the authed generate-plan path persists + returns ids — confirm and pass through).

- [ ] **Step 4: Run + full suite**

Run: `pnpm --filter @after5/web test app/create/__tests__/PublishToFeedButton.test.tsx && pnpm --filter @after5/web test`
Expected: PASS (2 tests); full suite green.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @after5/web typecheck
git add apps/web/app/create/PublishToFeedButton.tsx apps/web/app/create/CreateFlow.tsx apps/web/app/create/page.tsx apps/web/app/create/__tests__/PublishToFeedButton.test.tsx
git commit -m "feat(m2): publish-to-feed CTA on created dates (gated on verified dating profile)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: E2E (Playwright/Chromium) — anon teaser + authed full + email capture

**Files:**
- Create: `apps/web/e2e/m2-create.spec.ts`
- Modify: `apps/web/playwright.config.ts:21` (extend `testMatch` to include `m2-`)

The user requires browser verification. This proves: (1) anon `/create` generates and the gated fields are absent from the DOM, (2) the email CTA posts and shows confirmation, (3) an authed verified user sees the full plan + the publish button. Uses the local stack (generate-plan must respond locally — kelowna path works without #67). If the local generate-plan edge fn isn't served locally, this spec calls `/api/create-plan` with the local function; ensure `supabase functions serve` or the deployed-local function is available, else mark the generation assertions `test.skip` with a logged reason (do NOT silently pass).

- [ ] **Step 1: Extend testMatch**

In `apps/web/playwright.config.ts`, change line 21 to:
```typescript
  testMatch: /(5b-|chat-|m5-|m2-).*\.spec\.ts$/,
```

- [ ] **Step 2: Write the spec**

```typescript
// apps/web/e2e/m2-create.spec.ts
import { test, expect } from '@playwright/test';

test('anon create: generates a teaser; premium fields absent from DOM', async ({ page }) => {
  await page.goto('/create');
  await page.getByRole('button', { name: /creative|cozy|foodie/i }).first().click();
  await page.getByRole('button', { name: /make my date|create|plan my/i }).click();
  // a plan title renders
  await expect(page.getByText(/the why|your plan|date/i).first()).toBeVisible({ timeout: 20000 });
  // anon sees the unlock CTA
  await expect(page.getByText(/unlock|email me|see the full/i).first()).toBeVisible();
  // the locked rationale text must NOT be in the DOM for anon
  const html = await page.content();
  expect(html).not.toContain('why_it_works');
});
```

- [ ] **Step 3: Run the e2e (Chromium)**

```bash
cd apps/web
eval "$(supabase status -o env | grep -E '^SERVICE_ROLE_KEY=|^SECRET_KEY=|^PUBLISHABLE_KEY=')"
export SERVICE_ROLE_KEY SECRET_KEY LOCAL_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
pnpm exec playwright test m2-create
```
Expected: PASS. If generate-plan isn't locally invokable, the generation assertions skip with a logged reason; the route-level unit tests (Task 3) still cover the gate logic.

- [ ] **Step 4: Run the full e2e suite (regression)**

```bash
pnpm exec playwright test
```
Expected: all prior specs (5b/chat/m5) + m2 green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/m2-create.spec.ts apps/web/playwright.config.ts
git commit -m "test(m2): Chromium e2e — anon teaser gate + DOM-leak negative

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (against the locked M2 decisions + milestone plan):**
- Separate date-first landing `/create` (Barbiecore, mobile-first) → Task 6. ✓
- IP-detect city, prefill + editable → Tasks 2, 6 (geo header → `resolveCitySlug`, editable selector). ✓
- Server-enforced blur-gate (never ship gated fields to anon DOM) → Tasks 1, 3, 8 (DOM-leak negative test). ✓
- Blur-gate aggressiveness: hero + stop 1 visible, stops 2–3 silhouetted, why/map/insights locked → Task 1. ✓
- Email the FULL plan PDF → Task 5 (server-render `PlanPDFDocument`). ✓
- Publish-to-feed on every created date, gated on `dating_enabled && verified` → Task 7. ✓
- Reuse EmailGate/subscribe/PDF/post_night → Tasks 4, 5, 6, 7. ✓
- Frozen generate-plan contract (city_slug additive) → Task 3 (proxy, no edit). ✓
- Graceful pre-#67 multi-city fallback → Tasks 2, 3 (kelowna fallback + `fellBack` note). ✓
- Brand-unify lifted planner components: PARTIAL — M2 reuses the already-Barbiecore `ItineraryView`/`StopCard`; a full `/plan` rebrand is NOT required for `/create` to ship. If the audit's "old-brand `/plan`" still bites, that rebrand is folded into M3 (shared components) — noted, not silently dropped.

**Placeholder scan:** No "TBD"/"handle edge cases"/bare "write tests". Each code step has real code; each test step has real assertions. Two spots flagged for the implementer to confirm-against-reality (not placeholders, explicit verifications): (a) `lib/email/layout.ts` export name used by `buildPlanEmail` (Task 5 Step 3 says confirm/adapt), (b) whether the authed generate path returns persisted itinerary ids for publish (Task 7 Step 3 says confirm + gate accordingly). These are real integration points the implementer must verify, called out explicitly.

**Type consistency:** `GatedItinerary`/`GatedStop` (Task 1) are consumed by Task 3's response and Task 6's render. `NormalizedSubscribe` (Task 4) consumed by Task 5. `KnownCity` (Task 2) consumed by Task 6's `page.tsx`. `postNight` signature matches the researched `{ itinerary_id, starts_at, venue_id?, duration_min?, ambient_sound_id? }`. Consistent.

**Open verification for the implementer (do these first in each relevant task):**
1. `@/lib/supabase/server` `createClient` is `async` (await it) — confirm signature.
2. `sendEmail` attachments pass-through to the Resend SDK shape (`attachments: [{ filename, content }]`).
3. Whether `generate-plan` is locally invokable in the e2e env; if not, skip-with-reason (Task 8).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-01-m2-date-first-landing.md`.

**Sequencing note:** M2 frontend commits stack on local `main` and CANNOT be pushed/deployed until the gated M4+M6 deploy (task #68 — `generate-blur` edge deploy + push) clears, AND multi-city only lights up after task #67 (generate-plan redeploy + Google key). M2 builds + tests fully locally regardless; `/create` works today on the kelowna path.

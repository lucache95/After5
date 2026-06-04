# Phase 4: Discoverability — Feed Filters & Targeting (P1) - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 14 (4 new migrations, 1 modified migration logic, 2 api-client, 4 web UI, + 3 test files)
**Analogs found:** 14 / 14 (every file has a strong in-repo analog — this is a consume-and-extend phase)

> Governing constraints for EVERY file below (from RESEARCH + CLAUDE.md):
> 1. **Blind contract** — `browse_feed_for_viewer` SELECT stays the existing 13 columns + computed `fit` boolean. NEVER add `itinerary_id` / `creator_id` / `venue_id` / unscrubbed `reservation_url` / un-truncated time.
> 2. **`{everyone}` normalization** — `{everyone}` and `{}` are BOTH "no gender restriction". Centralize in SQL in BOTH RPCs. Never `viewer.gender = any(di.target_genders)` without the open-check first.
> 3. **Grant trio on every re-emitted signature** — `revoke ... from public; revoke ... from anon; grant ... to authenticated;` + run security advisor after every DDL.
> 4. **No em-dashes** — copy uses ` · ` or `.`. Known existing violation at `PostNightForm.tsx:315` (do not add a new one in the reach line landing in the same file).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `<ts>_e10_feed_filters_column.sql` (NEW) | migration (column) | CRUD / schema | `20260605120000_e11_targeting_cols.sql` (additive cols, no RLS) + `profiles_owner_all` policy | exact |
| `<ts>_e10_browse_feed_filters.sql` (MODIFY logic) | migration (RPC) | request-response / query | `20260602120400_m4_browse_feed_ambient.sql` (the function being extended) | exact (same fn) |
| `<ts>_e10_reach_preview.sql` (NEW) | migration (RPC) | request-response / aggregate | `reach_preview` example in RESEARCH §Code Examples; structurally = the DEFINER count pattern in `20260605120200` post_night trio | role-match |
| `<ts>_e10_feed_indexes.sql` (NEW) | migration (index) | n/a | `20260525120300_p0_date_instances.sql:42-44` + `20260527120000_s4...:12` | exact |
| `packages/api-client/src/feed.ts` (MODIFY) | api-client / service | request-response | same file: `browseFeed` + `FeedNight` + `postNight` (RPC wrapper convention) | exact (same file) |
| `packages/api-client/src/profile.ts` (MODIFY) | api-client / service | CRUD (PostgREST write) | same file: `savePreferences` / `upsertProfile` | exact (same file) |
| `apps/web/app/feed/FilterSheet.tsx` (MODIFY stub → real) | component (client) | event-driven / form | the existing stub shell + `PostNightForm.tsx` chip groups (mechanics) + `NightDetailSheet` (vaul) | exact shell, role-match body |
| `apps/web/app/feed/SwipeDeck.tsx` (MODIFY) | component (client) | event-driven | same file: header gear trigger + `EmptyDeck` (the two new things land here) | exact (same file) |
| `apps/web/app/feed/NightCard.tsx` (MODIFY) | component (client) | presentation | same file: `is_seed` badge render (the `fit` pill mirrors it) | exact (same file) |
| `apps/web/app/feed/page.tsx` (MODIFY) | page (RSC) | request-response | same file: `browseFeed` SSR seed + `feedColdStartTier` | exact (same file) |
| `apps/web/app/nights/new/PostNightForm.tsx` (MODIFY) | component (client) | event-driven + debounced query | same file: targeting fieldset (lines 375-494) + helper-text line (440) | exact (same file) |
| `supabase/tests/e10_browse_feed_filters.sql` (NEW) | test (pgTAP/psql) | n/a | `e11_targeting.sql` + `s5_browse_feed_blind.sql` | role-match |
| `supabase/tests/e10_reach_preview.sql` (NEW) | test | n/a | `e11_targeting.sql` (anon-revoke + post_night call shape) | role-match |
| `supabase/tests/e10_feed_filters_rls.sql` (NEW) | test (RLS) | n/a | `p1_preferences.sql` (self-write + check-violation harness) | exact |

---

## Pattern Assignments

### `<ts>_e10_feed_filters_column.sql` (migration, additive column)

**Analog:** `supabase/migrations/20260605120000_e11_targeting_cols.sql` (additive cols + "no RLS change, row policy already covers them"); the policy it relies on is `capture_full_schema.sql:46-54`.

**Column-add pattern** (`20260605120000_e11_targeting_cols.sql:14-17`):
```sql
alter table date_instances
  add column if not exists target_genders text[] not null default '{}',
  add column if not exists target_age_range int4range,
  add column if not exists search_radius_km numeric;
```

**RLS that already covers the new column — DO NOT add a new policy** (`capture_full_schema.sql:46-54`):
```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "profiles_owner_all"
    ON profiles FOR ALL
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
```

**What to write** (per RESEARCH §Code Examples):
```sql
alter table profiles
  add column if not exists feed_filters jsonb not null default '{}'::jsonb;
-- optional shape guard (additive, NOT VALID): jsonb_typeof(feed_filters)='object'
-- NO new RLS policy — profiles_owner_all already grants self-read/self-write to the column.
```

---

### `<ts>_e10_browse_feed_filters.sql` (migration, RPC extension — drop+recreate)

**Analog:** `supabase/migrations/20260602120400_m4_browse_feed_ambient.sql` — THE function being extended. The full live body is the template; preserve it verbatim and layer on hard WHERE + soft ORDER BY + `fit`.

**Drop+recreate + grant trio shell** (`...ambient.sql:10-22, 67-69`):
```sql
drop function if exists browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int);
create or replace function browse_feed_for_viewer(
  p_viewer uuid default auth.uid(), p_point geography default null,
  p_after_starts timestamptz default null, p_after_id uuid default null, p_limit int default 20
) returns table (
  date_instance_id uuid, city_id uuid, time_window_start timestamptz,
  pay_setting text, vibe_tags text[], why_note text,
  cover_image_url text, title text, venue_neighborhood text, is_seed boolean, distance_m double precision,
  ambient_sound_path text, ambient_sound_name text,
  fit boolean                                  -- E10: 14th column, additive, computed (no identity)
) language sql security definer set search_path = public, extensions as $fn$ ... $fn$;
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from public;
grant  execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) to authenticated;
```
> Signature does NOT change (5 params stay). The api-client `browseFeed` call needs no param change.

**`me` CTE to extend — read `feed_filters` here, no new param** (`...ambient.sql:23-27`):
```sql
with me as (
  select gender, gender_preferences, age, age_pref, distance_pref_km,
         coalesce(p_point, (select centroid from cities c where c.id = pr.primary_city_id)) as pt
         -- E10: add  , coalesce(pr.feed_filters,'{}'::jsonb) as ff
  from profiles pr where pr.id = p_viewer
)
```

**Existing WHERE gates that MUST STAY (do not remove)** (`...ambient.sql:53-65`):
```sql
where di.status = 'seeking'
  and di.starts_at > now()
  and di.moderation_status = 'approved'
  and cr.account_state = 'active' and cr.standing not in ('suspended','locked_ban')
  and cr.verification = 'verified' and cr.dating_enabled = true
  and di.creator_id <> p_viewer
  and not exists (select 1 from swipes s where s.swiper_id = p_viewer and s.date_instance_id = di.id)
  and cr.gender = any (me.gender_preferences)          -- mutual-pref baseline gate STAYS
  and me.gender = any (cr.gender_preferences)
  and me.age <@ cr.age_pref and cr.age <@ me.age_pref
  and st_dwithin(cc.centroid, me.pt, least(me.distance_pref_km, cr.distance_pref_km) * 1000)
  and (p_after_starts is null or (di.starts_at, di.id) > (p_after_starts, p_after_id))  -- KEYSET CURSOR
order by di.starts_at asc, di.id asc                    -- KEYSET SORT (Pitfall 3)
limit greatest(1, least(coalesce(p_limit,20), 50));
```

**LANDMINES an executor must not break:**
- **Blind SELECT** (`...ambient.sql:28-33`): the 13-column projection is `di.id, di.city_id, date_trunc('hour', di.starts_at), it.pay_setting::text, it.vibe_tags, it.why_note, it.cover_image_url, it.title, pl.neighborhood, di.is_seed, st_distance(...), amb.storage_path, amb.name`. `date_trunc('hour', ...)` (line 28) is the time-blinding — keep it. Add ONLY `fit` (line +1). No `di.itinerary_id`, no `cr.*` identity.
- **Keyset cursor invariant** (lines 64-65): cursor predicate `(di.starts_at, di.id) > (p_after_starts, p_after_id)` must stay consistent with the sort. Per RESEARCH Pitfall 3 + Open Question 1: keep `(starts_at,id)` as the keyset; soft-score is the LEADING `ORDER BY` key as "best-effort within the fetched window v1" — flag the cursor-vs-score decision explicitly in the plan.
- **`{everyone}` normalization** for the `fit` computation (RESEARCH Pitfall 1):
```sql
case when di.target_genders = '{}' or di.target_genders = array['everyone'] then true
     else me.gender = any(di.target_genders) end
```

**Hard filters (WHERE, only when set — RESEARCH Pattern 3):**
```sql
and (f.host_genders is null or cr.gender = any(f.host_genders))
and (f.max_price is null or it.total_cost_pp <= f.max_price)
and (f.max_distance_km is null or st_dwithin(cc.centroid, me.pt, f.max_distance_km * 1000))
```

**Soft score + `fit` (SELECT/ORDER BY — RESEARCH §Code Examples):** date-fits-viewer (normalized) × 4 + vibe_pts + pay_pts + time_pts; `fit = date_fits_viewer and (vibe_pts+pay_pts+time_pts) >= 1`. Define an IMMUTABLE `time_bucket_of(timestamptz)` helper in the same migration.

---

### `<ts>_e10_reach_preview.sql` (migration, new DEFINER count RPC)

**Analog:** the grant-trio + DEFINER discipline from `20260605120200_e11_post_night_targeting.sql:152-154`; the full body template is in RESEARCH §Code Examples ("reach_preview RPC").

**Grant-trio pattern to mirror** (`20260605120200...:152-154`):
```sql
revoke execute on function post_night(...) from public;
revoke execute on function post_night(...) from anon;       -- explicit anon revoke (Pitfall 2)
grant  execute on function post_night(...) to authenticated;
```

**What to write** (RESEARCH §Code Examples — returns ONLY `count(*)::int`, leaks no identity):
```sql
drop function if exists reach_preview(text[], int4range, uuid, numeric);
create or replace function reach_preview(
  p_target_genders text[] default '{}', p_target_age_range int4range default null,
  p_city uuid default null, p_radius_km numeric default null
) returns integer language sql security definer set search_path = public, extensions as $fn$
  with c as (select centroid from cities where id = p_city)
  select count(*)::int from profiles pr, c
  where pr.dating_enabled = true and pr.verification = 'verified' and pr.id <> auth.uid()
    and ( p_target_genders = '{}' or p_target_genders = array['everyone']   -- {everyone} norm
          or pr.gender = any(p_target_genders) )
    and ( p_target_age_range is null or pr.age <@ p_target_age_range )
    and ( p_radius_km is null or p_city is null
          or st_dwithin((select centroid from cities where id = pr.primary_city_id), c.centroid, p_radius_km*1000) );
$fn$;
revoke execute on function reach_preview(text[], int4range, uuid, numeric) from public;
revoke execute on function reach_preview(text[], int4range, uuid, numeric) from anon;
grant  execute on function reach_preview(text[], int4range, uuid, numeric) to authenticated;
```
> DEFINER is required (a searcher can't read other profiles' gender/age under RLS) — same accepted pattern as all `match_*` RPCs.

---

### `<ts>_e10_feed_indexes.sql` (migration, indexes)

**Analog:** `supabase/migrations/20260525120300_p0_date_instances.sql:42-44` + `20260527120000_s4_date_instances_feed_columns.sql:12`.

**Existing indexes (confirmed live — geography GIST is on `cities.centroid`/PostGIS, the `date_instances_range_gist` is on `time_range`):**
```sql
create index if not exists date_instances_creator_idx on date_instances(creator_id);
create index if not exists date_instances_city_status_idx on date_instances(city_id, status);
create index if not exists date_instances_range_gist on date_instances using gist (time_range);
-- 20260527120000_s4...:12
create index if not exists date_instances_feed_idx on date_instances(status, starts_at) where ...seeking+approved;
```
**What to add:** a composite index supporting the new hard-filter predicates (gender on `profiles.gender`, price on `itineraries.total_cost_pp`). Confirm whether a `profiles(dating_enabled, verification)` partial index helps `reach_preview` (RESEARCH A3) via EXPLAIN; add only if the advisor/EXPLAIN flags it. Use `create index if not exists` (project convention).

---

### `packages/api-client/src/feed.ts` (api-client, MODIFY)

**Analog:** same file — the `FeedNight` interface (lines 4-12), `browseFeed` (165-174), and `postNight`/`reachPreview` RPC-wrapper convention (29-39).

**`FeedNight` — add `fit`** (extend lines 4-12):
```typescript
export interface FeedNight {
  /* …existing 13 fields… */
  ambient_sound_path: string | null; ambient_sound_name: string | null;
  fit: boolean;   // E10: strong-match hint flag (D-03)
}
```

**RPC-wrapper convention to mirror for `reachPreview`** (`postNight`, lines 29-39):
```typescript
const { data, error } = await client.rpc('post_night', { p_itinerary: ..., ... } as never);
if (error) throw error;
return data as string;
```
`browseFeed` (165-174) needs NO change (signature unchanged); only the `FeedNight` type gains `fit`. Add `reachPreview(client, { target_genders?, target_age_range?, city, radius_km? }): Promise<number>` calling `client.rpc('reach_preview', { p_... } as never)` (full shape in RESEARCH §Code Examples).

---

### `packages/api-client/src/profile.ts` (api-client, MODIFY — add `saveFeedFilters`)

**Analog:** same file — `savePreferences` (lines 45-61) and `upsertProfile` (20-32). This is a self-owned PostgREST write gated by RLS — NO RPC.

**`savePreferences` PostgREST-write pattern** (lines 45-61):
```typescript
export async function savePreferences(client: After5Client, userId: string, prefs: PreferencesInput) {
  const patch = { gender: prefs.gender, gender_preferences: prefs.gender_preferences,
    age_pref: `[${prefs.age_min},${prefs.age_max}]`, distance_pref_km: prefs.distance_pref_km,
    dealbreakers: prefs.dealbreakers };
  const { error } = await client.from('profiles').update(patch).eq('id', userId);
  if (error) throw error;
}
```
**What to write** (mirror — jsonb sent as `Json`, RESEARCH §Code Examples):
```typescript
export async function saveFeedFilters(client: After5Client, userId: string, filters: FeedFilters): Promise<void> {
  const { error } = await client.from('profiles')
    .update({ feed_filters: filters as unknown as Json }).eq('id', userId);
  if (error) throw error;
}
```

---

### `apps/web/app/feed/FilterSheet.tsx` (component, MODIFY stub → real)

**Analog (shell, KEEP verbatim):** the existing stub (lines 26-39, 52-58) — `Drawer.Root/Portal/Overlay/Content`, the `shell-ink/40` overlay, `rounded-t-3xl bg-shell-base max-h-[80dvh] max-w-[420px] shadow-fun`, the grabber, the `font-heading text-3xl lowercase` title, the accent CTA button shape.

**Stub shell to preserve** (`FilterSheet.tsx:26-30, 52-58`):
```tsx
<Drawer.Root open={open} onOpenChange={onOpenChange}>
  <Drawer.Portal>
    <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
    <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[80dvh] w-full max-w-[420px] flex-col rounded-t-3xl bg-shell-base text-shell-ink shadow-fun outline-none">
      <div className="mx-auto mt-3 h-1.5 w-10 rounded-full bg-shell-ink/20" aria-hidden />
      ...
      <button ... className="... h-14 ... rounded-full bg-shell-accent ... font-heading text-lg lowercase text-white shadow-fun ... motion-reduce:transition-none motion-reduce:hover:scale-100">
```

**Analog (chip mechanics — copy CLASSES + a11y, NOT from DatesFilter):** `PostNightForm.tsx` gender/pay chip groups (lines 383-437). This is the canonical Barbiecore chip + `role="group"`/`role="checkbox"` + `aria-checked` pattern:
```tsx
<div role="group" aria-label="target gender(s)" className="flex flex-wrap gap-2">
  {GENDER_OPTIONS.map((opt) => {
    const selected = genders.includes(opt.id);
    return (
      <button key={opt.id} type="button" role="checkbox" aria-checked={selected}
        onClick={() => toggleGender(opt.id)}
        style={{ transform: `rotate(${stickerRotation(opt.id)}deg)` }}
        className={cn(
          'min-h-[44px] rounded-full px-4 font-body text-[14px] font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
          'motion-reduce:transition-none',
          selected ? 'bg-shell-accent text-white shadow-fun'
                   : 'bg-white/80 text-shell-ink ring-1 ring-shell-ink/10 hover:ring-shell-accent/40',
        )}>{opt.label}</button>
    );
  })}
</div>
```
> `apps/web/components/DatesFilter.tsx` is a reference for chip STATE mechanics ONLY (warm-token planner tier — do NOT copy its visuals). Build two groups `dealbreakers` (hard) + `nice to have` (soft) per 04-UI-SPEC §Component Contracts #2. On apply: `saveFeedFilters(...)` then re-query; error → `sonner` toast `that didn't save. try again?`.

---

### `apps/web/app/feed/SwipeDeck.tsx` (component, MODIFY — quick chips + EmptyDeck branch)

**Analog:** same file. The header gear trigger (lines 106-118) is where the 3-chip row lands beside it; `EmptyDeck` (348-385) is the function to branch.

**Gear trigger + filter-open state already wired** (`SwipeDeck.tsx:47, 107-118, 164`):
```tsx
const [filterOpen, setFilterOpen] = useState(false);
...
<button type="button" onClick={() => setFilterOpen(true)} aria-label="filters"
  className={cn('flex h-9 w-9 items-center justify-center rounded-full bg-white/80 ...')}>
  <SlidersHorizontal className="h-4 w-4" aria-hidden />
</button>
...
<FilterSheet open={filterOpen} onOpenChange={setFilterOpen} />
```

**`EmptyDeck` to branch (filtered-empty vs genuinely-empty)** (`SwipeDeck.tsx:348-385`):
```tsx
function EmptyDeck({ tier }: { tier: FeedTier }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 pb-24 text-center">
      <div className="mx-auto max-w-[420px]">
        <p className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">that's everyone for now.</p>
        <p className="mt-4 font-body text-lg text-shell-ink/70">touch grass and come back later.</p>
        {tier === 'thin' ? (...post your own night...) : (...)}
        <Link href="/nights/new" className="font-semibold text-shell-accent underline decoration-2 underline-offset-4 ...">
          post your own night</Link>
```
> Add a `filtered`-empty branch per 04-UI-SPEC §4: heading `nothing fits those filters.`, name the most-restrictive HARD filter + a one-tap accent "loosen" action (updates `feed_filters` and re-queries — deliberate tap, never auto-relax) + `post your own night`. Keep the existing genuinely-empty copy unchanged. The 3 quick chips reuse the chip classes above; tapping ANY chip opens `FilterSheet` (chips are shortcuts, not inline editors — D-04).

---

### `apps/web/app/feed/NightCard.tsx` (component, MODIFY — fit pill)

**Analog:** same file — the `is_seed` `★ curated` badge (lines 91-98) is the exact precedent for a small conditional pill on the card scrim.

**`is_seed` badge pattern to mirror** (`NightCard.tsx:91-98`):
```tsx
{night.is_seed && (
  <span className="absolute left-3 top-3 rounded-full px-3 py-1 font-body text-xs font-semibold text-white shadow-md"
    style={{ background: pal.accent, transform: `rotate(${stickerRotation('curated')}deg)` }}>
    ★ curated
  </span>
)}
```
> Add `{night.fit && (<span ...>looks for someone like you</span>)}` — render ONLY on `fit === true` (D-03). Per 04-UI-SPEC §3: `rounded-full px-3 py-1 font-body text-[13px] font-semibold lowercase shadow-md`, `bg-white/85 text-shell-accent` (NOT sage/green), sits on the existing bottom scrim (content stack ~line 101) or top-left without colliding with the `★ curated` badge. Never a score/percentage.

---

### `apps/web/app/feed/page.tsx` (page RSC, MODIFY)

**Analog:** same file — SSR seed + cold-start tier (lines 3-19).

**SSR seed pattern** (`feed/page.tsx:3-19`):
```tsx
import { browseFeed } from '@after5/api-client';
import { feedColdStartTier } from '@after5/business';
export const dynamic = 'force-dynamic';
...
const { data: { user } } = await supabase.auth.getUser();
const nights = await browseFeed(supabase, { limit: 20 }).catch(() => []);
const tier = feedColdStartTier({ compatibleOpen: nights.length, totalOpen: nights.length });
return <SwipeDeck initial={nights} tier={tier} />;
```
> `browseFeed` reads `feed_filters` server-side inside the RPC (no param change). If the plan passes the persisted filters into `SwipeDeck` for the empty-state "which filter is set" branching, seed them here too (a `getMyProfile`-style read or a prop). Keep `force-dynamic`.

---

### `apps/web/app/nights/new/PostNightForm.tsx` (component, MODIFY — reach line)

**Analog:** same file — the targeting fieldset (lines 375-494), the existing helper-text line (440), and the debounce-able state setters (`genders`/`ageMin`/`ageMax`/`radiusKm`).

**Helper-text style to mirror for the reach line** (`PostNightForm.tsx:439-441`):
```tsx
<p className="mt-2 font-body text-xs lowercase text-shell-ink/55">
  open to everyone unless you narrow it.
</p>
```

**Insertion point — after the radius input** (`PostNightForm.tsx:480-494`, the `radius-km` label ends ~line 494):
```tsx
<label htmlFor="radius-km" className="mt-5 block">
  <span ...>how far? (km)</span>
  <input id="radius-km" type="number" ... value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} ... />
</label>
{/* ← E10 D-01 reach line lands here */}
```
> Add a single quiet `aria-live="polite"` line `font-body text-[13px] lowercase text-shell-ink/65` (NOT accent, NOT a warning color). Debounced call to `reachPreview(...)` on `genders`/`ageMin`/`ageMax`/`radiusKm` change. Copy states (normal/low/zero/loading) from 04-UI-SPEC §Copywriting. MUST NEVER disable the publish CTA. **`{everyone}` landmine:** `genders` state initializes to `['everyone']` (line 69) and `toggleGender` falls back to `['everyone']` (lines 98-101) — when calling `reachPreview`, send `[]`/omit for the open case (or rely on the RPC's `{everyone}` normalization). Em-dash landmine: line 315 already violates stop-slop; do NOT add a new em-dash in the reach line.

---

### Test files (NEW) — `supabase/tests/e10_*.sql`

**Analog (RLS self-write + check-violation harness):** `supabase/tests/p1_preferences.sql` — `\i _fixtures.sql`, `mk_user`, `update profiles set ...`, `EXCEPTION WHEN check_violation`, `ROLLBACK`. Use for `e10_feed_filters_rls.sql` (another user cannot write my `feed_filters`).

**Analog (RPC call + anon-revoke + jwt-claims):** `supabase/tests/e11_targeting.sql` — `set local role authenticated`, `perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true)`, positional RPC call, `ROLLBACK`. Use for `e10_browse_feed_filters.sql` (hard hide / soft re-sort / fit / `{everyone}` / keyset no-dup) and `e10_reach_preview.sql`.

**Analog (blind-column assertion — EXTEND, don't rewrite):** `supabase/tests/s5_browse_feed_blind.sql:21-32` asserts no `creator_id`/`itinerary_id` column leaks via `information_schema.columns`. Extend it to assert the new `fit` column exists AND no identity column was added.

---

## Shared Patterns

### `{everyone}` normalization (cross-cutting — RESEARCH §3 / Pitfall 1)
**Source:** RESEARCH §Code Examples; root cause `PostNightForm.tsx:69,98-101` + `post_night` (`20260605120200:147` `coalesce(p_target_genders,'{}')` passes the literal `{everyone}` through).
**Apply to:** BOTH new RPCs (`browse_feed_for_viewer` fit/boost AND `reach_preview`), AND the `reachPreview` client call from `PostNightForm`.
```sql
case when di.target_genders = '{}' or di.target_genders = array['everyone'] then true
     else me.gender = any(di.target_genders) end
```
Never `me.gender = any(di.target_genders)` without the open-check first, or every open night drops out (pill never shows, reach undercounts to ~0).

### Grant trio + advisor (cross-cutting — RESEARCH Pitfall 2)
**Source:** `20260605120200_e11_post_night_targeting.sql:152-154`.
**Apply to:** every re-emitted/new function signature (`browse_feed_for_viewer`, `reach_preview`).
```sql
revoke execute on function <sig> from public;
revoke execute on function <sig> from anon;
grant  execute on function <sig> to authenticated;
```
Run the Supabase security advisor after every DDL migration (CLAUDE.md).

### Barbiecore chip (cross-cutting — 04-UI-SPEC)
**Source:** `PostNightForm.tsx:414-437` (gender group) + `:383-409` (pay radiogroup).
**Apply to:** FilterSheet option chips, the 3 feed quick-chips, the fit pill base classes.
```
min-h-[44px] rounded-full px-4 font-body text-[13px]/[14px] font-semibold lowercase transition
focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none
selected: bg-shell-accent text-white shadow-fun
inactive: bg-white/80 text-shell-ink ring-1 ring-shell-ink/10
```
Semantic groups: hard = `role="group"`+`role="checkbox"`; single-select = `role="radiogroup"`+`role="radio"`+roving tabindex (PostNightForm `handlePayKeyDown`).

### RPC wrapper convention (cross-cutting)
**Source:** `packages/api-client/src/feed.ts:29-39` (`postNight`).
**Apply to:** `reachPreview`. Pattern: `const {data,error}=await client.rpc('fn',{p_...} as never); if(error) throw error; return data as T;`. Self-owned writes use `client.from('profiles').update(...).eq('id',userId)` (`profile.ts:savePreferences`), NOT an RPC.

### Blind contract (cross-cutting — RESEARCH Pitfall 5)
**Source:** `...ambient.sql:28-33` (13-col projection, `date_trunc('hour',...)`); `s5_browse_feed_blind.sql:21-23`.
**Apply to:** `browse_feed_for_viewer` only. SELECT = 13 cols + `fit`. `fit` is a computed boolean (no identity). Extend the blind pgTAP test to cover it.

---

## No Analog Found

None. Every file maps to a strong in-repo analog — this is a consume-and-extend phase (one column, two RPC bodies, one index migration, four UI extensions, three tests). Anything beyond that scope is over-building (RESEARCH §Don't Hand-Roll).

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/tests/`, `packages/api-client/src/`, `apps/web/app/feed/`, `apps/web/app/nights/new/`, `apps/web/components/`.
**Files scanned:** ~16 (4 migrations, 3 tests, 2 api-client, 6 web components/pages, 1 RLS source).
**Pattern extraction date:** 2026-06-04

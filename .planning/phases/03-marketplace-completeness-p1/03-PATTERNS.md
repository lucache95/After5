# Phase 3: Marketplace Completeness (P1) - Pattern Map

**Mapped:** 2026-06-03
**Files analyzed:** 18 new/modified surfaces (2 migrations, 1 RPC, 2 backend RPC extensions, 3 SQL tests, 7 UI files incl. 1 extracted shared component, 1 client wrapper, 2 page loaders)
**Analogs found:** 18 / 18 (every surface has a shipped sibling — this is a brownfield extension phase)

> **Posture:** Default to *extend the analog in place*, not fork. Every excerpt below is copy-ready with file path + line numbers. Cross-cutting patterns (DEFINER skeleton, anon-revoke, vaul confirm sheet, RLS read, error→toast mapping) live in **Shared Patterns** — apply them to every relevant plan rather than restating per file.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/<ts>_e11_targeting_cols.sql` | migration | transform (DDL) | `20260525120500_p0_queue_entries.sql` (additive col/table + RLS) | role-match |
| `supabase/migrations/<ts>_e11_post_night_targeting.sql` (extend `post_night` + `update_itinerary_stops`) | RPC (DEFINER) | request-response | `20260602140100_m3_post_night_fork.sql` + `20260602140000_m3_update_itinerary_stops.sql` | exact |
| `supabase/migrations/<ts>_e12_queue_status_passed_by_host.sql` (enum ADD VALUE) | migration | transform (DDL) | `20260527124550_s2_notification_type_5b_extend.sql` | exact |
| `supabase/migrations/<ts>_e12_reject_candidate.sql` | RPC (DEFINER) | request-response | `20260527126300_p5_make_offer.sql` | exact |
| `apps/web/lib/after5/match.ts` (+ `rejectCandidate`) | client wrapper | request-response | existing `shortlist`/`withdraw` in same file | exact |
| `apps/web/app/dates/[slug]/interested/InterestedList.tsx` (decline/withdraw/outcome) | component | event-driven | self + `NightCardActions.tsx` (vaul confirm) | exact |
| `apps/web/components/PlanTimeline.tsx` (EXTRACT) | component | transform (render) | `StopRow`/`StopTime` in `feed/NightDetailSheet.tsx` | exact (extraction) |
| `apps/web/app/offers/[offerId]/OfferDetail.tsx` (render plan, drop host.bio) | component | request-response | self + `NightDetailSheet` timeline | exact |
| `apps/web/app/offers/[offerId]/page.tsx` (load stops, drop `bio: null`) | route (SSR loader) | request-response | self (already loads `instance:date_instances`) | exact |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` (add "the night") | component | request-response | self + `OfferDetail` | exact |
| `apps/web/app/matches/[lockId]/page.tsx` + `matches/lock-view.ts` (load stops) | route (SSR loader) | request-response | `offers/[offerId]/page.tsx` embed pattern | exact |
| `apps/web/app/nights/new/PostNightForm.tsx` (cover/targeting/why fields) | component | event-driven | self (fieldset + radiogroup) + `NightCardActions` inputs | exact |
| `apps/web/app/nights/new/page.tsx` (accept `?itinerary=`) | route | request-response | existing param-read pages | role-match |
| `apps/web/app/plans/[id]/edit/CoverUploader.tsx` (NEW uploader) | component | file-I/O | `lib/after5/photos.ts addPhoto` | role-match (different layer) |
| `apps/web/app/plans/[id]/edit/ItineraryEditor.tsx` (publish CTA) | component | event-driven | `NightDetailSheet` sticky footer + `PublishToFeedButton` nav | role-match |
| `supabase/tests/e11_targeting.sql` | test | transform | `m4_post_night_ambient.sql` / `a_make_offer.sql` | role-match |
| `supabase/tests/e12_reject_candidate.sql` | test | transform | `a_make_offer.sql` | exact |
| `supabase/tests/e13_plan_read.sql` | test | transform | `e_offer_recipient_date_read.sql` | exact |

---

## Pattern Assignments

### `supabase/migrations/<ts>_e12_reject_candidate.sql` (DEFINER RPC, request-response)

**Analog:** `supabase/migrations/20260527126300_p5_make_offer.sql` (the canonical DEFINER exemplar)

Copy the **header → auth → flag → advisory-lock → ownership → mutate → analytics** skeleton. STRIP the offer-specific steps (idempotency replay, reciprocal detection, chat thread, expiry job, **and the candidate dispatch — reject is SILENT per D-04**).

**Signature + DEFINER header** (lines 25-40):
```sql
create or replace function match_make_offer(
  p_actor uuid, p_instance uuid, p_candidate uuid, p_idem_key uuid
) returns uuid language plpgsql security definer set search_path=public as $fn$
declare cre uuid; ...
begin
```

**Auth + flag gate** (lines 41-49) — copy verbatim, same errcodes:
```sql
  if p_actor is distinct from auth.uid() then
    raise exception 'auth_mismatch' using errcode='P5001';
  end if;
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false) then
    raise exception 'feature_disabled' using errcode='P5000';
  end if;
```

**Advisory-lock + creator-ownership** (lines 56, 73-76) — serializes vs make_offer/roll, then `42501` on non-creator:
```sql
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));
  select creator_id, status into cre, st from date_instances where id=p_instance for update;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
```

**Mutate + analytics, NO dispatch** (adapt lines 119-136). Set `passed_by_host` (the new enum value), guard the active-offer-holder, record analytics, and STOP — do not call `dispatch_notification`:
```sql
  -- guard: cannot reject the active offer-holder (withdraw the offer first)
  if exists (select 1 from queue_entries where date_instance_id=p_instance
             and candidate_id=p_candidate and status='offer_active') then
    raise exception 'cannot_reject_active_offer' using errcode='P0001';
  end if;
  update queue_entries set status='passed_by_host'::queue_status, updated_at=now()
   where date_instance_id=p_instance and candidate_id=p_candidate
     and status in ('interested','shortlisted','standby');
  if not found then raise exception 'not_rejectable' using errcode='P0002'; end if;
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('candidate_rejected', p_actor, 'queue_entry', p_candidate,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate));
  -- SILENT (D-04): no dispatch_notification to the candidate.
```

**Grant posture** — see Shared Pattern "Anon-revoke on new RPCs". `match_make_offer` left itself executable by `authenticated` (line 142); the new RPC must do the same BUT explicitly `revoke ... from anon` (Pitfall 2 — make_offer didn't need it because anon-grant predates that finding; `update_itinerary_stops` lines 53-55 show the correct posture).

---

### `supabase/migrations/<ts>_e12_queue_status_passed_by_host.sql` (enum ADD VALUE, transform)

**Analog:** `supabase/migrations/20260527124550_s2_notification_type_5b_extend.sql`

The `queue_status` enum (`20260525120500_p0_queue_entries.sql` line 3) is `('interested','shortlisted','offer_active','offer_passed','offer_expired','standby','locked')` — no host-decline value. Add one, in its **own migration ahead of `reject_candidate`** (Pitfall 1: a new enum value isn't usable in the same transaction it's added).

**Exact pattern to copy** (the whole analog is 5 lines of this):
```sql
alter type queue_status add value if not exists 'passed_by_host';
```

Then regen types (`pnpm db:reset && pnpm db:types`) so `HostCandidate['status']` in `InterestedList.tsx` (line 28) picks up the new member. Filter it OUT of both list sections (silent removal, D-04).

---

### `supabase/migrations/<ts>_e11_post_night_targeting.sql` (extend 2 DEFINER RPCs, request-response)

**Analogs:** `20260602140100_m3_post_night_fork.sql` (post_night) + `20260602140000_m3_update_itinerary_stops.sql` (update_itinerary_stops)

**(a) `update_itinerary_stops` — add `p_pay_setting` + `p_vibe_tags`.** Today it sets `why_note`+`cover_image_url` but NOT pay/vibe (lines 42-49). Extend the signature with new defaulted params and add to the `coalesce` SET list:
```sql
-- existing (lines 42-49) sets stops/title/why_note/cover_image_url/totals; ADD:
     pay_setting = coalesce(p_pay_setting, pay_setting),
     vibe_tags   = coalesce(p_vibe_tags, vibe_tags),
```
The grant block (lines 53-55) must be re-emitted for the NEW signature (the arg-type list changes), and it already demonstrates the correct `revoke public/anon → grant authenticated` posture to copy.

**(b) `post_night` — add targeting params, write to `date_instances` NOT the fork.** Pitfall 4: targeting lives on `date_instances`, the fork copies only `itineraries` columns (lines 46-58). Add `p_target_genders text[] default '{}'`, `p_target_age_range int4range default null`, `p_search_radius_km int default null` to the signature, leave the FORK select untouched, and add to the `insert into date_instances (...)` value list (lines 60-64):
```sql
  insert into date_instances
    (itinerary_id, creator_id, city_id, venue_id, starts_at, duration_min, status,
     ambient_sound_id, target_genders, target_age_range, search_radius_km)
  values
    (v_fork, v_actor, v_city, p_venue, p_starts_at, coalesce(p_duration_min,150), 'seeking',
     p_ambient_sound_id, p_target_genders, p_target_age_range, p_search_radius_km)
```
**Pitfall 3 (overload ambiguity):** `post_night` has churned signatures. `20260602120700_m4_post_night_drop_4arg.sql` is the precedent — `drop function if exists post_night(<stale arg list>)` so exactly ONE live signature remains. Re-emit the grant trio (lines 68-70) for the new signature. Update the `postNight` wrapper (`packages/api-client/src/feed.ts` lines 19-30) to pass the new `p_target_*`/`p_pay_setting` params.

---

### `supabase/migrations/<ts>_e11_targeting_cols.sql` (additive columns on `date_instances`, transform)

**Analog:** `supabase/migrations/20260525120500_p0_queue_entries.sql` (additive DDL + idempotent guards)

Add the three columns with safe DEFAULTs so existing prod rows stay valid (open-to-everyone / unbounded age / null radius — Runtime State Inventory). Use the same idempotent `add column if not exists` posture the analog uses for tables/indexes/policies (`create ... if not exists`, `do $$ ... exception when duplicate_object then null; end $$`). No RLS change needed — the existing `date_instances` row policies already cover the new columns (RLS is row-level).

---

### `apps/web/lib/after5/match.ts` — add `rejectCandidate` wrapper (client, request-response)

**Analog:** the `shortlist`/`withdraw` wrappers in the same file (lines 88-90, 128-130)

One-liner mirroring `shortlist`. Route through a thin `match-reject-candidate` edge fn (shortlist goes through an edge envelope; mirror that convention):
```typescript
export function rejectCandidate(instance: string, candidate: string): Promise<null> {
  return call<null>('match-reject-candidate', { instance, candidate });
}
```
Add a dry copy line to the `MESSAGES` map (lines 49-64) for any new error name. The `call<T>` envelope + `MatchError` mapping (lines 70-82) is the Shared "edge error → MatchError" pattern — reuse, do not re-implement.

---

### `apps/web/app/dates/[slug]/interested/InterestedList.tsx` — decline / withdraw / outcome (component, event-driven)

**Analogs:** self (optimistic mutate + rollback + toast) + `apps/web/app/my-nights/NightCardActions.tsx` (vaul confirm sheet)

**Optimistic-mutate-with-rollback** is the house pattern — copy `addToShortlist` (lines 141-155):
```typescript
const prev = rows;
setRows((r) => r.map((x) => (x.candidate_id === c.candidate_id ? { ...x, status: 'passed_by_host' } : x)));
try { await rejectCandidate(instanceId, c.candidate_id); }
catch { setRows(prev); toast.error("couldn't pass on them. try again?"); }
```
After success, filter `passed_by_host` out of both the `shortlisted` and `interested` memos (lines 106-115).

**Decline / withdraw confirm sheets** — copy the vaul confirm structure from `NightCardActions.tsx` lines 166-195 (overlay + bottom-sheet + grab handle + `Drawer.Title`/`Description` + primary accent CTA + secondary cancel). See Shared "vaul confirm sheet". Wire the withdraw confirm to the existing `withdraw(instance)` wrapper (match.ts line 128) on the frozen `offer_active` rank-1 row (lines 188-191 show where the "offer out" badge renders today).

**Outcome pills** — render off the existing `status` union (line 28). UI-SPEC §E12 fixes the labels: `accepted` (locked), `they passed` (offer_passed), `expired` (offer_expired), `offer out` (existing, lines 188-191). Tokens: `bg-shell-ink/5 text-shell-ink/55` for neutral pills.

---

### `apps/web/components/PlanTimeline.tsx` — EXTRACT (component, render transform)

**Analog / source:** `StopRow` (lines 365-449) + `StopTime` (lines 46-58) in `apps/web/app/feed/NightDetailSheet.tsx`

Move `StopRow` + `StopTime` verbatim into a new shared file, export `PlanTimeline` that renders the `<ol>` of `<StopRow>` (the loop body lives at NightDetailSheet lines 275-288). Keep the props contract: `stops: NightDetailStop[]`, `accent: string` (from `vibePalette(vibeTags).accent`), `vibeTags`. NightDetailSheet then imports it instead of its private copy. **Post-match identity is revealed**, so unlike `get_night_detail` the timeline MAY show minute-precise time + venue — but the StopRow shape is already blind-safe and renders fine either way; no scrubbing logic to remove. Normalize stops with `normalizeNightDetailStops` (`packages/api-client/src/feed.ts` lines 208-228) which handles `place_name`/`name` + `place_type`/`type` drift.

---

### `apps/web/app/offers/[offerId]/OfferDetail.tsx` + `page.tsx` — render plan, drop host.bio (E13)

**Analog:** self + the NightDetailSheet timeline; loader already embeds `date_instances`

**In `OfferDetail.tsx`:** the "the night" section (lines 97-102) renders ONLY date/time — the labelled-but-empty miss. Keep the eyebrow `the night` (line 98, `text-shell-accent`) + the date line + `ExpiryCountdown`, and add `<PlanTimeline stops={stops} ... />` below. Extend `OfferDetailProps` (lines 21-28) with `stops: NightDetailStop[]`. **Drop the dead `host.bio`** (line 93 render + the `bio` field in props line 26) per F#5.

**In `page.tsx`:** delete `bio: null` (line 98). The loader already reads `instance:date_instances!...` (lines 42-43) under the offer-recipient RLS policy — extend that embed to also pull `itinerary_id`, then do the **second RLS read** of the forked itinerary (Shared "SSR RLS read of matched plan"):
```typescript
// extend the embed: instance:date_instances!offers_date_instance_id_fkey ( starts_at, itinerary_id )
const { data: it } = instance?.itinerary_id
  ? await supabase.from('itineraries')
      .select('stops').eq('id', instance.itinerary_id).maybeSingle()  // itineraries_readable_by_id USING(true)
  : { data: null };
const stops = normalizeNightDetailStops(it?.stops);
```
**Degrade copy** (UI-SPEC): empty/failed → `the full plan unlocks here.` — never a blank section.

---

### `apps/web/app/matches/[lockId]/LockDetail.tsx` + `page.tsx` / `lock-view.ts` — add "the night" (E13)

**Analog:** `OfferDetail` (same `<PlanTimeline>` insertion) + the offer page loader

`LockDetail.tsx` renders no plan today. Add a `the night` section (eyebrow `text-shell-accent` like OfferDetail line 98 + `<PlanTimeline>`) between the `message {name}` block (lines 77-88) and the cancel actions (line 99). Extend `LockDetailProps` (lines 16-30) with `stops`. In `matches/lock-view.ts` extend the instance select with `itinerary_id`, then do the same two-step RLS read as the offer page. Post-lock the full itinerary is fair game. Missing-stops degrade copy: `plan's being put together.`

---

### `apps/web/app/nights/new/PostNightForm.tsx` — cover / targeting / why fields (E11)

**Analogs:** self (`fieldset`/`legend` + roving-tabindex radiogroup) + `NightCardActions.tsx` inputs

Group new fields into `<fieldset>`s using the existing `<legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">` (line 229). The ambient picker (lines 283-348) is the exact **sticker-chip / roving-tabindex radiogroup** template for who-pays + target-genders (`role="radiogroup"`, `aria-checked`, arrow-key handlers lines 95-109). Number inputs (target age min/max, radius) copy `NightCardActions` duration field styling (`rounded-2xl border-shell-ink/15 bg-white/80`, lines 228-237). The `why_note` `<textarea>` uses the same input shell. Submit CTA (lines 361-379) stays `post it`. Update the `postNight` wrapper to pass the new params.

### `apps/web/app/plans/[id]/edit/CoverUploader.tsx` (NEW) + ItineraryEditor publish CTA (E11)

**Analogs:** `apps/web/lib/after5/photos.ts addPhoto` (lines 45-66) for upload; `NightDetailSheet` sticky footer (lines 323-354) for the publish bar.

Cover upload copies the storage pattern (Shared "cover/photo upload"). Persist the resulting URL via `update_itinerary_stops(p_cover_image_url=...)` (already accepts it, migration line 10/46). Publish CTA is a nav (`router.push('/nights/new?itinerary=' + itineraryId)`) inside a sticky bar mirroring the NightDetailSheet footer classes (`border-t border-shell-ink/10 bg-shell-base/95 backdrop-blur`).

---

### SQL tests — `e12_reject_candidate.sql`, `e13_plan_read.sql`, `e11_targeting.sql`

**Analogs:** `supabase/tests/a_make_offer.sql` (reject happy-path + errcodes + the `\i _fixtures.sql` + `mk_user`/`mk_itinerary`/`mk_instance` + `set_config('request.jwt.claims', ...)` + per-block `ROLLBACK` harness) and `supabase/tests/e_offer_recipient_date_read.sql` (E13 positive/negative RLS read). Copy the `DO $$ ... EXCEPTION WHEN sqlstate 'P50xx' THEN ok:=true ... END $$` errcode-assertion blocks from a_make_offer lines 68-95 verbatim, swapping the RPC + expected codes (P5001/P5000/42501/cannot_reject_active_offer). Reuse the shared fixtures — no new fixtures needed.

---

## Shared Patterns

### DEFINER RPC skeleton (auth → flag → lock → ownership)
**Source:** `supabase/migrations/20260527126300_p5_make_offer.sql` lines 41-76
**Apply to:** `reject_candidate`, and the extended `post_night` / `update_itinerary_stops`
Every dating-write RPC re-checks `auth.uid()`, gates on `match_v2_enabled`, `pg_advisory_xact_lock(match_instance_lock_key(p_instance))` to serialize, and raises `42501` on non-creator. Errcode conventions: `P5001` auth, `P5000` flag, `P0002` no-row, `42501` not-owner, `P0001` state.

### Anon-revoke on new / overloaded RPCs (Pitfall 2)
**Source:** `supabase/migrations/20260602140000_m3_update_itinerary_stops.sql` lines 53-55
**Apply to:** `reject_candidate` + every re-emitted `post_night`/`update_itinerary_stops` signature
```sql
revoke execute on function <fn>(<arg types>) from public;
revoke execute on function <fn>(<arg types>) from anon;
grant  execute on function <fn>(<arg types>) to authenticated;
```
Supabase auto-grants EXECUTE to `anon` on new public functions; `revoke from public` is NOT enough.

### SSR RLS read of the matched plan (E13 — no new RPC)
**Source:** `apps/web/app/offers/[offerId]/page.tsx` lines 39-45 (offer-recipient embed) + `20260527127500_p5_offer_recipient_date_read.sql` (the policy that makes it readable)
**Apply to:** offer + lock page loaders
`date_instances_select_offer_recipient` lets the candidate/lock-party read the instance row; `itineraries_readable_by_id` (`USING(true)`) lets any caller read the forked itinerary by id. So: read `date_instances` → `itinerary_id` → `itineraries.stops` → `normalizeNightDetailStops`. Do NOT use `get_night_detail` (blind/pre-swipe-only; returns nothing post-match).

### vaul confirm sheet (decline / withdraw)
**Source:** `apps/web/app/my-nights/NightCardActions.tsx` lines 166-195
**Apply to:** InterestedList decline + withdraw
`Drawer.Root` (controlled `open`/`onOpenChange`) → `Drawer.Overlay bg-shell-ink/40` → `Drawer.Content` bottom-sheet (`fixed inset-x-0 bottom-0 ... rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]`) → grab handle → `Drawer.Title` (`font-heading text-3xl lowercase`) + `Drawer.Description` → primary `bg-shell-accent` confirm (≥48px) + secondary cancel (≥44px).

### Optimistic mutate + rollback + toast
**Source:** `apps/web/app/dates/[slug]/interested/InterestedList.tsx` lines 141-155 (`addToShortlist`) and `117-133` (`persistOrder`)
**Apply to:** every new InterestedList action
`const prev = rows; setRows(optimistic); try { await rpc(); } catch { setRows(prev); toast.error('<dry copy>'); }`

### Edge error → MatchError → toast
**Source:** `apps/web/lib/after5/match.ts` lines 70-82 (`call<T>`) + `OfferDetail.tsx` lines 46-70 (`run` wrapper) + `NightCardActions.tsx` lines 45-60 (PG-errcode → copy)
**Apply to:** all new client actions
Client wrappers throw `MatchError` keyed on the envelope `code`; components catch, branch on `e.code`, and `toast.error(messageForCode(e.code))`. Direct-RPC calls (no edge envelope) map `error.code` (PG errcode) via a local `errorCopy` switch.

### Cover / photo storage upload
**Source:** `apps/web/lib/after5/photos.ts addPhoto` lines 45-66
**Apply to:** `CoverUploader.tsx`
`const id = crypto.randomUUID(); const path = '${userId}/${id}.jpg'; client.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'image/jpeg' });` then persist the URL via `update_itinerary_stops(p_cover_image_url=...)`. Bucket choice (`itinerary-covers` new vs reuse `profile-photos`) is Claude's discretion (D-01) — a new bucket needs a migration mirroring `profile-photos` folder-scoped RLS keyed on `auth.uid()`.

### Additive enum value
**Source:** `supabase/migrations/20260527124550_s2_notification_type_5b_extend.sql`
**Apply to:** `queue_status` `passed_by_host`
`alter type <enum> add value if not exists '<value>';` in its OWN migration ahead of any function that references it (Pitfall 1).

### Stop normalization + StopRow render
**Source:** `packages/api-client/src/feed.ts` lines 208-228 + `NightDetailSheet.tsx` StopRow lines 365-449
**Apply to:** PlanTimeline + both detail screens
Reuse `normalizeNightDetailStops` for the rich/thin shape drift; reuse the StopRow markup (numbered thumb + dashed connector + name + meta + desc-with-"more" + `$pp` + map link).

---

## No Analog Found

None. Every Phase-3 surface maps to a shipped sibling. The only genuinely net-new artifacts (`reject_candidate` RPC, `CoverUploader`, `PlanTimeline`) are close adaptations/extractions of existing code, captured above.

---

## E14 — Audit, Not Build (no new analog needed)

The offer-delivery chain already exists and was read in full; E14 is a **chain audit + deep-link guarantee + Vercel env verify**, not a new file:
- `apps/web/lib/after5/match.ts` lines 99-125 — `makeOffer` fires `notifyOfferReceived` best-effort.
- `apps/web/app/api/offers/notify-offered/route.ts` (whole file) — `runtime='nodejs'`, ownership-gated (`creator_id=user.id`), best-effort 200, calls `sendOfferReceivedEmail`.
- In-app `offer_received` is dispatched transactionally INSIDE `match_make_offer` (line 130) — the reliability guarantee.
- Verify: `RESEND_API_KEY` set in Vercel server runtime (A1); VAPID state for push (A2); inbox notification row deep-links to `/offers/[offerId]`.

---

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/tests/`, `apps/web/app/{nights,dates,offers,matches,plans,feed,my-nights,api}/`, `apps/web/lib/after5/`, `apps/web/components/`, `packages/api-client/src/`
**Files scanned (read in full or targeted):** 16
**Pattern extraction date:** 2026-06-03

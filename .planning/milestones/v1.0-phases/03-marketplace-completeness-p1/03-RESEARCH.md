# Phase 3: Marketplace Completeness (P1) - Research

**Researched:** 2026-06-03
**Domain:** Brownfield Next.js 15 / Supabase dating-marketplace — creator controls, host triage, plan-on-match render, offer delivery reliability
**Confidence:** HIGH (all findings verified by reading prod-aligned migrations + live source; prod DDL state pre-verified via Supabase MCP per CONTEXT D-03/D-03b)

## Summary

Phase 3 is a brownfield completion phase on a LIVE app. The most important research outcome: **most of the infrastructure E11–E14 need already exists** — the work is extending/wiring it, not greenfield building. Specifically:

- **E11** extends the existing `PostNightForm` + `update_itinerary_stops` RPC + `post_night` RPC + the Door-2 `ItineraryEditor` canvas. Targeting columns (`target_genders`/`target_age_range`/`search_radius_km`) are net-new on `date_instances` (CONFIRMED absent on prod). `pay_setting`/`why_note`/`vibe_tags`/`cover_image_url` already live on **`itineraries`** (not `date_instances`) and are forked at post time; `why_note`+`cover_image_url` already have setters in `update_itinerary_stops`, `pay_setting`+`vibe_tags` do NOT. The Door-2 canvas has NO publish CTA today (it only saves) and `CoverPicker` only re-picks existing stop photos — a real uploader is net-new (reuse `lib/after5/photos.ts` storage pattern).
- **E12** is the one genuinely-new RPC (`reject_candidate`, confirmed absent on prod). Copy `match_make_offer`'s DEFINER + advisory-lock + feature-flag + idempotency-optional pattern. The `queue_status` enum has NO host-decline value — a decision is required (add `passed_by_host`/`declined` enum value vs. reuse). Silent decline (D-04): no candidate notification.
- **E13** renders the attached itinerary on `/matches/[lockId]` (`LockDetail`) and `/offers/[offerId]` (`OfferDetail`), both of which render ZERO stops today. The reusable timeline is `StopRow` inside `NightDetailSheet.tsx` (and the editorial `StopCard.tsx` for full pages). **KEY RLS FINDING:** the candidate/lock party can already read the `date_instances` row post-offer (`date_instances_select_offer_recipient`), and the forked itinerary row is world-readable by id via the legacy `itineraries_readable_by_id` `USING(true)` policy — so the plan stops can be loaded directly via the RLS client with NO new RPC. `get_night_detail` is BLIND/pre-swipe-only (`status='seeking'` + `creator_id <> auth.uid()`) so it does NOT work post-match — do not reuse it for E13.
- **E14** is largely reliability hardening, not a build. The server-runtime offer-email path **already exists and works**: `lib/after5/match.ts makeOffer()` → `POST /api/offers/notify-offered` (runtime=nodejs) → `sendOfferReceivedEmail` → `sendEmail` (RESEND key present server-side). The in-app `offer_received` notification is dispatched **inside** the RPC (guaranteed, transactional). Web push fans out via the existing `/api/cron/push-web` cron (inert without VAPID). The phase verifies/closes gaps in this chain and guarantees `/offers/[id]` deep-link reachability.

**Primary recommendation:** Treat Phase 3 as four extension tasks over proven surfaces. Net-new DB work = exactly two migrations (targeting columns on `date_instances`; `reject_candidate` RPC + a queue-state decision), both LOCAL-only/PROD-GATED. The cover uploader and Door-2 publish CTA are net-new UI. E13 needs NO new RPC (use existing RLS read paths). E14 needs a chain audit, not a rebuild.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (E11):** Add creator-control fields to the post/customize flow per the date-settings spec: who-pays (`pay_setting`), vibe-tags, the why (`why_note`), per-night radius (`search_radius_km`), exact scheduling, per-date targeting (`target_genders`, `target_age_range`). Add a real cover-image UPLOADER (storage-backed). Add a publish CTA on the Door-2 canvas. Show a reach preview ("~N people match this in <city>") only if the supporting query is cheap; otherwise defer reach preview to Phase 4.
- **D-02 (E11 stretch):** Per-stop "regenerate one venue" is a STRETCH — include ONLY if generate-plan already exposes a single-stop regenerate seam; otherwise defer to P3. **Research verdict: NO seam exists (see Open Questions) → DEFER to P3.**
- **D-03 (Door-2):** `create_blank_itinerary` CONFIRMED EXISTS on prod → Door 2 works; do NOT rebuild. Build the canvas publish-CTA + creator controls on top. Reconcile §2A canvas with the `open-city` `CreateFlow.tsx` scaffold (separate unmerged branch) — do NOT double-edit; treat open-city as a known parallel surface.
- **D-03b (targeting columns):** `date_instances.target_genders`/`target_age_range`/`search_radius_km` do NOT exist on prod → new additive migration required. `reject_candidate` also absent on prod (E12 = real build). All Phase-3 migrations LOCAL-only; prod apply GATED.
- **D-04 (E12):** `reject_candidate` RPC (DEFINER, creator-only, idempotent — copy `match_make_offer` pattern) sets a queue_entry to a declined/passed state. SILENT decline: the rejected candidate is NOT notified. They simply don't progress; removed from the host's active new-interest list.
- **D-05 (E12):** Surface offer OUTCOME (accepted/passed/expired) and a WITHDRAW control on the interested list.
- **D-06 (E13):** Render the FULL attached itinerary (all stops + venue names + per-stop timing/cost, reusing existing StopCard/timeline components) on BOTH `/matches/[lockId]` (LockDetail) and `/offers/[offerId]` (OfferDetail). Fix the offer screen's labelled-but-empty "the night" section.
- **D-07 (E13):** Phase 3 renders the plan; it does NOT change the photo-led reveal ordering (E15/Phase 5). Keep the existing reveal tier; just add the plan.
- **D-08 (E14):** GUARANTEE the in-app notification reaches the candidate (`/offers/[id]` reachable via inbox/notification deep-link regardless of email). Move the offer-received EMAIL off the edge runtime to a SERVER runtime with the RESEND key, best-effort. Add push if VAPID configured. In-app is the guarantee; email/push are enhancements.

### Claude's Discretion
- Cover-upload storage bucket + signing approach (reuse the photo-upload pipeline pattern).
- Exact reach-preview query (or its deferral to Phase 4).
- Targeting field UI (chips vs selects) following DESIGN-SYSTEM.md.
- Where the server-runtime offer email is triggered (API route vs server action).

### Deferred Ideas (OUT OF SCOPE)
- Feed-side filter application + sort + reach DATA layer → E10/Phase 4 (Phase 3 only adds the per-date targeting FIELDS at creation).
- Experience-led / progressive-reveal offer screens → E15/Phase 5.
- Per-stop regenerate if the edge seam isn't ready → P3.
- Chat↔profile↔night cross-links → E18/Phase 6.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-E11 | Creator controls: `pay_setting`, `vibe_tags`, `why_note`, per-night radius, cover uploader, publish CTA on Door-2 canvas; converge `PublishToFeedButton`/`/nights/new` | `PostNightForm` extends; `update_itinerary_stops` already sets `why_note`+`cover_image_url`, needs `p_pay_setting`+`p_vibe_tags`; `post_night` needs additive targeting params; targeting cols net-new on `date_instances`; cover uploader reuses `lib/after5/photos.ts` storage pattern; Door-2 `ItineraryEditor` needs a publish CTA (none today) |
| REQ-E12 | `reject_candidate` RPC + decline action in `InterestedList`; surface offer outcome + withdraw | Copy `match_make_offer` DEFINER pattern; `queue_status` enum lacks a host-decline value (decision needed); `offer_status` enum = `active/accepted/passed/expired` (outcome values); `match-withdraw` edge fn already exists (`withdraw()` in match.ts) |
| REQ-E13 | Render itinerary/stops on `/matches/[lockId]` + `/offers/[offerId]` | `LockDetail`/`OfferDetail` render no stops today; reuse `StopRow` (NightDetailSheet) / `StopCard.tsx`; load via existing RLS read paths — `date_instances_select_offer_recipient` + `itineraries_readable_by_id USING(true)`; NO new RPC needed; `get_night_detail` is blind-only, do NOT reuse |
| REQ-E14 | Server-runtime offer email + guaranteed in-app notification | Server email path ALREADY built (`/api/offers/notify-offered` runtime=nodejs → `sendOfferReceivedEmail` → `sendEmail`); in-app `offer_received` dispatched inside RPC (guaranteed); push via `/api/cron/push-web`; phase = chain audit + deep-link guarantee, not a rebuild |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Creator-control field persistence (E11) | Database (RPC: `post_night`, `update_itinerary_stops`) | — | All dating writes go through DEFINER RPCs; columns live on `itineraries`/`date_instances` |
| Targeting columns (E11) | Database (additive migration) | — | New schema on `date_instances`; net-new |
| Cover-image upload (E11) | Browser → Supabase Storage | Database (mirror URL on `itineraries`) | Storage upload is client-side (`client.storage.upload`), URL persisted via RPC |
| Reach preview (E11, conditional) | Database (`reach_preview` RPC) | Frontend Server (SSR call) | Per spec §130 "nothing business-critical in RSC"; defer if not cheap |
| Publish CTA on Door-2 (E11) | Browser (navigation) | — | Carries `itineraryId` to `/nights/new`; pure client nav |
| Reject candidate (E12) | Database (`reject_candidate` DEFINER RPC) | Browser (InterestedList action) | Queue mutation must be DEFINER (queue_entries has no write RLS) |
| Offer outcome + withdraw surfacing (E12) | Frontend Server (SSR read offers/queue) | Browser (withdraw action via existing edge fn) | Outcome is a read; withdraw reuses `match-withdraw` |
| Plan render on match/offer (E13) | Frontend Server (SSR RLS read) | Browser (StopRow component) | Stops load via RLS client at SSR; render is a client/SSR component |
| Offer-received email (E14) | API Route (Node runtime, `/api/offers/notify-offered`) | — | Needs RESEND key (server-only); edge runtime has blank key |
| In-app notification guarantee (E14) | Database (`dispatch_notification` inside RPC) | Frontend (inbox deep-link to `/offers/[id]`) | Notification row is transactional with the offer |
| Web push (E14, conditional) | API Route (cron `/api/cron/push-web`, Node) | — | Inert without VAPID; fans out undelivered web_push rows |

## Standard Stack

This is a brownfield phase — the "stack" is the existing codebase's libraries (no new packages required). Verified from `CLAUDE.md` STACK + `package.json`.

### Core (already installed — reuse, do not add)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 15.1.0 | App Router pages, API routes (Node runtime for email) | Existing app framework |
| React | 19.0.0 | UI components | Existing |
| @supabase/supabase-js | 2.45.0 | DB/auth/RPC/storage client | All data access |
| @supabase/ssr | 0.10.2 | Cookie-bound RLS client (`createClient`) | SSR security boundary |
| framer-motion | 12.40.0 | `Reorder.Group` (InterestedList, ItineraryEditor), motion | Existing drag/animation |
| vaul | 1.1.2 | Bottom-sheet drawers (cancel picker, etc.) | Existing modal pattern |
| sonner | 2.0.7 | Toasts | Existing feedback |
| lucide-react | 0.460.0 | Icons | Existing icon set |
| zod | 3.23.8 | Edge fn / API route input validation | `@after5/validators` |
| web-push | 3.6.7 | Server-side push (`lib/push/send.ts`) | E14 push enhancement |
| Resend (REST via fetch) | — | Email (`lib/email/resend.ts`) | E14 server-runtime email |

### Supporting (reuse patterns, not packages)
| Asset | Location | Purpose | When to Use |
|-------|----------|---------|-------------|
| `match_make_offer` | `supabase/migrations/20260527126300_p5_make_offer.sql` | DEFINER + advisory-lock + flag + idempotency + dispatch exemplar | E12 `reject_candidate` template |
| `lib/after5/photos.ts addPhoto` | storage upload + insert + mirror | Cover-image upload pattern (`client.storage.from(bucket).upload`) | E11 cover uploader |
| `StopRow` (in `NightDetailSheet.tsx` ~line 269) | inline blind-safe stop timeline | E13 reuse (extract to shared component) | Plan render on match/offer |
| `StopCard.tsx` | `apps/web/components/itinerary/StopCard.tsx` | editorial full-page stop card (planner side) | E13 full-page render alternative |
| `sendOfferReceivedEmail` + `/api/offers/notify-offered` | already built | E14 server-runtime email | Audit/verify, don't rebuild |
| `/api/cron/push-web` | already built | E14 web-push fanout | Verify VAPID gating |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct RLS read of `itineraries.stops` for E13 | A new DEFINER `get_matched_plan` RPC | RLS read works because `itineraries_readable_by_id` is `USING(true)` + offer-recipient can read the instance. A new RPC adds rigor (scrubs nothing extra here since identity is already revealed post-match) but is unnecessary build. Prefer the RLS read; note the `USING(true)` provenance. |
| Add `passed_by_host` enum value (E12) | Reuse existing `offer_passed`/`standby` | Reusing an offer-semantics value to mean "host declined" overloads the enum and corrupts analytics. A new dedicated value is cleaner but requires a migration touching the enum (see Pitfall 1). |
| API route for E14 email trigger | Next.js server action | Existing pattern is an API route (`/api/offers/notify-offered`) already wired from `makeOffer()` — no reason to migrate to a server action. |

**Installation:** None. No new packages this phase.

## Package Legitimacy Audit

> Not applicable — this phase installs ZERO new external packages. All work reuses already-installed dependencies (verified against `CLAUDE.md` STACK section + `package.json`). No registry verification or slopcheck required.

## Architecture Patterns

### System Architecture Diagram

```
E11 — CREATE/CUSTOMIZE NIGHT
  Door-2 canvas (ItineraryEditor)                PostNightForm (/nights/new)
    edit stops/title/cover/why/pay/vibe            pick plan + time + ambient
    [NEW] cover UPLOAD ─► Storage bucket           [NEW] who-pays / vibe / why /
    [NEW] "publish" CTA ──────┐                          radius / targeting fields
           │                  │                                │
           ▼                  ▼                                ▼
   update_itinerary_stops   /nights/new?itinerary=<id>   post_night RPC
   (RPC: +p_pay_setting,    (carries forked itinerary)   (+p_target_genders,
    +p_vibe_tags)                                          +p_target_age_range,
           │                                               +p_search_radius_km,
           ▼                                               +p_pay_setting)
     itineraries row ◄── fork-on-post copies ──────────────► date_instances row
     (pay/vibe/why/cover/stops)                             ([NEW] targeting cols)

E12 — HOST TRIAGE                          E13 — PLAN ON MATCH/OFFER
  InterestedList                             OfferDetail / LockDetail (SSR page)
    [NEW] decline btn ─► reject_candidate      load date_instance (RLS: offer-recip
    [NEW] outcome badge ◄─ offers.status          / lock-party policy)
    [NEW] withdraw ─► match-withdraw (exists)     │
           │                                       ▼ read itinerary_id
           ▼                                   itineraries.stops (RLS USING(true))
     queue_entries.status = <decline state>        │
     (SILENT: no candidate dispatch)               ▼ render <StopRow/> timeline

E14 — OFFER DELIVERY (mostly EXISTS)
  makeOffer() ─► match-make-offer edge ─► dispatch_notification('offer_received')  [IN-APP GUARANTEE, transactional]
       │                                          │
       │ (on kind='offer', best-effort)           ▼ notifications row
       └─► POST /api/offers/notify-offered    /api/cron/push-web (every min) ─► sendWebPush  [push, inert w/o VAPID]
              (runtime=nodejs, RESEND key)         │
              └─► sendOfferReceivedEmail ─► sendEmail (Resend)  [email enhancement]
   Candidate reaches /offers/[id] via inbox deep-link  ◄── reliability backbone
```

### Recommended File Touch Map (brownfield — edit existing)
```
apps/web/app/nights/new/PostNightForm.tsx       # E11: + who-pays/vibe/why/radius/targeting fields
apps/web/app/nights/new/page.tsx                # E11: accept ?itinerary= param from Door-2 CTA
apps/web/app/plans/[id]/edit/ItineraryEditor.tsx# E11: + publish CTA (carries itineraryId)
apps/web/app/plans/[id]/edit/CoverUploader.tsx  # E11: NEW real uploader (alongside CoverPicker)
apps/web/app/create/PublishToFeedButton.tsx     # E11/F#4: collapse/converge into real form
apps/web/lib/after5/match.ts                    # E12: + rejectCandidate() wrapper
apps/web/app/dates/[slug]/interested/InterestedList.tsx  # E12: decline/withdraw/outcome UI
apps/web/app/dates/[slug]/interested/page.tsx   # E12: load offer outcome into props
apps/web/app/matches/[lockId]/page.tsx          # E13: load itinerary stops
apps/web/app/matches/[lockId]/LockDetail.tsx    # E13: render stops
apps/web/app/matches/lock-view.ts               # E13: extend instance select w/ itinerary_id
apps/web/app/offers/[offerId]/page.tsx          # E13: load stops; remove dead host.bio
apps/web/app/offers/[offerId]/OfferDetail.tsx   # E13: render stops in "the night"; drop host.bio
apps/web/components/itinerary/PlanTimeline.tsx  # E13: NEW shared (extract StopRow)
supabase/migrations/<ts>_e11_targeting_cols.sql # E11: target_* cols + post_night/update_* params (LOCAL-only)
supabase/migrations/<ts>_e12_reject_candidate.sql # E12: reject_candidate RPC + queue state (LOCAL-only)
supabase/tests/e11_targeting.sql                # E11 pgTAP-style tests
supabase/tests/e12_reject_candidate.sql         # E12 pgTAP-style tests
```

### Pattern 1: DEFINER RPC (E12 `reject_candidate`)
**What:** Security-definer Postgres function that re-checks `auth.uid()`, gates on the feature flag, advisory-locks the instance, validates creator ownership, mutates `queue_entries`, and records analytics. SILENT (no `dispatch_notification` to the candidate).
**When to use:** E12 reject. Copy the structure from `match_make_offer` (the canonical exemplar) but strip offer-specific steps (no reciprocal, no chat, no candidate dispatch).
**Example (skeleton, derived from `20260527126300_p5_make_offer.sql`):**
```sql
-- Source: supabase/migrations/20260527126300_p5_make_offer.sql (exemplar)
create or replace function reject_candidate(p_actor uuid, p_instance uuid, p_candidate uuid)
returns void language plpgsql security definer set search_path=public as $fn$
declare cre uuid;
begin
  if p_actor is distinct from auth.uid() then raise exception 'auth_mismatch' using errcode='P5001'; end if;
  if not coalesce((select (value)::boolean from feature_config where key='match_v2_enabled'), false)
    then raise exception 'feature_disabled' using errcode='P5000'; end if;
  perform pg_advisory_xact_lock(match_instance_lock_key(p_instance));   -- serialize vs make_offer/roll
  select creator_id into cre from date_instances where id=p_instance;
  if cre is null then raise exception 'no_instance' using errcode='P0002'; end if;
  if cre <> p_actor then raise exception 'not_creator' using errcode='42501'; end if;
  -- guard: cannot reject the active offer-holder (must withdraw the offer first)
  if exists (select 1 from queue_entries where date_instance_id=p_instance
             and candidate_id=p_candidate and status='offer_active')
    then raise exception 'cannot_reject_active_offer' using errcode='P0001'; end if;
  update queue_entries
     set status = 'passed_by_host'::queue_status,   -- DECISION: new enum value (see Pitfall 1)
         updated_at = now()
   where date_instance_id=p_instance and candidate_id=p_candidate
     and status in ('interested','shortlisted','standby');
  if not found then raise exception 'not_rejectable' using errcode='P0002'; end if;
  insert into analytics_events(event_type, actor_id, subject_type, subject_id, payload)
  values ('candidate_rejected', p_actor, 'queue_entry', p_candidate,
          jsonb_build_object('instance', p_instance, 'candidate', p_candidate));
  -- SILENT: no dispatch_notification to candidate (D-04, off-brand to broadcast a rejection)
end $fn$;
-- reject_candidate is a public C2 RPC; auth enforced inside, but still:
revoke execute on function reject_candidate(uuid, uuid, uuid) from anon;
grant execute on function reject_candidate(uuid, uuid, uuid) to authenticated;
```
**Note:** `match_make_offer` is left executable by `authenticated` (auth enforced inside). Follow the same posture, but ALWAYS explicitly `revoke ... from anon` (Supabase auto-grants EXECUTE to anon on new public functions — see the `get_night_detail` comment block for this exact gotcha).

### Pattern 2: SSR RLS read of the matched plan (E13)
**What:** On the match/offer SSR page, after confirming the viewer can read the `date_instances` row, read `itinerary_id`, then select `itineraries.stops` with the same RLS client. No new RPC.
**When to use:** E13 plan render on both screens.
**Why it works (verified):** `date_instances_select_offer_recipient` (migration `20260527127500`) grants the offer candidate / lock party SELECT on the instance row; `itineraries_readable_by_id` (`20260419202912`) is `USING (true)` so any caller can read the forked itinerary by id. Project `stops`, `title`, `total_cost_pp`, etc.
**Example:**
```typescript
// Source: derived from offers/[offerId]/page.tsx + plans/[id]/edit/page.tsx read patterns
const { data: di } = await supabase
  .from('date_instances')
  .select('id, itinerary_id, starts_at, duration_min')
  .eq('id', instanceId).maybeSingle();          // RLS: offer-recipient / lock-party policy
const { data: it } = di?.itinerary_id
  ? await supabase.from('itineraries')
      .select('stops, title, total_cost_pp, total_duration_min')
      .eq('id', di.itinerary_id).maybeSingle()   // RLS: itineraries_readable_by_id USING(true)
  : { data: null };
const stops = normalizeNightDetailStops(it?.stops);  // reuse the existing normalizer (feed.ts)
```
Reuse `normalizeNightDetailStops` from `packages/api-client/src/feed.ts` to handle the rich/thin stop shapes.

### Pattern 3: Cover-image upload (E11)
**What:** Client-side blob upload to a Supabase Storage bucket, then persist the public/signed URL onto `itineraries.cover_image_url` via `update_itinerary_stops` (already accepts `p_cover_image_url`).
**Example (mirrors `lib/after5/photos.ts addPhoto`):**
```typescript
// Source: apps/web/lib/after5/photos.ts (addPhoto)
const id = crypto.randomUUID();
const path = `${userId}/${id}.jpg`;
const { error } = await client.storage.from('itinerary-covers')
  .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
// then publicUrl/signedUrl → updateItineraryStops({ ..., cover_image_url: url })
```
**Bucket decision (Claude's discretion per D-01):** create a NEW `itinerary-covers` bucket (mirror the `profile-photos` bucket migration `20260525122600` + folder-scoped RLS keyed on `auth.uid()`), OR reuse `profile-photos`. A dedicated bucket is cleaner for RLS auditing. Bucket creation is a migration (LOCAL-only/gated).

### Anti-Patterns to Avoid
- **Reusing `get_night_detail` for E13:** It is BLIND/pre-swipe-only (`status='seeking'` + `creator_id <> auth.uid()`). It returns nothing post-match or for the host. Do NOT use it for match/offer plan render.
- **Adding targeting columns to `itineraries`:** Targeting is per-DATE (per `date_instances`), not per-plan. The spec (§25-27) and CONTEXT D-03b are explicit: columns go on `date_instances`.
- **Notifying the rejected candidate (E12):** D-04 forbids it. The decline is silent; the candidate just stops progressing.
- **Editing `CreateFlow.tsx` (open-city) in this phase:** It's a separate unmerged parallel surface (per CONTEXT D-03 + spec §141-142). Reconcile/converge AFTER it lands; do not double-edit concurrently. The F#4 convergence target is `PublishToFeedButton.tsx` + `/nights/new`, NOT the open-city flow.
- **Hand-rolling a second offer-email path:** The server-runtime path exists. Don't add a parallel sender.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DEFINER RPC structure (E12) | A bespoke auth/lock/flag pattern | Copy `match_make_offer` exemplar | Advisory-lock key helper (`match_instance_lock_key`), flag gate, errcode conventions all exist |
| Stop timeline render (E13) | A new timeline component | Extract/reuse `StopRow` (NightDetailSheet) or `StopCard.tsx` | Already styled to DESIGN-SYSTEM, handles thin/rich shapes |
| Stop JSON normalization (E13) | Manual jsonb parsing | `normalizeNightDetailStops()` (feed.ts) | Handles `place_name`/`name` + `place_type`/`type` shape drift |
| Server-runtime offer email (E14) | A new email route | `/api/offers/notify-offered` + `sendOfferReceivedEmail` | Already built, runtime=nodejs, ownership-checked, best-effort |
| Web push fanout (E14) | A new push dispatcher | `/api/cron/push-web` + `lib/push/send.ts` | Already scans undelivered web_push rows; inert without VAPID |
| Photo/cover storage upload (E11) | A new upload helper | `client.storage.from(bucket).upload()` pattern (photos.ts) | Proven, folder-scoped RLS |
| Drag-reorder (E11/E12) | A custom DnD | `framer-motion Reorder.Group` (already in InterestedList + ItineraryEditor) | Established pattern |
| Candidate self-withdraw (E12 D-05) | A new withdraw RPC | `match-withdraw` edge fn / `withdraw()` in match.ts | Already exists (exported for sub-project E) |

**Key insight:** Phase 3's risk is NOT missing infrastructure — it's *duplicating* infrastructure that already exists in slightly non-obvious places (the offer-email server path, the offer-recipient RLS read, the blind-vs-post-match RPC distinction). Research-driven reuse is the entire game here.

## Runtime State Inventory

This phase is mostly additive (new columns, new RPC, UI), NOT a rename/migration. But it adds DB state that interacts with live prod, so the relevant audit:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `date_instances.target_*` columns — existing prod rows get DEFAULTs (open-to-everyone / unbounded age / city default radius). New `queue_status` enum value (E12) — no existing row uses it. | Migration must add columns with safe DEFAULTs; backfill is a no-op (defaults cover existing rows). Verified: `date_instances` exists on prod, targeting cols absent. |
| Live service config | None. No external service config embeds Phase-3 strings. | None — verified: E11–E14 touch only Supabase DB + app code. |
| OS-registered state | None. | None — no OS/cron registration changes (push-web cron already registered in `apps/web/vercel.json`). |
| Secrets/env vars | E14 relies on EXISTING secrets: `RESEND_API_KEY` (server runtime, present per PROJECT.md), `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (push, may be absent → push inert). No NEW secret introduced. | Verify RESEND_API_KEY is set in the Vercel SERVER runtime (PROJECT.md says yes); confirm VAPID state to know if push activates. |
| Build artifacts | `packages/types/src/database.ts` is generated from the schema — STALE after the new migrations until `db:types` runs. | Run `pnpm db:reset && pnpm db:types` after each migration locally so TS types include `target_*` cols + the new enum value. |

**Migrations are LOCAL-only this phase; PROD APPLY GATED (D-03b + CLAUDE.md). Run the security advisor after each DDL.**

## Common Pitfalls

### Pitfall 1: `queue_status` enum has no host-decline value
**What goes wrong:** E12 `reject_candidate` needs a target state, but `queue_status` = `('interested','shortlisted','offer_active','offer_passed','offer_expired','standby','locked')`. None means "host declined this candidate." Reusing `offer_passed` (a CANDIDATE-passed-the-offer semantic) corrupts analytics and the InterestedList filters.
**Why it happens:** The enum was designed before host-decline was a feature.
**How to avoid:** Add a new enum value (e.g. `passed_by_host` or `declined`) via `ALTER TYPE queue_status ADD VALUE`. **Gotcha:** in Postgres, `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block with other DDL in some versions, and the new value isn't usable in the same transaction it's added. Put the `ADD VALUE` in its own migration step (or its own statement) ahead of the function that references it. Verify against PG17 behavior on local before gating for prod.
**Warning signs:** `unsafe use of new value of enum type` error at function creation/test time.

### Pitfall 2: anon auto-EXECUTE on new RPCs
**What goes wrong:** Supabase auto-grants EXECUTE to `anon` on every new public function. `revoke ... from public` is NOT enough.
**Why it happens:** Documented Supabase default-privilege behavior (see the explicit comment in `get_night_detail.sql` and the spec's "Revoke anon EXECUTE on the new overload").
**How to avoid:** Every new/overloaded function (`reject_candidate`, the new `post_night` overload, the extended `update_itinerary_stops`) must `revoke execute ... from anon` explicitly, then `grant ... to authenticated`.
**Warning signs:** Security advisor flags an anon-executable function; a pgTAP test that calls the fn as anon succeeds when it shouldn't.

### Pitfall 3: `post_night` function-overload ambiguity
**What goes wrong:** `post_night` has had MULTIPLE signatures over time (4-arg, 5-arg). Adding targeting params changes the signature again. A `create or replace` with a different arg list creates a NEW overload, not a replacement — "function ... is not unique" errors at call time (this exact bug is documented in `20260602120700_m4_post_night_drop_4arg.sql`).
**Why it happens:** Postgres keys functions by name + arg types; new params = new function.
**How to avoid:** When adding `p_target_genders`/`p_target_age_range`/`p_search_radius_km`/`p_pay_setting`, decide whether to (a) extend the existing 5-arg fork signature in place (all new params with DEFAULTs, single signature) or (b) drop prior overloads first. Follow the precedent: the spec says "additive params... backward-compatible (defaults), existing callers unaffected." Ensure exactly ONE live signature; drop stale overloads if ambiguity appears. Update the client wrapper (`postNight` in `packages/api-client/src/feed.ts`) to pass the new params.

### Pitfall 4: forking drops new targeting columns
**What goes wrong:** `post_night` FORKS the itinerary (deep-copies into a private row) but targeting lives on `date_instances` (the night), not `itineraries`. The fork copies itinerary columns; targeting must be written into the `insert into date_instances (...)` clause, NOT the fork select.
**Why it happens:** The fork logic (lines copying `pay_setting, why_note, vibe_tags, cover_image_url`) is on `itineraries`; targeting is a different table.
**How to avoid:** Add `target_genders`, `target_age_range`, `search_radius_km` to the `insert into date_instances (...)` value list in the updated `post_night`, sourced from the new params. Don't touch the fork select for these.

### Pitfall 5: E13 stops invisible because the candidate reads the WRONG row
**What goes wrong:** A naive E13 query tries `get_night_detail` (blind, fails post-match) or tries to read `itineraries` of the ORIGINAL plan (the candidate doesn't know it) instead of the FORKED itinerary referenced by `date_instances.itinerary_id`.
**Why it happens:** The fork indirection + the blind-RPC trap.
**How to avoid:** Always go `date_instances` (RLS-readable post-offer) → `itinerary_id` → `itineraries` (USING(true)). Verified RLS path. Add a pgTAP-style test (`e_offer_recipient_date_read.sql` is the precedent) asserting the candidate can read the forked stops post-offer and a stranger cannot read the instance.

### Pitfall 6: `host.bio` dead branch (F#5)
**What goes wrong:** `OfferDetail` renders `host.bio` but the loader hardcodes `bio: null` ("profiles has no bio column"). Dead UI.
**How to avoid:** Per F#5, remove the `host.bio` branch from `OfferDetail` (or back it with a real column — out of scope). E13 work touches this file anyway; delete the dead branch.

## Code Examples

### E12: client wrapper (add to match.ts, mirrors existing wrappers)
```typescript
// Source: apps/web/lib/after5/match.ts (shortlist/withdraw patterns)
export function rejectCandidate(instance: string, candidate: string): Promise<null> {
  return call<null>('match-reject-candidate', { instance, candidate });
}
```
(Requires a thin `match-reject-candidate` edge fn mirroring `match-shortlist`, OR call the RPC directly via the RLS client if no edge envelope is needed — match existing convention: shortlist goes through an edge fn, so mirror that.)

### E13: extracted shared timeline (reuse on both screens)
```typescript
// Source: extracted from apps/web/app/feed/NightDetailSheet.tsx StopRow (~line 269)
// New file apps/web/components/itinerary/PlanTimeline.tsx renders the
// <ol> of <StopRow/>. Post-match, identity is revealed, so unlike get_night_detail
// the render MAY include minute-precise time + venue (no blind scrubbing needed).
```

### E11: publish CTA on Door-2 canvas (navigation)
```typescript
// Source: derived from PublishToFeedButton.tsx + ItineraryEditor save flow
// After save, a "post this night" CTA navigates carrying the forked itinerary id:
router.push(`/nights/new?itinerary=${itineraryId}`);
// /nights/new page.tsx reads ?itinerary= and pre-selects that plan in PostNightForm.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `PublishToFeedButton` hardcoded date, no controls (F#4) | Converge into `/nights/new` real form carrying the forked itinerary id | This phase (E11) | One publish path with full creator controls |
| Match/offer screens show person only, no plan | Render attached itinerary stops | This phase (E13) | "Every match has a real plan attached" finally holds |
| Offer email best-effort from EDGE (blank RESEND key) | Server-runtime Node route (RESEND present) — ALREADY DONE | Pre-phase (already built) | E14 verifies, doesn't rebuild |
| Cover = pick an existing stop photo (`CoverPicker`) | Real cover UPLOADER (storage-backed) | This phase (E11) | Hosts can upload a bespoke cover |

**Deprecated/outdated:**
- `get_night_detail` for post-match render — it's blind-only; not a candidate for E13.
- `itineraries_readable_by_id USING(true)` — a legacy pre-secure-by-default policy. E13 leans on it (works), but flag it: a future hardening phase may want a DEFINER read scoped to participants. Out of scope now; note the dependency.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `RESEND_API_KEY` IS set in the Vercel SERVER runtime (per PROJECT.md), so `/api/offers/notify-offered` actually sends on prod | E14 | If blank on server too, E14 email never sends — but in-app guarantee (D-08) still holds, so non-blocking. Verify in Vercel env. |
| A2 | VAPID keys may be ABSENT → push inert (`web_push_not_configured`) | E14 | If absent, the "add push if VAPID configured" enhancement is a no-op this phase. Not a blocker (in-app is the guarantee). Confirm VAPID env state. |
| A3 | A dedicated `passed_by_host` queue_status enum value is the right model for E12 decline (vs reusing existing) | E12 | If the planner/founder prefers reusing a value or a boolean flag, the migration shape changes. Surfaced as a decision in Pitfall 1. |
| A4 | A new `itinerary-covers` storage bucket (vs reusing `profile-photos`) | E11 | Bucket choice is D-01 discretion; either works. Low risk. |
| A5 | E13 can use the existing RLS read (no new RPC) because `itineraries_readable_by_id` is `USING(true)` | E13 | VERIFIED by reading the policy. Risk only if a future migration tightens that policy before this ships. |
| A6 | `reach_preview` is a "cheap" query is UNKNOWN until the targeting data layer (Phase 4) exists; per D-01 default to DEFERRING reach preview to Phase 4 | E11 | If deferred wrongly, hosts lose a nice-to-have nudge. D-01 explicitly allows deferral. Recommend defer. |

## Open Questions (RESOLVED)

> All resolved in 03-CONTEXT before planning: Q1 (E12 decline) → D-09 `passed_by_host` + silent removal; Q2 (reach preview) → D-11 defer to Phase 4; Q3 (RESEND/VAPID) → D-13 execution-time verify. Plans implement these.

1. **D-02 per-stop regenerate seam — does `generate-plan` support single-slot regenerate?**
   - What we know: `generate-plan/index.ts` `InputSchema` (verified) is a FULL-plan generator (occasion/duration/vibe/budget/radius/...). NO `stop_index`/`replace`/`single-slot` field exists. No `regenerate` code path found.
   - What's unclear: nothing — the seam is absent.
   - Recommendation: **DEFER D-02 to P3** per CONTEXT D-02 ("include ONLY if the edge already exposes a seam; otherwise defer"). Do not build the seam this phase.

2. **E12 decline state: new enum value vs. reuse?**
   - What we know: `queue_status` has no host-decline value; reusing offer-semantics values corrupts analytics.
   - What's unclear: founder preference for the exact value name (`passed_by_host` vs `declined`) and whether the rejected candidate should be hard-removed from the host's list vs. shown in a collapsed "passed" section.
   - Recommendation: add a dedicated `passed_by_host` value; filter it OUT of both InterestedList sections (silent removal, D-04). Confirm naming at plan time.

3. **Reach preview inclusion (E11):**
   - What we know: `reach_preview` RPC needs the targeting/filter data layer that is Phase 4's scope.
   - Recommendation: DEFER reach preview to Phase 4 (D-01 allows it) unless a trivial count query is feasible against the new columns alone.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase local stack | All migrations + pgTAP-style tests | ✓ (CLI + Postgres 17) | PG17 | — |
| `pnpm db:reset` / `db:types` / `db:test` | Local migration+type+test loop | ✓ (scripts in package.json) | — | — |
| RESEND_API_KEY (server) | E14 email send | Assumed ✓ on Vercel server (A1) | — | In-app notification (always works) |
| VAPID keys | E14 push enhancement | Unknown (A2) | — | Push stays inert; in-app + email cover delivery |
| Supabase Storage | E11 cover upload | ✓ (existing buckets: profile-photos, ambient-sounds) | — | — |
| `psql` (for db:test) | pgTAP-style SQL tests | ✓ (db:test uses psql against :54322) | — | — |

**Missing dependencies with no fallback:** None — all execution deps present locally.
**Missing dependencies with fallback:** VAPID (push) → in-app/email cover delivery; RESEND-on-server (if somehow blank) → in-app guarantee covers it.

## Validation Architecture

> nyquist_validation is enabled (config.json workflow.nyquist_validation = true).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 (TS unit/jsdom) + pgTAP-style SQL via psql + Playwright 1.49 (E2E) |
| Config file | `vitest.config.ts` + `vitest.workspace.ts` (splits packages=Node / apps/web=jsdom); SQL tests in `supabase/tests/*.sql` |
| Quick run command | `pnpm --filter web test` (jsdom) / `pnpm test` (vitest run all) |
| Full suite command | `pnpm db:reset && pnpm db:types && pnpm db:test && pnpm typecheck && pnpm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-E11 | targeting cols persist via `post_night`; `update_itinerary_stops` sets pay/vibe; anon EXECUTE revoked | SQL (pgTAP-style) | `psql ... -f supabase/tests/e11_targeting.sql` | ❌ Wave 0 (precedent: `m4_post_night_ambient.sql`, `m3_update_itinerary_stops.sql`) |
| REQ-E11 | cover upload helper + publish-CTA nav | unit/jsdom | `pnpm --filter web test` (CoverUploader + ItineraryEditor tests) | ❌ Wave 0 |
| REQ-E12 | `reject_candidate` happy path + errcodes (P5000/P5001/42501) + idempotency + cannot-reject-active-offer + anon revoked | SQL | `psql ... -f supabase/tests/e12_reject_candidate.sql` | ❌ Wave 0 (precedent: `a_make_offer.sql`) |
| REQ-E12 | decline/withdraw/outcome UI | unit/jsdom | `pnpm --filter web test` (InterestedList test) | ❌ Wave 0 |
| REQ-E13 | candidate/lock-party reads forked stops; stranger cannot read instance | SQL | `psql ... -f supabase/tests/e13_plan_read.sql` | ❌ Wave 0 (precedent: `e_offer_recipient_date_read.sql`) |
| REQ-E13 | LockDetail/OfferDetail render stops; empty/degraded fallback | unit/jsdom | `pnpm --filter web test` | ❌ Wave 0 |
| REQ-E14 | `/api/offers/notify-offered` ownership-gates + best-effort skip; push-web fanout | unit/jsdom (route tests) | `pnpm --filter web test` | ⚠️ partial (`push-web/route.test.ts` exists; add notify-offered + chain test) |
| REQ-E11..E14 | end-to-end: host posts targeted night → triages → offers → candidate sees plan on offer screen | E2E Playwright | `pnpm --filter web e2e` (new spec) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter web test` (fast jsdom) + `pnpm typecheck`. For DB tasks: `pnpm db:reset && pnpm db:types && psql ... -f <the one new test>.sql`.
- **Per wave merge:** `pnpm db:test` (all SQL) + `pnpm test` (all vitest) + `pnpm typecheck`.
- **Phase gate:** full suite green (db:reset→types→db:test→typecheck→test) + the new E2E spec before `/gsd:verify-work`. Migrations stay LOCAL; do NOT prod-apply at the gate.

### Wave 0 Gaps
- [ ] `supabase/tests/e11_targeting.sql` — REQ-E11 (post_night targeting params, update_itinerary_stops pay/vibe, anon revoked)
- [ ] `supabase/tests/e12_reject_candidate.sql` — REQ-E12 (copy structure from `a_make_offer.sql` + `_fixtures.sql`)
- [ ] `supabase/tests/e13_plan_read.sql` — REQ-E13 (copy from `e_offer_recipient_date_read.sql`)
- [ ] jsdom tests: `CoverUploader.test.tsx`, `InterestedList` decline/withdraw additions, `OfferDetail`/`LockDetail` stop-render
- [ ] route test: `notify-offered/route.test.ts` (ownership gate + best-effort skip)
- [ ] E2E spec: `marketplace-completeness.spec.ts` (host→triage→offer→candidate-sees-plan) — follow existing `5b-*.spec.ts` authed-session recipe
- [ ] Shared fixtures already exist (`supabase/tests/_fixtures.sql` provides `mk_user`/`mk_itinerary`/`mk_instance`) — reuse, no new fixtures needed

## Security Domain

> security_enforcement = true, security_asvs_level = 1, security_block_on = high.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase session cookie; every RPC re-checks `auth.uid()` (DEFINER pattern) |
| V3 Session Management | yes | `@supabase/ssr` cookie-bound RLS client; no server session state |
| V4 Access Control | yes (CORE) | DEFINER RPCs re-check creator ownership (`cre <> p_actor → 42501`); `revoke anon`; queue_entries has NO write RLS (only RPCs mutate); offer-recipient/lock-party SELECT policies for E13 |
| V5 Input Validation | yes | zod on edge fn / API route bodies; SQL-side shape validation (`update_itinerary_stops` validates stops array; `post_night` validates venue/ambient/future-date) |
| V6 Cryptography | no | No new crypto; storage URLs signed by Supabase; never hand-roll |

### Known Threat Patterns for Next.js 15 / Supabase RLS

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Anon-executable new RPC (auto-grant) | Elevation of Privilege | `revoke execute ... from anon` on EVERY new/overloaded fn (Pitfall 2) |
| Host rejects/forges another host's queue | Tampering / EoP | DEFINER re-checks `creator_id = auth.uid()` (42501); advisory-lock serializes vs make_offer |
| Candidate reads a plan they weren't offered (E13) | Information Disclosure | `date_instances_select_offer_recipient` gates the instance read; pgTAP negative test (stranger denied) |
| Function-overload ambiguity → wrong fn called | Tampering | Single live signature; drop stale overloads (Pitfall 3) |
| Cover-upload path traversal / cross-user write | Tampering | Folder-scoped storage RLS keyed on `auth.uid()` (mirror profile-photos bucket policy) |
| Email/push leaks offer existence to wrong user | Information Disclosure | `/api/offers/notify-offered` already verifies caller is offer creator before sending; preserve that check |
| `USING(true)` on itineraries (E13 read path) | Information Disclosure | Accepted legacy posture; the privacy boundary is the unguessable UUID + the gated instance read. Flag for future hardening (out of scope). |

**Run the Supabase security advisor after every DDL (CLAUDE.md mandate) and confirm no new high-severity findings before the gate (security_block_on=high).**

## Sources

### Primary (HIGH confidence — read directly this session)
- `supabase/migrations/20260527126300_p5_make_offer.sql` — DEFINER exemplar for E12
- `supabase/migrations/20260602140100_m3_post_night_fork.sql` — `post_night` fork + signature
- `supabase/migrations/20260602140000_m3_update_itinerary_stops.sql` — setter coverage (why_note/cover present; pay/vibe absent)
- `supabase/migrations/20260525120300_p0_date_instances.sql` — `date_instances` schema (targeting cols absent)
- `supabase/migrations/20260525120500_p0_queue_entries.sql` + `20260527126200_p5_shortlist.sql` — `queue_status` enum + triage RPCs
- `supabase/migrations/20260601210000_m5_get_night_detail.sql` — proves blind/pre-swipe-only (NOT for E13)
- `supabase/migrations/20260527127500_p5_offer_recipient_date_read.sql` — E13 RLS read path
- `supabase/migrations/20260419202912_itineraries_readable_by_id.sql` — `USING(true)` itinerary read
- `supabase/migrations/20260525120600_p0_offers.sql` — `offer_status` enum (outcome values)
- `apps/web/app/nights/new/PostNightForm.tsx`, `apps/web/app/dates/[slug]/interested/{InterestedList,page}.tsx`
- `apps/web/app/matches/[lockId]/LockDetail.tsx` + `apps/web/app/matches/lock-view.ts`
- `apps/web/app/offers/[offerId]/{OfferDetail,page}.tsx`
- `apps/web/app/plans/[id]/edit/{ItineraryEditor,CoverPicker,page}.tsx`
- `apps/web/lib/after5/match.ts`, `apps/web/lib/after5/photos.ts`, `apps/web/lib/email/{resend,send-offer-received}.ts`, `apps/web/lib/push/send.ts`
- `apps/web/app/api/offers/notify-offered/route.ts`, `apps/web/app/api/offers/email/route.ts`, `apps/web/app/api/cron/push-web/route.ts`
- `apps/web/app/feed/NightDetailSheet.tsx` (StopRow timeline), `apps/web/components/itinerary/StopCard.tsx`
- `packages/api-client/src/feed.ts` (`updateItineraryStops`, `getNightDetail`, `normalizeNightDetailStops`, types)
- `supabase/functions/generate-plan/index.ts` (InputSchema — no single-stop seam)
- `supabase/tests/*.sql` (pgTAP-style convention; `_fixtures.sql`, `a_make_offer.sql`, `e_offer_recipient_date_read.sql`)
- CONTEXT.md (D-01..D-08), REQUIREMENTS.md (REQ-E11..E14), MVP-AUDIT §E/§F, date-settings spec §2/§2A/§build, CLAUDE.md, config.json

### Secondary (MEDIUM confidence)
- PROJECT.md / memory notes for RESEND-server / VAPID env state (verify at execution — A1/A2)

### Tertiary (LOW confidence)
- None — all claims grounded in directly-read source or pre-verified prod MCP state (CONTEXT D-03/D-03b).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — brownfield; no new packages; all reuse targets read directly.
- Architecture: HIGH — every RPC/RLS/route claim verified against migration + source files; E13 RLS path and E14 email-chain confirmed by reading the actual code.
- Pitfalls: HIGH — each pitfall (enum, anon-grant, overload, fork-table, blind-RPC, dead host.bio) traced to a concrete line/comment in the codebase.
- E14 "already built" finding: HIGH — `/api/offers/notify-offered` + `sendOfferReceivedEmail` + `push-web` cron read in full.

**Research date:** 2026-06-03
**Valid until:** 2026-06-17 (brownfield codebase; valid until the open-city `CreateFlow` branch merges or any of the touched files change — re-check the targeting-column / queue-enum state if migrations land before planning).

# P3 — Creation & Content Pipeline — Pre-Build Audit

Auditor stance: paranoid principal engineer. Question audited: *if an engineer executes this plan exactly, does it yield working, end-to-end software that does not regress sibling phases?* Answer: **No, not as written.** It contains one execution-fatal migration, two cross-phase regressions that silently break P4 and P8, a media pipeline that cannot actually serve its files, and a personalization/conversion surface with no real client. Cross-referenced: spec §4/§5/§10, P0 (`itineraries`, `date_instances`, `places`, `audit_log`, `browse_feed` v0), P4 (`browse_feed` geo + RPC), P8 (`browse_feed` UGC-gated + `itineraries.moderation_status`), and the live repo schema (`20260419193959_initial_schema.sql`, `20260522100000_capture_full_schema.sql`).

---

## CRITICAL MISSING SYSTEMS

1. **`create or replace view browse_feed` (Task 14) is execution-fatal.** Postgres forbids `CREATE OR REPLACE VIEW` from dropping, renaming, or reordering existing output columns — it may only *append* columns at the end. P0/P4/P8 already define `browse_feed` with a fixed column list and order. P3's v2 reorders (`opener` inserted mid-list) and changes the trailing set. On `supabase db reset` this throws `cannot change name of view column "…"` / `cannot drop columns from view`. **The migration will not apply.** The whole `db reset` (Task 15) fails, so every later phase that resets the DB is dead too.

2. **No `browse_feed` reconciliation across four phases — P3 silently regresses P4 and P8.** Migration timestamps decide the last writer. P0=`202605251210xx`, P4=`202605251301xx`, P8=`202605251305xx`, **P3=`2026052613xxxx`** (May 26 > May 25). So even if Task 14 *did* apply, P3's view is applied **last** and wins. P3's v2 (a) **drops P8's `and i.moderation_status='approved'` filter** → hidden/removed UGC reappears in the feed = a moderation-bypass safety regression; and (b) **omits P4's `is_seed` column** → P4 view-consumers / cold-start break. This is the single most dangerous defect: it re-publishes content a moderator explicitly removed.

3. **P3 surfaces sound title/license on the wrong object.** Task 14's stated purpose is "browse UI shows ♪ Lakeside Dusk · CC0 instead of a dead control." But the feed the UI actually calls is **P4's `browse_feed_for_viewer()` RPC**, which queries base tables directly and returns a fixed `RETURNS TABLE` signature with **no `sound_title`/`sound_license`/`sound_attribution`/`opener`**. Editing the `browse_feed` *view* changes nothing the client reads. The "dead ambient-sound UI" is **not closed**; the licensing strings never reach a screen.

4. **No signed-URL minting path — the private-bucket pipeline cannot serve media.** Buckets are `public=false` (Task 1); the architecture says "approved media via signed URLs minted server-side." **No RPC, Edge Function, or helper mints those signed URLs anywhere in P3.** `media_assets.cdn_url` is written by `process-media` as a "signed/public CDN URL" (Task 10 Step 4 is hand-wavy: "mint a signed/public CDN URL") but a Supabase signed URL **expires** (max ~7 days, default 60s); storing it in a column and attaching it to `itineraries.ambient_sound_url` means the audio link **dies** and the feed plays nothing. Either the bucket must be public-read (contradicts Task 1's test that asserts `public=false`) or a per-request signing endpoint is required. Neither exists. The pipeline is non-functional end to end.

5. **No real transcode implementation — `process-media` is a stub with an impossible claim.** Task 10 says images go to webp "via Supabase Storage's image transformation" and audio is "normalized/clipped." Supabase image transform is a **read-time render param on download URLs**, not a write-time transcoder that produces a stored webp object; you cannot "transcode to webp and upload the artifact" with it. Audio normalization/clipping requires ffmpeg/WASM in Deno — not present, not specced, not in deps. The only runnable code is two pure string helpers (`processedPathFor`, `clampAudioDuration`). The function will set `processing_state='processed'` having done no actual processing, or fail. `width/height/duration_sec` have no real extractor.

6. **The "why" note is never moderated at creation, contradicting the plan's own UGC claim.** P3 routes photos/audio through `media_assets` moderation but `personalize_itinerary` writes `why_note`/`opener` (free-text UGC, spec §4 explicitly lists them as date fields) directly to `itineraries` with `moderation_state` semantics living only on `media_assets`. P8 owns `itineraries.moderation_status` but defaults it to `'approved'` — so a personalized "why"/opener is **live in the feed before any review**. P3 creates the text-UGC surface but provides no pre-publish gate for it.

---

## DEAD UI / FAKE INTERACTIONS

1. **Zero screens delivered.** P3 ships RPCs + SQL + shared TS only (Self-Review admits "the React creation screens … wired in a UI-phase pass"). But the roadmap's Phase 3 *Delivers* literally says "**Create flows** for evergreen ideas and scheduled instances." Every flow this plan names (personalize, swap venue, set availability, convert, pick sound, upload photo) has **no UI, no API route, no `api-client` helper**. P4 explicitly built `packages/api-client` helpers; P3 builds none — so even the next UI phase has no typed client to call these RPCs. The deliverable is a backend contract with no consumer.

2. **Curated-sound picker is dead.** `suggestSound`/`licenseLabel` (Task 9) and `attach_library_sound` exist, but with no creation UI and no feed exposure (see Critical #3), the "pick an ambient sound, see its license" interaction has no surface. The seed `audio_url`s point at `https://cdn.tryafter5.app/sounds/*.webm` — a **CDN that does not exist** in this repo and is never provisioned; every curated sound is a 404.

3. **Upload button → nowhere.** There is no client upload flow, no call that inserts the `media_assets` row at `processing_state='uploaded'`, and no trigger/cron that *invokes* `process-media`. The function is service-role-only (`verify_jwt=false`, bearer check) and **nothing calls it**. Uploads would sit at `'uploaded'` forever. No queue runner, no Storage webhook, no `pg_cron`.

4. **`personalized_at` marker has no reader.** Sold as "used by browse/quality later," but P4's RPC and P8's view never reference it; it distinguishes nothing today and risks being a forever-orphaned column.

---

## MISSING EDGE CASES

1. **Orphaned / abandoned uploads.** A user inserts a `media_assets` row + uploads bytes, then never attaches/abandons. No TTL, no sweeper, no reconciliation between `storage.objects` and `media_assets`. Storage bloats with unmoderated UGC indefinitely. No retention policy (the roadmap calls out "data-lifecycle (media retention)" as in scope).

2. **Raw object vs `media_assets` row divergence.** Owner RLS lets a user `DELETE` their `storage.objects` (Task 1 `p3_media_owner_delete`) while the `media_assets` row persists pointing at a now-missing object — and vice versa (`media_assets` is `on delete cascade` from profiles, but deleting the row leaves the raw object). `processed_path`/`cdn_url` can reference deleted bytes.

3. **`attach_ambient_media` lets stale approval persist after re-moderation.** If P8 later flips an attached asset to `rejected`/`flagged`, `itineraries.ambient_sound_url` still holds the old `cdn_url`. Nothing re-resolves the URL on moderation change. Removed audio keeps playing.

4. **Availability staleness vs. window CHECK mismatch.** Table CHECK is `lower(window) > collected_at - interval '1 minute'` (future-at-collection). But `convert_to_scheduled` separately enforces `collected_at > now() - 14 days`. A window collected 20 days ago for a date 30 days out is structurally valid yet rejected at conversion with the opaque `no_containing_window` — the user is told "no window contains this" when the real reason is staleness. No UX path re-collects; the client guard (`canSchedule`, Task 6) has **no `stale` reason at all**, so client and server disagree.

5. **Window covers start but `time_range` overruns 14-day boundary.** `convert_to_scheduled` builds `v_range = tstzrange(starts_at, starts_at + duration)` and requires `window @> v_range` — correct. But the shared `canSchedule` checks `end <= window.upper` with `start < hi` (half-open) while the DB uses `@>` on a default `[)` range; an instance ending exactly at `window.upper` passes the client (`exceeds_window` only if `end > upper`) but `@>` on `[)` **excludes** the upper bound → DB rejects what the client accepted. Off-by-one client/server divergence on the exact-end case.

6. **No DST/timezone handling despite tstz storage.** `cities.timezone` exists; availability is collected as `tstzrange` but the plan never converts a creator's local "Friday 6–11pm" into UTC using the city tz. Spec §10 + roadmap flag DST. A creator in a DST-shifting zone will mis-state windows. `availability.ts` is UTC-naive (takes ISO strings).

7. **Multiple `date_instances` from one window.** Nothing stops a creator converting the same window into N overlapping instances (the no-overlap exclusion is on `availability_windows`, not on resulting `date_instances`). P0 only prevents the *creator* being double-locked, not double-*seeking*. A single Friday window can spawn 10 competing seeking nights.

8. **Malicious/oversized files.** Bucket `file_size_limit` + `allowed_mime_types` are declared, but MIME is client-asserted and trivially spoofed; no magic-byte sniffing, no image bomb / polyglot / SVG-script defense, no audio-codec validation. `image/heic` is allowed but nothing decodes HEIC. A 10 MiB "image" of arbitrary bytes passes Storage and reaches `process-media`, which has no real validator.

9. **`media_assets.unique(bucket_id, object_path)` + owner re-upload.** Re-uploading to the same path (`upsert`) doesn't reset `moderation_state` to `pending` — an approved asset's bytes can be swapped post-approval (moderation bypass).

10. **Conversion produces a `date_instance` but never sets `itineraries.match_status='seeking'`.** P0's itineraries carry `match_status`; spec models the evergreen idea's status. After conversion the instance is `seeking` but the parent itinerary's `match_status` stays `none`. Two status fields, no sync.

---

## STATE & DATA FLOW PROBLEMS

1. **Two parallel moderation models, never reconciled.** `media_assets.moderation_state` (P3) and `itineraries.moderation_status` (P8) are different enums on different tables with different defaults (`pending` vs `approved`). Approving a photo in `media_assets` does nothing to the itinerary's feed visibility, and hiding an itinerary in P8 doesn't touch its media. Who is the source of truth for "is this date showable"? Undefined.

2. **Unclear ownership of `ambient_sound_url`.** P0 owns the column; P3's `sync_itinerary_sound` trigger writes it from `sound_id`; `attach_ambient_media` writes it directly and **sets `sound_id=null`**; `attach_library_sound` sets `sound_id` and lets the trigger fill it. A free-form `update itineraries set ambient_sound_url=...` (still allowed by P0's owner RLS) bypasses every guard. Three writers, no single invariant.

3. **`sync_itinerary_sound` trigger fires `before insert or update OF sound_id`** but `attach_ambient_media` sets `sound_id=null` and `ambient_sound_url=<url>` in the same UPDATE — the trigger fires (sound_id changed to null), sees `new.sound_id is null`, does nothing, leaving the directly-set URL. Fragile coupling: any future code that nulls `sound_id` to "clear the sound" will leave a stale URL because the trigger only acts when `sound_id is not null`.

4. **`personalize_itinerary` uses `coalesce` so fields can never be cleared.** `why_note = coalesce(nullif(btrim(p_why_note),''), why_note)` means passing `''` is a no-op, not a clear. A creator cannot remove a "why" note or opener once set. Same for `pay_setting`, `vibe_tags`. This is a real UX dead end (can't undo).

5. **`swap_itinerary_venue` rewrites `stops[i].place_id` but the feed/cards read `places` how?** The base `itineraries.stops` is generator JSON with embedded name/photo; swapping only `place_id` leaves stale name/photo in `stops`. The plan defers "re-hydration" to "client read" — but no client code resolves `stops[].place_id → places` row. `browse_feed` joins `places` on `di.venue_id` (the instance venue), **not** on `stops[].place_id`, so a stop swap never affects the feed venue at all. The feature edits a field nothing displays.

6. **`date_instances.venue_id` vs `itinerary.stops` venue.** Conversion passes `p_venue_id` to the instance; but which stop's venue? An itinerary has multiple stops. The single `venue_id` on the instance is ambiguous vs. a multi-stop itinerary, and `swap_itinerary_venue` edits stops while conversion sets a separate instance venue. No defined relationship.

---

## BACKEND/API GAPS

1. **No invocation path for `process-media`.** No Storage trigger, no `pg_cron`, no queue table, no client call. Specced as "after a client uploads … this function." The "after" is never wired. (P2 built the job/worker layer — P3 doesn't depend on or use it.)

2. **No signed-URL endpoint** (see Critical #4). The single most important read-side API for private media is absent.

3. **`generate-plan` integration assumption is wrong about the FK.** Task 11 spreads dating fields into `insertRows`. But base `itineraries.user_id REFERENCES auth.users(id)` and `generate-plan` may insert with `user_id=null` (anonymous generation is the current product). An evergreen "first draft" with `user_id=null` can never be owned/personalized (every RPC checks `user_id=p_actor`). The conversion of anonymous generator output into an owned dating idea has **no claim/adopt step**. Who owns a generated draft?

4. **`generate-plan` writes `match_status='none'` and `is_evergreen=true`** — but `is_evergreen` default is already `true` (P0) and the generator historically sets `is_public`. No handling of the interaction between `is_public` (SEO library) and `is_evergreen` dating drafts — a generated public itinerary is now also a dating object with `pay_setting=null`; does it leak into any dating surface? Undefined.

5. **`media_assets` self-approval guard is brittle.** The guard raises when `auth.uid() is not null` and state moves to `approved`/`flagged`. But P8's moderator RPCs are SECURITY DEFINER and run as the admin's session where **`auth.uid()` IS the admin's uid (non-null)** — so the guard will **block legitimate moderator approval** unless P8 uses the service-role key (which Edge Functions do, but in-DB RPC moderation does not). P8 Task 7 moderator RPCs are DB functions; this guard likely breaks them. Cross-phase contradiction.

6. **No RLS for reading `media_assets` by moderators.** Policy is `owner_id = auth.uid()` only. P8's moderation console must read pending assets across all users; there is no admin/service-role read policy here (P3 says "service-role" but P8 may use authed admin sessions). The P8 queue (the `media_assets_moderation_idx`) is unreadable by the very console meant to consume it under normal RLS.

7. **`browse_feed` GRANT to `anon`** — P3 re-grants `select on browse_feed to anon, authenticated`. With P3's view dropping the moderation filter, anonymous users see hidden UGC. Even ignoring that, P4 already decided anon "gets nothing from the personalized feed" — the raw view grant to anon is an inconsistent privacy posture vs P4's RPC-only model.

---

## UX CONTRADICTIONS

1. **"AI sets the floor, human sets the ceiling" vs. no editing UI.** The plan's headline personalization story has no screen, so the human can set nothing.

2. **Private buckets (Task 1) vs. "public curated CDN path" (Task 2 seed).** Sounds seed points at a public CDN; uploaded UGC is private-bucket; the plan conflates "curated public" and "UGC private" but `process-media` writes both to the same private buckets and mints a `cdn_url` the same way — the curated/UGC distinction isn't structurally enforced at serve time.

3. **"Re-collect availability so 'liked the idea but not that time' can't happen"** — but the only reason codes surfaced to the user are `no_containing_window`/`no_availability`. There is no UI prompt that says "set new availability"; the contradiction the feature exists to solve is restated as an error, not a flow.

4. **Spec §10: ambient autoplay effectively requires native; web is muted.** P3 invests heavily in the ambient-sound library and licensing display, but on the only shipping client (web) the sound won't autoplay and (per Critical #3) the title/license never render. The licensing-display effort targets a surface that doesn't exist and a medium that's muted.

5. **`duration_sec between 5 and 600` on `sounds` but `clampAudioDuration` caps UGC at 60s.** Curated sounds may be 10 minutes; UGC is clamped to 60s; the feed loops "ambient" — no defined loop/seamlessness behavior, and a 600s curated clip vs 60s UGC clip are treated identically by the player (which doesn't exist).

---

## WHAT ENGINEERS WILL REGRET LATER

1. **Four uncoordinated `browse_feed` redefinitions** (P0, P4, P8, P3). Every phase that touches the feed `create or replace`s the whole view, and ordering bugs (like this one) will recur. This needs a **single owner** (likely P4, the feed phase) and additive-only column discipline, or a feed *function* whose signature is the contract. Regret is guaranteed the next time anyone adds a feed column.

2. **Signed-URL-in-a-column.** Storing a time-limited signed URL in `cdn_url`/`ambient_sound_url` will produce intermittent "audio won't load" bugs in production that are maddening to reproduce (works for 60s after generation). Resolve to a per-request signing or genuinely public CDN now.

3. **No HEIC/codec strategy.** Allowing `image/heic` with no decoder means iPhone uploads (the default format) silently fail downstream. This will look like "uploads randomly don't work" to users.

4. **`coalesce`-only personalization** makes "clear this field" impossible and will require an API redesign (sentinel values or separate clear endpoints) once users complain.

5. **`stops[].place_id` rewrite with no re-hydration contract** will rot: stale embedded names/photos drift from `places`, and nobody will remember the feed reads `venue_id` not `stops`.

6. **Two moderation tables** (`media_assets` + `itineraries.moderation_status`) with no join logic will make "why is this hidden date still playing audio?" an unanswerable support ticket.

---

## REQUIRED ADDITIONAL SCREENS / COMPONENTS

- **Personalize-idea screen** (vibe, why-note, opener, pay setting, venue swap picker over vetted `places`) + `api-client` helpers for `personalize_itinerary` / `swap_itinerary_venue`.
- **Convert-to-scheduled flow** with an **availability re-collection step** (calendar/window picker) that calls `set_availability` then `convert_to_scheduled`, surfacing `stale`/`no_window`/`outside_window` as *actionable prompts*, not raw errors.
- **Media upload component** (pick → insert `media_assets` `uploaded` → upload bytes → trigger/await `process-media` → show pending state) + the **invocation wiring** (Storage webhook or `pg_cron` or P2 job).
- **Signed-URL serving endpoint/RPC** (`get_media_signed_url`) — the missing read side.
- **Ambient-sound picker** (uses `suggestSound`/`licenseLabel`) with audible preview + license caption.
- **"Adopt this draft" / claim step** for anonymous generator output (set `user_id`) before it can be personalized.
- **Owned-ideas / drafts dashboard** (where do a creator's evergreen ideas and scheduled instances live? No surface lists them).
- **Orphaned-upload sweeper job** + media retention policy.
- **`browse_feed_for_viewer` RPC amendment** to project `sound_title`/`sound_license`/`opener` if licensing is truly required on cards (decide with P4).

## PRODUCTION READINESS SCORE

**31 / 100.** The SQL building blocks (sounds, media_assets, availability_windows, conversion RPC) are individually well-formed and TDD-tested in isolation, which is genuine value. But the plan **breaks the build** (Task 14 view replace is invalid SQL), **silently regresses two sibling phases** (P4 `is_seed`, P8 moderation filter), ships a **media pipeline that cannot serve or transcode media**, and delivers **no client surface** for any of the named creation flows — so the roadmap's Phase 3 "create flows" deliverable is unmet. It is not executable end-to-end as written.

## PRIORITY FIX ORDER

1. **Fix the `browse_feed` ownership/collision (BLOCKER, also a safety regression).** Do NOT let P3 redefine the view. Either: append-only on top of P8's version *preserving* `moderation_status` filter AND `is_seed`, or move all feed-card fields into P4's `browse_feed_for_viewer` RPC (the real read path) and make P3 not touch the view at all. Verify `db reset` applies and hidden UGC stays hidden.
2. **Make the media pipeline actually serve + process media.** Decide public-CDN vs per-request signed URL and build the signing endpoint; replace the fictional "Supabase image transform" transcode with a real one (ffmpeg/WASM or an external transform service) or descope audio UGC to library-only for launch (roadmap permits "library-only audio"). Wire an invocation path for `process-media`.
3. **Add the missing client surface + anonymous-draft ownership.** Build `api-client` helpers and the personalize/convert/upload/availability-recollection screens; define how anonymous generator drafts (`user_id=null`) get claimed before personalization. Without this, Phase 3's deliverable does not exist.
4. Reconcile the two moderation models (media_assets vs itineraries.moderation_status) and fix the self-approval guard so P8's authed-admin RPCs aren't blocked.
5. Fix client/server conversion divergence (staleness reason, half-open boundary), DST/timezone handling, coalesce-clear, and re-resolution of `ambient_sound_url` on re-moderation.
6. Add orphaned-upload retention/sweeper, magic-byte validation, re-upload-resets-moderation, and HEIC decode strategy.

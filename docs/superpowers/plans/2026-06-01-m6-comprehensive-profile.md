# Workstream M6 — Comprehensive, customizable dating profile (implementation plan)

Date: 2026-06-01 · Prod ref: `ufufmcpnysvwtutpbian` · Design: `docs/superpowers/DESIGN-SYSTEM.md`

## Goal

Make the dating profile the product's strongest pillar: a comprehensive, low-friction, **customizable** profile a user builds and a matched user *enjoys reading*. FW2 shipped basic editing (bio, vibe_tags, instagram, single photo). M6 adds **multiple ordered photos**, **Hinge-style prompts**, a **few brand-fit expanded fields**, a **sectioned editor**, and a **polished read-only profile view** on the reveal surfaces — all under the existing blind-safe RLS tiers.

## Architecture (and current state)

### Current state (audited 2026-06-01 — real code + prod schema)

- **Editor today** — `apps/web/app/account/profile/page.tsx` + `ProfileEditor.tsx`. Edits `first_name`, `neighborhood`, `vibe_tags`, `clear_photo_url` (on `profiles`) and `bio`, `instagram_handle` (on `profiles_private`). Single photo: replace only, no add/remove/reorder. `prompts: []` is passed to `ProfileInputSchema` but never collected — **prompts are dead UI-side**.
- **Photo storage** — bucket `profile-photos` (PRIVATE), one object per user: `<uid>/clear.jpg` (uploaded by onboarding `PhotoStep` / editor) and `<uid>/blurred.jpg` (written by the `generate-blur` edge fn, which also sets `profiles.blurred_photo_url = '<uid>/blurred.jpg'`). RLS: `profile_photos_owner_write` (all ops, owner folder) + `profile_photos_blurred_read` (any authed user may SELECT `*blurred.jpg`). Editor previews via a 10-min `createSignedUrl`.
- **`profiles` dating columns (prod-confirmed):** `primary_city_id`, `dating_enabled`, `age`, `vibe_tags text[]`, `age_pref int4range`, `gender text`, `gender_preferences text[]`, `distance_pref_km`, `blurred_photo_url`, `clear_photo_url`, `reliability_score`, `verification`, `standing`, `account_state`, `rollover_frozen`, `dealbreakers text[]`, **`prompt_answers jsonb default '[]'`**, `onboarding_step`, `onboarding_completed_at`. `profiles_private`: `full_name, phone, birthdate, bio, instagram_handle, emergency_contact` (column-level write grants; birthdate non-self-settable).
- **Prompts table** — `profile_prompts` EXISTS and is seeded on prod with 5 prompts (`two_truths`, `my_ideal_first_date`, `unusual_skill`, `best_kelowna_spot`, `a_perfect_sunday`). RLS: public read of `is_active`. `prompt_answers` is jsonb `[{prompt_id, answer}]`. **No UI reads or writes it today.**
- **Reveal surfaces** — `apps/web/app/matches/[lockId]/page.tsx` selects `first_name, age, city, neighborhood, clear_photo_url, vibe_tags` from `profiles` via FK embeds (RLS `profiles_select_revealed`, gated by `match_reveal_allowed_pair`). `LockDetail.tsx` + `RevealModal.tsx` render name/age/place/vibe_tags. `InterestedList.tsx` (host queue) shows Tier-3 only.
- **THE BIGGEST GAP / BUG:** **`clear_photo_url` is never written by any code path** (onboarding sets only `blurred_photo_url`; the clear object lives at `<uid>/clear.jpg` but the column stays NULL). And even if set, it would hold a **storage path in a PRIVATE bucket**, which `RevealModal`/`LockDetail` pass straight to `<Polaroid src=...>` (`next/image`) — so the reveal photo is effectively **broken**: a matched user sees the gradient fallback, never the real face. `profile_photos_blurred_read` only covers `*blurred.jpg`; there is **no read policy for clear photos** and **no signed-URL plumbing** on the reveal path. M6 must fix the reveal photo end-to-end.

### Target architecture

1. **`profile_photos` table** (new) — one row per photo, owner-scoped, ordered. Replaces the single-object convention with `<uid>/<photo_id>.jpg` clear objects + per-photo `<uid>/<photo_id>_blurred.jpg`. Keep `profiles.blurred_photo_url`/`clear_photo_url` as a **denormalized "primary photo" mirror** so the existing feed/queue/reveal selects keep working (no big rewrite); the table is the source of truth for the gallery and ordering.
2. **Prompts** — reuse existing `profile_prompts` + `prompt_answers jsonb`. Add UI: editor section + view rendering. Expand the curated prompt set toward the brand voice (DESIGN-SYSTEM §8) via a seed migration; keep ids stable.
3. **Expanded fields** — add a small, brand-fit set: `height_cm int` (optional), `occupation text` (optional), `socials jsonb` (spotify/tiktok handles, optional). Reuse existing `gender`/`pronouns`. Add `pronouns text`. Keep it anti-Tinder: NO religion/politics/ethnicity asks. All optional.
4. **Reveal read path** — a server helper `signProfilePhotos()` that turns clear-photo storage paths into short-lived signed URLs (the reveal pages run on the server with the viewer's RLS'd client; reads are gated by a new `profile_photos_revealed_read` storage policy that mirrors `match_reveal_allowed_pair`). New `ProfileCard` read-only component (carousel + prompts + vibe) used in `RevealModal`.
5. **Validators** — extend `packages/validators/src/profile.ts` (prompts, new fields, photo metadata) — single source of truth for editor + onboarding.

### Tech stack

Next.js 15 (App Router, RSC + thin client) · Supabase (RLS, storage, edge fn `generate-blur`) · `framer-motion` `Reorder` (photo drag, reuse `InterestedList` pattern) · `vaul` (sheets) · `sonner` (toasts) · `embla-carousel-react` **or** a native scroll-snap carousel (decide in Task 8 — prefer scroll-snap, no new dep) · Tailwind semantic tokens (Tier-1 `shell.*` editor chrome, Tier-3 neutral `profile.*` for the view) · zod validators · Vitest/jsdom + RTL.

### Prod-schema-drift checks (run BEFORE any DDL)

The columns/tables this plan touches were verified on prod 2026-06-01 (`profile_prompts` seeded; `prompt_answers/dealbreakers/clear_photo_url` present). Still, before applying each migration:

```bash
# from repo root, with Supabase MCP / psql against prod ref ufufmcpnysvwtutpbian
# 1. confirm profile_photos does NOT already exist (drift guard)
#    select to_regclass('public.profile_photos');                 -- expect NULL
# 2. confirm new profiles columns are absent before adding
#    select column_name from information_schema.columns
#     where table_schema='public' and table_name='profiles'
#       and column_name in ('pronouns','height_cm','occupation','socials');
# 3. after EVERY DDL: run the security advisor
#    mcp__supabase__get_advisors { type: 'security' }
```

All new migrations are **secure-by-default**: owner-scoped writes only, never `using(true)` on insert/update/delete, advisor clean after each. New profile/photo migrations are gated behind the existing `match_v2_enabled` flag at the UI layer (DB objects are inert until read).

---

## Conventions for every task

- TDD: write the failing test, run it (see it fail), minimal impl, run it (green), commit.
- Web tests: `cd apps/web && pnpm vitest run <path>` (jsdom). Validators: `cd packages/validators && pnpm vitest run`.
- Lint/types before each commit: `cd apps/web && pnpm tsc --noEmit && pnpm lint`.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```
- Branch first (repo is not on a feature branch for this work): `git checkout -b m6-comprehensive-profile`.
- Migrations are **created locally and NOT applied to prod** during build. A final batched prod-apply task (Task 14) applies them in order after local-green + advisor-clean, per the secure-by-default workflow.

---

## Task 1 — Validators: prompts, expanded fields, photo metadata

**Files**
- Modify `packages/validators/src/profile.ts`
- Modify `packages/validators/src/__tests__/profile.test.ts`

**Steps**

1. Add a failing test in `profile.test.ts`:
   ```ts
   import { describe, it, expect } from 'vitest';
   import {
     ProfileInputSchema, PromptAnswerSchema, PROMPT_IDS,
     PronounsSchema, ExpandedProfileSchema, PhotoMetaSchema, MAX_PHOTOS,
   } from '../profile';

   describe('M6 expanded profile', () => {
     it('accepts up to 3 prompt answers and rejects 4', () => {
       const a = { prompt_id: PROMPT_IDS[0], answer: 'hi' };
       expect(ProfileInputSchema.safeParse({ first_name: 'a', prompts: [a, a, a] }).success).toBe(true);
       expect(ProfileInputSchema.safeParse({ first_name: 'a', prompts: [a, a, a, a] }).success).toBe(false);
     });
     it('validates pronouns and optional expanded fields', () => {
       expect(PronounsSchema.safeParse('she/her').success).toBe(true);
       const ok = ExpandedProfileSchema.safeParse({ height_cm: 170, occupation: 'barista', socials: { spotify: 'x' } });
       expect(ok.success).toBe(true);
       expect(ExpandedProfileSchema.safeParse({ height_cm: 400 }).success).toBe(false);
     });
     it('caps the gallery at MAX_PHOTOS and validates a photo row', () => {
       expect(MAX_PHOTOS).toBe(6);
       const p = PhotoMetaSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111', sort_order: 0, is_primary: true });
       expect(p.success).toBe(true);
     });
   });
   ```
2. Run (fails — symbols missing): `cd packages/validators && pnpm vitest run src/__tests__/profile.test.ts`
3. Minimal impl in `profile.ts`:
   ```ts
   export const MAX_PHOTOS = 6;

   export const PronounsSchema = z.enum([
     'she/her', 'he/him', 'they/them', 'she/they', 'he/they', 'ask me',
   ]);
   export type Pronouns = z.infer<typeof PronounsSchema>;

   // Brand-fit, anti-Tinder: all optional, nothing identity-sensitive.
   export const ExpandedProfileSchema = z.object({
     pronouns: PronounsSchema.optional(),
     height_cm: z.number().int().min(120).max(230).optional(),
     occupation: z.string().max(60).optional(),
     socials: z.object({
       spotify: z.string().max(60).optional(),
       tiktok: z.string().max(60).optional(),
     }).strict().partial().optional(),
   });
   export type ExpandedProfile = z.infer<typeof ExpandedProfileSchema>;

   export const PhotoMetaSchema = z.object({
     id: z.string().uuid(),
     sort_order: z.number().int().min(0).max(MAX_PHOTOS - 1),
     is_primary: z.boolean(),
   });
   export type PhotoMeta = z.infer<typeof PhotoMetaSchema>;
   ```
   Keep `ProfileInputSchema.prompts` as is (already `max(3)`).
4. Run (green): `cd packages/validators && pnpm vitest run src/__tests__/profile.test.ts`
5. Commit: `feat(m6): validators for prompts, pronouns, expanded fields, photo metadata`

---

## Task 2 — Expand the curated prompt set (seed migration)

**Files**
- Create `supabase/migrations/20260601130000_m6_profile_prompts_expand.sql`

**Steps**

1. **Drift check** (Prod checks §, query 1 isn't relevant; verify prompt ids):
   ```
   select id from profile_prompts;   -- expect the 5 seeded ids, no M6 ids yet
   ```
2. Write the migration (additive, idempotent — brand voice per DESIGN-SYSTEM §8, no Kelowna hardcoding so retire `best_kelowna_spot` by deactivating, keep id for existing answers):
   ```sql
   -- 20260601130000_m6_profile_prompts_expand.sql
   -- M6: broaden the curated prompt set toward the Gen-Z brand voice (DESIGN-SYSTEM §8)
   -- and drop the Kelowna-hardcoded prompt (product is multi-city). Additive + idempotent;
   -- existing prompt_answers referencing retired ids still render (the answer text is stored
   -- on profiles.prompt_answers, the label is looked up best-effort).
   update profile_prompts set is_active = false where id = 'best_kelowna_spot';

   insert into profile_prompts (id, label, placeholder, sort_order) values
     ('green_flag',        'green flag energy',              'what wins me over…',          4),
     ('the_ick',           'the ick i''d die on',            'be honest…',                  6),
     ('roman_empire',      'my roman empire',                'the thing i think about daily…', 7),
     ('we_vibe_when',      'i''ll know we vibe when…',        'finish it…',                  8),
     ('weekend_plan',      'a perfect day off looks like',   'paint the picture…',          9),
     ('chronically_online','most chronically online thing about me', 'no judgement…',       10)
   on conflict (id) do nothing;
   ```
3. Apply locally + assert: `supabase db reset` (or `supabase migration up`) then
   ```
   select count(*) from profile_prompts where is_active;   -- expect 10
   ```
4. Commit: `feat(m6): expand curated profile prompts, retire Kelowna-hardcoded one`

Note: `PROMPT_IDS` in validators is intentionally NOT widened here to keep `PromptAnswerSchema` permissive of any active prompt — instead Task 7 validates `prompt_id` against the prompts loaded from the DB. (If strict enum is preferred, widen `PROMPT_IDS` in Task 1; flagged as an open question below.)

---

## Task 3 — `profile_photos` table + RLS (owner CRUD)

**Files**
- Create `supabase/migrations/20260601130100_m6_profile_photos_table.sql`

**Steps**

1. **Drift check:** `select to_regclass('public.profile_photos');` → expect NULL.
2. Migration:
   ```sql
   -- 20260601130100_m6_profile_photos_table.sql
   -- M6: ordered multi-photo gallery. One row per photo; storage objects live at
   -- profile-photos/<uid>/<id>.jpg (clear) and <uid>/<id>_blurred.jpg (blind feed).
   -- profiles.clear_photo_url / blurred_photo_url remain a denormalized mirror of the
   -- PRIMARY photo so existing feed/queue/reveal selects keep working unchanged.
   create table if not exists profile_photos (
     id          uuid primary key default gen_random_uuid(),
     user_id     uuid not null references profiles(id) on delete cascade,
     clear_path  text not null,            -- '<uid>/<id>.jpg'
     blurred_path text,                    -- '<uid>/<id>_blurred.jpg' (set by generate-blur)
     sort_order  int not null default 0,
     is_primary  boolean not null default false,
     created_at  timestamptz not null default now()
   );
   create index if not exists profile_photos_user_order_idx
     on profile_photos (user_id, sort_order);
   -- At most one primary per user.
   create unique index if not exists profile_photos_one_primary_idx
     on profile_photos (user_id) where is_primary;

   alter table profile_photos enable row level security;

   -- Owner full CRUD on own rows (never using(true) on writes).
   do $$ begin
     create policy profile_photos_owner_all on profile_photos for all
       using (user_id = auth.uid()) with check (user_id = auth.uid());
   exception when duplicate_object then null; end $$;

   -- Reveal read: a counterparty in an active offer / lock may SELECT the gallery rows
   -- (clear paths) of someone they're revealed to. Mirrors profiles_select_revealed.
   do $$ begin
     create policy profile_photos_revealed_read on profile_photos for select
       to authenticated
       using (user_id = auth.uid() or match_reveal_allowed_pair(auth.uid(), user_id));
   exception when duplicate_object then null; end $$;
   ```
3. Apply locally (`supabase db reset`), then **advisor**: `mcp__supabase__get_advisors { type: 'security' }` — expect no new WARN on `profile_photos` (RLS enabled, no `using(true)` write).
4. Quick assert no anon read: as anon, `select * from profile_photos` returns 0 rows.
5. Commit: `feat(m6): profile_photos table + owner/revealed RLS`

---

## Task 4 — Storage policies: clear-photo reveal read + per-photo blurred read

**Files**
- Create `supabase/migrations/20260601130200_m6_profile_photos_storage.sql`

**Steps**

1. Migration — extend `storage.objects` policies. Owner-write already covered by the existing `profile_photos_owner_write` (folder = uid). Add: any-authed read of `*_blurred.jpg` (per-photo blurred for the feed), and **reveal-gated read of clear objects** via the table's path mapping:
   ```sql
   -- 20260601130200_m6_profile_photos_storage.sql
   -- M6 storage reads. Existing profile_photos_owner_write (all ops, owner folder) and
   -- profile_photos_blurred_read (right(name,11)='blurred.jpg') stay. Add:
   --   (a) per-photo blurred read for the blind feed (names end '_blurred.jpg'),
   --   (b) reveal-gated clear read: a viewer may read <owner>/<id>.jpg iff there is a
   --       profile_photos row with that clear_path whose owner is reveal-allowed to them.
   do $$ begin
     create policy profile_photos_blurred_read_v2 on storage.objects for select
       using (
         bucket_id = 'profile-photos'
         and right(name, 12) = '_blurred.jpg'
         and auth.role() = 'authenticated'
       );
   exception when duplicate_object then null; end $$;

   do $$ begin
     create policy profile_photos_clear_reveal_read on storage.objects for select
       to authenticated
       using (
         bucket_id = 'profile-photos'
         and exists (
           select 1 from public.profile_photos pp
           where pp.clear_path = storage.objects.name
             and (pp.user_id = auth.uid() or public.match_reveal_allowed_pair(auth.uid(), pp.user_id))
         )
       );
   exception when duplicate_object then null; end $$;
   ```
2. Apply locally + **advisor** (expect clean — both policies are SELECT, reveal-gated or authed, no `using(true)`).
3. Commit: `feat(m6): storage read policies for per-photo blurred + reveal-gated clear`

Note: signed URLs generated by the *owner's or viewer's* RLS'd server client honour these policies (Supabase storage signing checks the requester's grants), so the reveal page can mint signed clear URLs only when the policy passes.

---

## Task 5 — `generate-blur` edge fn: per-photo blur + backfill primary mirror

**Files**
- Modify `supabase/functions/generate-blur/index.ts`
- Modify `supabase/functions/generate-blur/index_test.ts`

**Steps**

1. Failing unit test for the new path-derivation pure helper. Add to `index_test.ts`:
   ```ts
   import { blurredPathFor } from './index.ts';
   Deno.test('blurredPathFor maps clear -> _blurred', () => {
     assertEquals(blurredPathFor('abc/9e/clear.jpg'.replace('9e/clear','9e')), 'abc/9e_blurred.jpg');
     assertEquals(blurredPathFor('uid/photoid.jpg'), 'uid/photoid_blurred.jpg');
   });
   ```
   (Import `assertEquals` already used in file.)
2. Run (fails): `cd supabase/functions/generate-blur && deno test index_test.ts`
3. Impl: export `blurredPathFor(clearPath: string)` (`x.jpg → x_blurred.jpg`). Change the handler to accept an optional `{ clear_path }` body. When provided, blur THAT object → write `blurredPathFor(clear_path)`, and update the matching `profile_photos.blurred_path`; if that row `is_primary`, also mirror to `profiles.blurred_photo_url` / `clear_photo_url`. When body is empty, keep the legacy `<uid>/clear.jpg` behaviour (back-compat for any un-migrated client) but ALSO set `profiles.clear_photo_url='<uid>/clear.jpg'` (this alone closes the "clear_photo_url never written" bug).
4. Run (green): `deno test index_test.ts`
5. Commit: `fix(m6): generate-blur supports per-photo paths + writes clear_photo_url mirror`

---

## Task 6 — Client photo helpers (upload, list, reorder, set-primary, delete)

**Files**
- Create `apps/web/lib/after5/photos.ts`
- Create `apps/web/lib/after5/__tests__/photos.test.ts`

**Steps**

1. Failing test (jsdom; mock the After5 client). Assert `nextSortOrder([])===0`, `nextSortOrder([{sort_order:0},{sort_order:2}])===3`, and that `reorderPhotos` produces `[{id,sort_order}]` pairs from a dragged array.
   ```ts
   import { describe, it, expect } from 'vitest';
   import { nextSortOrder, toReorderPayload } from '../photos';
   describe('photos helpers', () => {
     it('computes next sort order', () => {
       expect(nextSortOrder([])).toBe(0);
       expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 2 }] as never)).toBe(3);
     });
     it('builds reorder payload from a dragged list', () => {
       expect(toReorderPayload([{ id: 'a' }, { id: 'b' }] as never))
         .toEqual([{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }]);
     });
   });
   ```
2. Run (fails): `cd apps/web && pnpm vitest run lib/after5/__tests__/photos.test.ts`
3. Impl `photos.ts`:
   - `nextSortOrder(rows)` / `toReorderPayload(rows)` pure helpers (tested).
   - `listMyPhotos(client, userId)` → select from `profile_photos` ordered by `sort_order`.
   - `addPhoto(client, userId, blob)` → `id = crypto.randomUUID()`; upload `${userId}/${id}.jpg`; insert `profile_photos` row (`clear_path`, `sort_order = nextSortOrder`, `is_primary = rows.length===0`); invoke `generate-blur` with `{ clear_path }`.
   - `reorderPhotos(client, payload)` → loop `update sort_order` per changed row (mirror `InterestedList.persistOrder` shape).
   - `setPrimary(client, userId, id)` → clear all `is_primary`, set one true; re-invoke `generate-blur` with that row's `clear_path` so the `profiles` mirror updates.
   - `removePhoto(client, userId, photo)` → delete storage objects (`clear_path`, `blurred_path`) then delete row; if it was primary, promote the new lowest `sort_order` (set primary + re-blur).
   - `signClearUrls(serverClient, paths, ttl=600)` → `createSignedUrls` for the carousel/view.
4. Run (green). 5. Commit: `feat(m6): client helpers for multi-photo CRUD + reorder + signing`

---

## Task 7 — Editor sections: prompts + expanded fields (logic + validation)

**Files**
- Create `apps/web/app/account/profile/sections/PromptsSection.tsx`
- Create `apps/web/app/account/profile/sections/ExpandedSection.tsx`
- Create `apps/web/app/account/profile/sections/__tests__/PromptsSection.test.tsx`

**Steps**

1. Failing RTL test for `PromptsSection`: renders the active prompts as a picker; choosing a prompt + typing an answer calls `onChange` with `[{prompt_id, answer}]`; enforces max 3 selected; answer `maxLength=200`.
2. Run (fails): `cd apps/web && pnpm vitest run app/account/profile/sections/__tests__/PromptsSection.test.tsx`
3. Impl both sections (Tier-1 `shell.*` chrome, `font-body`, lowercase labels, ≥44px targets, all six states; copy dry per DESIGN-SYSTEM §3). `PromptsSection` takes `prompts: {id,label,placeholder}[]` (from DB), `value: PromptAnswer[]`, `onChange`. `ExpandedSection` renders pronouns (segmented pills), optional height (cm/ft toggle, store cm), occupation, spotify/tiktok handles — validates via `ExpandedProfileSchema`.
4. Run (green). 5. Commit: `feat(m6): prompts + expanded-fields editor sections`

---

## Task 8 — Photo manager with framer-motion Reorder

**Files**
- Create `apps/web/app/account/profile/sections/PhotoManager.tsx`
- Create `apps/web/app/account/profile/sections/__tests__/PhotoManager.test.tsx`

**Steps**

1. Failing RTL test: given 3 photos, renders 3 tiles + an "add" affordance; primary tile shows a "main" badge; remove button calls `onRemove(id)`; reduced-motion path renders without crashing (mock `useReducedMotion`).
2. Run (fails).
3. Impl — reuse the `Reorder.Group`/`Reorder.Item` + optimistic-persist pattern from `apps/web/app/dates/[slug]/interested/InterestedList.tsx` (drag handle `GripVertical`, `useReducedMotion`, optimistic `setRows` + rollback toast). Each tile: signed clear thumbnail (`next/image`), drag handle, "set main" + remove. "add a photo" reuses `PhotoCropper` from `apps/web/app/onboarding/steps/PhotoCropper.tsx`; on confirm → `addPhoto`. Cap at `MAX_PHOTOS` (6). On reorder → `reorderPhotos`. Empty state copy: dry.
4. Run (green). 5. Commit: `feat(m6): drag-to-reorder photo manager (reuses InterestedList Reorder pattern)`

---

## Task 9 — Assemble the sectioned editor

**Files**
- Modify `apps/web/app/account/profile/ProfileEditor.tsx`
- Modify `apps/web/app/account/profile/page.tsx`
- Modify (if present) `apps/web/app/account/profile/__tests__/ProfileEditor.test.tsx` (else create)

**Steps**

1. Failing test: editor renders four labelled sections — "photos", "the basics" (name/bio/neighborhood/vibe/instagram), "prompts", "more about you" — and `save` writes prompts to `profiles.prompt_answers` + expanded fields. Mock the client; assert the `update` patch includes `prompt_answers` and `pronouns`.
2. Run (fails).
3. Impl — keep the existing basics/instagram/bio blocks; mount `<PhotoManager>`, `<PromptsSection>`, `<ExpandedSection>` as collapsible sections (Tier-1, `max-w-[420px]`). Hydrate `page.tsx` with: `profile_photos` list + signed clear URLs, `prompt_answers`, expanded columns, and the active `profile_prompts`. `handleSave` now also `upsertProfile(... { prompt_answers, pronouns, height_cm, occupation, socials })` (validated). Keep the single-photo legacy block only if no `profile_photos` rows exist (migration grace), else PhotoManager owns photos.
4. Run (green) + `pnpm tsc --noEmit && pnpm lint`. 5. Commit: `feat(m6): comprehensive sectioned profile editor`

---

## Task 10 — Read-only `ProfileCard` (carousel + prompts + vibe)

**Files**
- Create `apps/web/components/ProfileCard.tsx`
- Create `apps/web/components/__tests__/ProfileCard.test.tsx`

**Steps**

1. Failing RTL test: given `{ name, age, place, photos:[signed urls], vibe_tags, prompts:[{label,answer}], pronouns }`, renders a heading `name, age`, a photo carousel (multiple `img`s with `alt`), each prompt label + answer, and vibe chips. Single photo → no carousel controls. No photos → Polaroid gradient fallback. **No PII** (`email`, `instagram_handle` only when explicitly passed post-reveal).
2. Run (fails).
3. Impl — Tier-3 neutral surface (`profile.*`/off-white, near-black, subtle tags per DESIGN-SYSTEM §1/§8), mobile-first. Carousel = native scroll-snap (`snap-x snap-mandatory`, dots) — no new dependency — or `embla-carousel-react` if dots/keyboard nav need it (decide here; prefer scroll-snap). Photos rendered via `next/image` with `alt={name}`; first/primary photo via `Polaroid tone="dating"` for the brand motif, rest in the strip. Prompts as labelled cards; vibe chips as sticker chips (`stickerRotation`). a11y: heading hierarchy, alt text, focusable carousel.
4. Run (green). 5. Commit: `feat(m6): read-only Tier-3 ProfileCard with photo carousel + prompts`

---

## Task 11 — Wire `ProfileCard` into the reveal surface (fixes the broken photo)

**Files**
- Modify `apps/web/app/matches/[lockId]/page.tsx`
- Modify `apps/web/app/matches/[lockId]/RevealModal.tsx`
- Modify `apps/web/app/matches/lock-view.ts`
- Modify `apps/web/app/matches/[lockId]/__tests__/RevealModal.test.tsx`

**Steps**

1. Failing test: `RevealModal` given a `person` with `photos: [url1,url2]` + `prompts` renders the carousel + prompts (currently it renders neither). Assert two photo `img`s and a prompt answer appear.
2. Run (fails).
3. Impl:
   - `page.tsx`: after fetching the counterpart, also fetch `profile_photos` for `counterpart.id` (RLS `profile_photos_revealed_read` passes for the locked pair), `signClearUrls` them, and read `counterpart.prompt_answers` + `pronouns` (add to the embedded select). Pass a `photos: string[]` (signed, primary first) and `prompts: {label,answer}[]` (join answer ids to active `profile_prompts` labels server-side) into `LockDetail` → `RevealModal`.
   - `RevealModal.tsx`: render `<ProfileCard ... />` instead of the inline Polaroid+name block.
   - `lock-view.ts`: extend `PartyProfile` with `prompt_answers` + `pronouns` (keep `clear_photo_url` for the small header thumbnail — now actually signed in page.tsx).
   - Fix the header thumbnail in `LockDetail`/`InterestedList` to use a **signed** primary URL, not the raw private path (the long-standing bug).
4. Run (green) + `pnpm tsc --noEmit && pnpm lint`. 5. Commit: `fix(m6): reveal surface shows real signed photos + prompts via ProfileCard`

---

## Task 12 — Onboarding photo step: allow up to N photos (optional, low-risk)

**Files**
- Modify `apps/web/app/onboarding/steps/PhotoStep.tsx`
- Modify `apps/web/app/onboarding/steps/__tests__/PhotoStep.test.tsx`

**Steps**

1. Failing test: after uploading one photo, an "add another" affordance appears (up to `MAX_PHOTOS`), and "next" requires ≥1 photo.
2. Run (fails).
3. Impl — route uploads through `addPhoto` (Task 6) so onboarding seeds `profile_photos` (first = primary) instead of the single `clear.jpg` convention. Keep ≥1 required to advance.
4. Run (green). 5. Commit: `feat(m6): onboarding supports multiple photos via profile_photos`

---

## Task 13 — Types regen + full local verification

**Files**
- Modify `packages/types/src/database.ts` (regenerated)

**Steps**

1. Regenerate types against the **local** DB (post-migrations): `supabase gen types typescript --local > packages/types/src/database.ts` (or `mcp__supabase__generate_typescript_types` against a local branch). Confirm `profile_photos` + new `profiles` columns appear.
2. Full suite: `cd apps/web && pnpm vitest run && pnpm tsc --noEmit && pnpm lint`; `cd packages/validators && pnpm vitest run`; `deno test supabase/functions/generate-blur/index_test.ts`.
3. Commit: `chore(m6): regen DB types; full local green`

---

## Task 14 — Batched prod-apply + advisor + smoke (gated)

**Steps (operational — no new code)**

1. **Re-run drift checks** (Prod §) against `ufufmcpnysvwtutpbian` immediately before applying.
2. Apply migrations **in order** via `mcp__supabase__apply_migration` (one call per file):
   `20260601130000_m6_profile_prompts_expand`, `..130100_m6_profile_photos_table`, `..130200_m6_profile_photos_storage`.
3. Deploy edge fn: `mcp__supabase__deploy_edge_function generate-blur`.
4. **Advisor:** `mcp__supabase__get_advisors { type: 'security' }` — must be clean (no new `using(true)` / RLS-disabled / anon-executable findings on the new objects).
5. Authed prod smoke (QA acct, Playwright recipe from memory `reference_local-qa-browser-login`): add 3 photos → reorder → set primary → answer 2 prompts → save; verify a reveal (R2-style cohort) shows the carousel + prompts + real face for the matched user only; confirm an unrelated authed user gets 0 `profile_photos` rows and a 403 on the clear object.
6. Report PASS/FAIL per step; do not flip any flag (UI already gated by `match_v2_enabled`).

---

## Out of scope (capture, not build)

Voice-note bios, Spotify OAuth top-track, MBTI/star-sign pills (DESIGN-SYSTEM §8 "opt-in" — defer), profile completeness meter, photo moderation/NSFW scan, EXIF stripping beyond the resize round-trip, per-photo captions. `expectations[]` on date_instances is a separate workstream.

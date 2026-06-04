# Phase 5: Progressive Reveal (P2) - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 12 (2 SQL migrations, 1 lib, 1 api-client, 8 UI surfaces)
**Analogs found:** 12 / 12 (every surface has an in-repo analog — this phase is wiring, not greenfield)

> Built on top of `05-RESEARCH.md` (which already carries file:line analogs + excerpts). This map ADDS: per-file role/data-flow classification, the resolved rung-2 party (RESEARCH Open Question 1 / Assumption A4), and one correction RESEARCH did not surface (the offer-received surface currently selects + renders `clear_photo_url` — see `offers/[offerId]` below). Do not re-derive what RESEARCH already states; consume both.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/web/lib/after5/photos.ts` (ADD `signBlurredUrls`) | utility (storage signer) | file-I/O (signed URL mint) | `signClearUrls` (same file, line 127) | exact (same file, same mechanism) |
| `apps/web/lib/after5/photos.test.ts` (NEW) | test | file-I/O | `packages/api-client/src/feed.test.ts` (existing vitest shape) | role-match |
| `packages/api-client/src/feed.ts` (EXTEND `FeedNight` + `browseFeed`) | api-client (typed RPC wrapper) | request-response (DEFINER RPC read) | `NightDetailNight` interface + `getNightDetail` mapper (same file, lines 230-301) | exact |
| `supabase/migrations/<new>_e15_browse_feed_host_hint.sql` (WIDEN RPC) | migration (DEFINER RPC) | request-response (feed query) | `20260605120500_e10_browse_feed_filters.sql` (the prior widen of the SAME fn) | exact |
| `supabase/migrations/<new>_e16_dispatch_identity_revealed.sql` (re-CREATE both lock RPCs) | migration (DEFINER RPC) | event-driven (notification dispatch) | `new_match` dispatch in `20260527127800` (lines 357-358, 538-541) | exact |
| `apps/web/app/feed/page.tsx` (sign host blurred url SSR) | page (SSR loader) | request-response | itself (existing `browseFeed` + `createClient` SSR pattern) | exact |
| `apps/web/app/feed/NightCard.tsx` (rung-1 blurred avatar + name/age) | component | transform (render) | itself (is_seed sticker + meta `<dl>` row, lines 91-178) | exact |
| `apps/web/app/feed/NightDetailSheet.tsx` (rung-1 hint + soften copy) | component | transform (render) | itself (lines 137, 289-291 host-anonymous copy) | exact |
| `apps/web/app/offers/[offerId]/page.tsx` (rung-2: blurred not clear) | page (SSR loader) | request-response | itself (lines 40-46 offer embed select) | exact (CORRECTION — see below) |
| `apps/web/app/offers/[offerId]/OfferDetail.tsx` (rung-2 CSS blur(3px)) | component | transform (render) | itself (Polaroid host avatar, lines 90-103) | exact |
| `apps/web/app/matches/[lockId]/RevealModal.tsx` (ceremony unblur) | component | transform (render + motion) | `MatchConfirmation.tsx` (reduced-motion + framer-motion, lines 8/14/41) | role-match (motion pattern) + exact (the surface itself) |
| `apps/web/app/matches/[lockId]/LockDetail.tsx` (fire ceremony on justLocked) | component | event-driven | itself (`MatchConfirmation` mount on `justLocked`, line 68; `toast`, line 55) | exact |
| `apps/web/e2e/05-reveal-feed.spec.ts` (NEW, rung 1 + shared privacy-invariant network helper) | test (E2E) | request-response | `apps/web/e2e/5b-happy-path.spec.ts` (existing) | role-match |
| `apps/web/e2e/05-reveal-offer.spec.ts` (NEW, rung 2) | test (E2E) | request-response | `apps/web/e2e/5b-happy-path.spec.ts` (existing) | role-match |
| `apps/web/e2e/05-reveal-ceremony.spec.ts` (NEW, rung 3 + inverse-consent case) | test (E2E) | request-response | `apps/web/e2e/5b-happy-path.spec.ts` (existing) | role-match |

---

## Pattern Assignments

### `apps/web/lib/after5/photos.ts` — ADD `signBlurredUrls()` (utility, file-I/O)

**Analog:** `signClearUrls` in the SAME file, line 127. Mechanically identical; the ONLY difference is intent — blurred reads are authorized for any authenticated viewer by storage policy `profile_photos_blurred_read_v2` (no reveal gate).

**Copy from** (`apps/web/lib/after5/photos.ts:127-132`):
```typescript
export async function signClearUrls(client: After5Client, paths: string[], ttl = 600): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ttl);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}
```
`signBlurredUrls` is byte-for-byte the same body (same `BUCKET = 'profile-photos'` const at line 20, same `createSignedUrls`, same `ttl = 600`). Add a JSDoc line stating blurred reads need NO reveal gate (mirror the line-124 comment style on `signClearUrls`). Module uses named exports only (CONVENTIONS) and `import type { After5Client } from '@after5/api-client'` (line 7).

**Note for the path source:** `profiles.blurred_photo_url` / `profile_photos.blurred_path` store relative PATHS, not URLs (header comment lines 2-6). Sign the path; never reconstruct it.

---

### `packages/api-client/src/feed.ts` — EXTEND `FeedNight` + `browseFeed` (api-client, request-response)

**Analog:** the `NightDetailNight` interface + its `getNightDetail` row-mapper in the SAME file (lines 230-301) — the established "blind-safe DEFINER RPC → typed interface → defensive `str()`/`num()` mapping" pattern.

**`FeedNight` shape today** (`packages/api-client/src/feed.ts:4-16`) carries no host identity. Add EXACTLY the 3 UI-SPEC fields (nothing more — no `creator_id`, `itinerary_id`):
```typescript
host_blurred_photo_url: string | null;  // signed blurred-photo url (NOT clear)
host_first_name: string | null;         // first name only — never full name
host_age: number | null;                // age only — never DOB
```

**`browseFeed` mapping pattern** — current call is a thin pass-through cast (`feed.ts:169-178`):
```typescript
export async function browseFeed(client: After5Client, opts?: {...}): Promise<FeedNight[]> {
  const { data, error } = await client.rpc('browse_feed_for_viewer', {...});
  if (error) throw error;
  return (data ?? []) as FeedNight[];
}
```
The RPC returns the relative blurred PATH; signing happens app-side in `feed/page.tsx` (RPCs cannot mint signed URLs — RESEARCH A1). If you add per-field normalization, mirror the `getNightDetail` defensive mapper (`str()` line 250, `num()` line 247) rather than a bare cast. Inline comment convention: tag the new fields `// E15 (REQ-E15 / D-01): limited host hint ...` matching the existing `// E10 (REQ-E10 / D-03):` annotation style (line 12).

**Extend the co-located test** `packages/api-client/src/feed.test.ts` — assert the 3 new fields map.

---

### `supabase/migrations/<new>_e15_browse_feed_host_hint.sql` — WIDEN feed RPC (migration, request-response)

**Analog:** `20260605120500_e10_browse_feed_filters.sql` — the IMMEDIATELY PRIOR widen of this exact function. Copy its full structure: `drop function if exists ...(<full sig>)` → `create or replace ... security definer set search_path = public, extensions` → re-grant tail.

**The creator join is already in scope** (`20260605120500:85-87`), so the 3 hint columns need no new join:
```sql
from date_instances di
join profiles cr on cr.id = di.creator_id    -- cr.first_name, cr.age, cr.blurred_photo_url ALREADY in scope
join itineraries it on it.id = di.itinerary_id
```
Add 3 columns to `RETURNS TABLE (...)` (after `fit boolean`, line 54) and `SELECT cr.blurred_photo_url, cr.first_name, cr.age`. Project ONLY these 3 — never `cr.id` / `cr.email` / `cr.clear_photo_url` / `cr.instagram` (RESEARCH Anti-Pattern + Pitfall 2).

**MUST copy the grant tail verbatim** (`20260605120500:137-139`) — adding columns changes the signature, so `drop function` resets privileges:
```sql
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from public;
revoke execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) from anon;
grant  execute on function browse_feed_for_viewer(uuid, geography, timestamptz, uuid, int) to authenticated;
```
Run the Supabase security advisor after DDL (CLAUDE.md secure-by-default). Gated prod-apply, not auto-pushed (prod ref `ufufmcpnysvwtutpbian`). Keep `set search_path = public, extensions` (line 55) and the `language sql security definer` declaration unchanged.

---

### `supabase/migrations/<new>_e16_dispatch_identity_revealed.sql` — dispatch at BOTH lock RPCs (migration, event-driven)

**Analog:** the existing `new_match` dispatch — present at BOTH lock sites in `20260527127800_p5_match_cohort_allowlist.sql`. `identity_revealed` is currently dispatched NOWHERE (RESEARCH confirms). Add it alongside `new_match` at both sites.

**Site 1 — `match_accept_offer`** (`20260527127800:356-358`):
```sql
-- 17. dispatch new_match notification to BOTH parties
perform dispatch_notification(cand, 'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
perform dispatch_notification(cre,  'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
-- ADD identity_revealed to BOTH parties, deep-linked to /matches/[lockId]:
-- perform dispatch_notification(cand, 'identity_revealed', jsonb_build_object('lock_id', lid, 'instance', inst));
-- perform dispatch_notification(cre,  'identity_revealed', jsonb_build_object('lock_id', lid, 'instance', inst));
```

**Site 2 — `match_resolve_reciprocal`** (`20260527127800:537-541`):
```sql
-- Notify both parties
perform dispatch_notification(cand, 'new_match', jsonb_build_object('instance', p_chosen_instance, 'lock_id', lid, 'via', 'reciprocal'));
perform dispatch_notification(cre, 'new_match', jsonb_build_object('instance', p_chosen_instance, 'lock_id', lid, 'via', 'reciprocal'));
-- ADD identity_revealed to BOTH here too (Pitfall 3: wiring only one site misses reciprocal matches)
```
Re-CREATE both functions in the new migration (`CREATE OR REPLACE` — no signature change, so grants survive, but re-`set search_path` per the originals: `match_accept_offer` keeps its existing search_path, `match_pass_offer`/others use `SET search_path TO 'public'`). The dispatch resolves only the two lock participants already bound inside the DEFINER body (`cand`/`cre`) — never an extra user (Spoofing mitigation). Open product call (RESEARCH OQ2): whether `identity_revealed` should sit inside `dispatch_notification`'s `matches_enabled` consent branch like `new_match` — flag to planner; default is currently permissive.

---

### `apps/web/app/feed/page.tsx` — sign host blurred url server-side (page, request-response)

**Analog:** itself. The SSR loader already does `createClient()` → `getUser()` → gate → `browseFeed()` → render `<SwipeDeck>` (`feed/page.tsx:9-23`). Add: after `browseFeed`, collect `host_blurred_photo_url` paths and `signBlurredUrls(supabase, paths)`, map signed URLs back onto each `FeedNight`, pass into `SwipeDeck`. The `supabase` client here is the RLS'd viewer session — exactly what `signBlurredUrls` expects. Keep `export const dynamic = 'force-dynamic'` (line 7). Mind the `.catch(() => [])` resilience pattern (line 21) — signing failures should degrade to no-avatar, never crash the feed.

---

### `apps/web/app/feed/NightCard.tsx` — rung-1 blurred avatar + name/age (component, render)

**Analog:** itself — the existing meta-row + sticker rendering. The blurred avatar is a 48px (`h-12 w-12`) circular thumbnail in the content block (lines 100-179), secondary to the full-bleed cover (the PHOTO that leads is the EXPERIENCE, not the host — DESIGN-SYSTEM §5 / UI-SPEC).

**Copy patterns from this file:**
- `next/image` import + render (lines 3, 76-84) for the avatar (`sizes`, `draggable={false}`).
- CSS blur is NEW — apply `filter: blur(8px)` via `cn()` (CLAUDE.md: never concat class strings; `cn` already imported across feed surfaces). Rung-1 = heavy.
- Name+age label uses Label type (14px Fredoka 500 lowercase) per UI-SPEC: copy `{first_name}, {age}` → e.g. `maya, 27`. No "host" word.
- `is_seed` sticker (lines 91-98) shows the `stickerRotation()` + inline-`style` accent pattern if a flourish is wanted.
- The fit pill (lines 106-110) is the model for a small, on-scrim, lowercase secondary label.

Privacy invariant: this surface holds ONLY the signed blurred URL. Never `signClearUrls` reachable from here.

---

### `apps/web/app/feed/NightDetailSheet.tsx` — rung-1 hint + soften copy (component, render)

**Analog:** itself. Render the same 48px blurred avatar + `{first_name}, {age}` hint. **Two copy lines must soften** (the Phase-4 pure-blind contract is consciously relaxed by D-01):
- Line 137: `"...the host stays anonymous until you match."`
- Lines 289-291: `"...who's hosting stays a [secret]..."`

New copy must reflect name+age now showing (lowercase, dry, stop-slop, NO em-dash — STATE.md tracks one known em-dash at `PostNightForm.tsx:315`, add no more). Same `next/image` + `coverImageForNight` cover pattern stays (lines 106-107, 143).

---

### `apps/web/app/offers/[offerId]/page.tsx` + `OfferDetail.tsx` — rung-2 softened blur (page + component)

**THIS is the rung-2 SEARCHER surface** (resolves RESEARCH Open Question 1 + Assumption A4). The candidate (searcher) views the HOST here. `InterestedList` is the HOST triage screen reading CANDIDATE photos under `match_reveal_allowed` (Tier-3 clear) — NOT a reveal-ladder rung, do NOT blur it.

**CORRECTION (beyond RESEARCH):** this surface currently SELECTS and RENDERS the host's CLEAR photo path pre-lock:
- `page.tsx:43` — `host:profiles!offers_creator_id_fkey ( first_name, age, city, clear_photo_url )`
- `page.tsx:115` — `photo_url: host.clear_photo_url ?? null`
- `OfferDetail.tsx:91-96` — `<Polaroid src={host.photo_url ?? '/places/place-walk.jpg'} ... />`

For the rung-2 privacy invariant this MUST change to `blurred_photo_url`, signed via `signBlurredUrls`, then CSS `blur(3px)` (one step softer than rung-1's `blur(8px)`). The clear path may NOT be signed/rendered until post-lock. Today it renders a raw path (likely broken), so swapping to a signed blurred URL also fixes a latent bug.

**Render analog** — the existing host header in `OfferDetail.tsx:90-103`:
```tsx
<Polaroid src={host.photo_url ?? '/places/place-walk.jpg'} alt={host.first_name} size="sm" tone="dating" />
<p className="font-body text-lg font-semibold lowercase text-shell-ink">{name}{host.age ? `, ${host.age}` : ''}</p>
```
Keep this exact "experience-led, avatar secondary" layout (the night/plan via `PlanTimeline` leads — REQ-E15 hard criterion). Apply rung-2 blur to the avatar only. Name+age label copy is unchanged from rung 1.

---

### `apps/web/app/matches/[lockId]/RevealModal.tsx` — ceremony unblur dissolve (component, render + motion)

**Analog (the surface):** itself — a `vaul` `Drawer.Root` on `bg-shell-base` rendering `<ProfileCard>` with signed clear `photos` + `prompts` (RevealModal.tsx:1-43). The clear photo is ALREADY signed server-side in `matches/[lockId]/page.tsx` via `signClearUrls` gated by `match_reveal_allowed_pair` — RevealModal just receives `photos: string[]`.

**Analog (the motion pattern):** `MatchConfirmation.tsx` — the canonical reduced-motion framer-motion shape in this directory:
```typescript
// MatchConfirmation.tsx:8,14,41
import { motion, useReducedMotion } from 'framer-motion';
const reduce = useReducedMotion();
// ...
{!reduce && ( /* decorative motion only; the announcement survives reduced-motion */ )}
```
Apply per UI-SPEC: animate CSS `filter` `blur(12px)→blur(0px)` over ~900ms `ease:[0.22,1,0.36,1]`, `scale 1.02→1.0`, `opacity 0.85→1` on the photo. `if (reduce)` → clear photo immediately + ≤200ms opacity cross-fade, static flourish, still fire the toast (accessibility is taste — DESIGN-SYSTEM §9). One hot-pink `shell.accent` flourish element, NOT a particle burst (the burst lives on `MatchConfirmation`; the reveal is quieter). Wire a `ceremony`/`justLocked` prop in (RevealModal currently has no entrance animation — gate the dissolve on it so return visits open static, Pitfall 5).

---

### `apps/web/app/matches/[lockId]/LockDetail.tsx` — fire ceremony on justLocked + toast (component, event-driven)

**Analog:** itself. `MatchConfirmation` already mounts gated on `justLocked` (LockDetail.tsx:68: `<MatchConfirmation name={name} show={justLocked} />`), and `RevealModal` already mounts here (line 85) opened by the quiet "see their profile" button (lines 78-85). Wire the ceremony: when `justLocked`, auto-open `RevealModal` in ceremony mode + fire the `sonner` toast.

**Toast pattern** — `toast` is already imported and used (LockDetail.tsx:6, 55):
```typescript
import { toast } from 'sonner';
toast('that date is called off.');   // existing usage at line 55 — mirror for the reveal beat
```
Reveal toast copy (UI-SPEC Copywriting Contract): `the face behind the night. say hi.` (lowercase, no em-dash). Keep the on-demand "see their profile" open QUIET (no animation) for return visits (`justLocked=false`).

---

## Shared Patterns

### Privacy invariant (cross-cutting, load-bearing)
**Sources:** `profile_photos_blurred_read_v2` (`20260602130200_m6_profile_photos_storage.sql`, permissive) + `profile_photos_clear_reveal_read` (gated by `match_reveal_allowed_pair`).
**Apply to:** every rung-1/rung-2 surface (`feed/page.tsx`, `NightCard`, `NightDetailSheet`, `offers/[offerId]`).
- Rungs 1+2 call ONLY `signBlurredUrls`, NEVER `signClearUrls` / `createSignedUrl`.
- CSS `blur()` only ADDS blur over the already-64px-downscaled blurred asset; removing it in devtools reveals only the blurred artifact, never the clear face.
- The clear path is signed exclusively in `matches/[lockId]/page.tsx`.
- E2E enforcement (the test that must not be skipped — RESEARCH): capture all `storage/v1/object/sign` requests on feed + offer pages, assert every signed path ends in `_blurred.jpg`.

### Secure-by-default DDL (cross-cutting)
**Source:** the grant tail of `20260605120500_e10_browse_feed_filters.sql:137-139` + CLAUDE.md.
**Apply to:** both new migrations.
- Pin `set search_path`, never `USING(true)` on update/delete, re-apply `revoke from public + anon / grant authenticated` after any signature-changing re-CREATE, run the Supabase security advisor after DDL, local-green before gated prod-apply, do NOT auto-push.

### Reduced-motion-aware framer-motion (cross-cutting)
**Source:** `MatchConfirmation.tsx:8,14,41` (`useReducedMotion()` gate).
**Apply to:** RevealModal ceremony. Motion is gated behind `!reduce`; the emotional beat (toast + clear face + static flourish) survives reduced-motion.

### Stop-slop lowercase copy (cross-cutting)
**Source:** UI-SPEC Copywriting Contract + STATE.md:42.
**Apply to:** all new/changed reveal + hint copy. Lowercase headlines/CTAs, no em-dash, no filler. Fixed strings: hint `{first_name}, {age}`; toast `the face behind the night. say hi.`; headline `you cooked.`; sub-line `here's {first_name}.`; CTA `slide in`.

### Notification dispatch inside a DEFINER lock RPC (cross-cutting)
**Source:** `new_match` dispatch in `20260527127800` (lines 357-358, 538-541) + `dispatch_notification` (`20260525123600_p2_dispatch_notification.sql`).
**Apply to:** the E16 migration. Dispatch only to the two resolved participants; payload is server-constructed `jsonb_build_object`.

---

## No Analog Found

None. Every surface has an in-repo analog; the two new test files mirror existing vitest/Playwright shapes.

| File | Role | Data Flow | Note |
|------|------|-----------|------|
| `apps/web/lib/after5/photos.test.ts` | test | file-I/O | No co-located test exists for `photos.ts` yet; mirror `packages/api-client/src/feed.test.ts` vitest shape (Wave 0) |
| `apps/web/e2e/05-reveal-feed.spec.ts` | test (E2E) | request-response | Mirror `apps/web/e2e/5b-happy-path.spec.ts`; carries the shared privacy-invariant network assertion helper (Wave 0) |
| `apps/web/e2e/05-reveal-offer.spec.ts` | test (E2E) | request-response | Rung-2 offer surface; reuses the privacy-invariant network helper |
| `apps/web/e2e/05-reveal-ceremony.spec.ts` | test (E2E) | request-response | Rung-3 ceremony + reduced-motion + inverse-consent (matches_enabled=false → no identity_revealed) |

---

## Metadata

**Analog search scope:** `apps/web/lib/after5/`, `packages/api-client/src/`, `apps/web/app/{feed,offers/[offerId],matches/[lockId],dates/[slug]/interested}/`, `supabase/migrations/`
**Files read for excerpts:** photos.ts, feed.ts, RevealModal.tsx, LockDetail.tsx, MatchConfirmation.tsx, feed/page.tsx, NightCard.tsx, offers/[offerId]/{page,OfferDetail}.tsx, 20260605120500_e10_browse_feed_filters.sql, 20260527127800_p5_match_cohort_allowlist.sql (dispatch ranges)
**Pattern extraction date:** 2026-06-04

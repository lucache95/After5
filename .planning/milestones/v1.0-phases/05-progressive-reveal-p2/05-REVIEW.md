---
phase: 05-progressive-reveal-p2
reviewed: 2026-06-04T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - apps/web/lib/after5/photos.ts
  - packages/api-client/src/feed.ts
  - apps/web/app/feed/page.tsx
  - apps/web/app/feed/NightCard.tsx
  - apps/web/app/feed/NightDetailSheet.tsx
  - apps/web/app/offers/[offerId]/page.tsx
  - apps/web/app/offers/[offerId]/OfferDetail.tsx
  - apps/web/app/matches/[lockId]/RevealModal.tsx
  - apps/web/app/matches/[lockId]/LockDetail.tsx
  - apps/web/e2e/_helpers/reveal-privacy.ts
  - supabase/migrations/20260606120000_e15_browse_feed_host_hint.sql
  - supabase/migrations/20260606120100_e16_dispatch_identity_revealed.sql
  - apps/web/next.config.mjs
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-04
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the progressive-reveal (E15/E16) surfaces against the central privacy invariant
(the host's CLEAR photo must be unreachable before both sides lock). **The privacy
invariant itself holds.** I verified, by direct reading and cross-file/migration analysis:

- `feed/page.tsx` and `offers/[offerId]/page.tsx` sign ONLY blurred paths pre-lock
  (`signBlurredUrls`); the clear signer (`signClearUrls`) is never imported on a pre-lock
  surface. The feed-page alignment guard correctly degrades to a null avatar on partial
  signing failure rather than mis-pairing faces.
- The clear photo is signed only on `matches/[lockId]/page.tsx`, gated server-side by RLS
  policies `profile_photos_revealed_read` and `profile_photos_clear_reveal_read`, both
  keyed on `match_reveal_allowed_pair`. `ProfileCard`/`Polaroid` render only the signed
  `photos[]` array — never `person.clear_photo_url` directly.
- **E15 migration** DROP+CREATEs `browse_feed_for_viewer` and correctly re-applies the
  `revoke public / revoke anon / grant authenticated` tail after the DROP. `search_path`
  is pinned (`set search_path = public, extensions`). The projection adds EXACTLY the 3
  intended host-hint columns (`cr.blurred_photo_url, cr.first_name, cr.age`) — no
  `creator_id`, `email`, `clear_photo_url`, or `instagram`. The DROP signature matches the
  live e10 signature exactly.
- **E16 migration** is verbatim (diffed line-by-line against the 127800 / 123600 originals)
  plus exactly the two `identity_revealed` dispatches per lock RPC and the one widened
  consent predicate. Both lock RPCs (`match_accept_offer` AND `match_resolve_reciprocal`)
  dispatch to BOTH parties. `identity_revealed` respects `matches_enabled` the same way
  `new_match` does. All three re-CREATEs are `CREATE OR REPLACE` (no DROP), so the original
  `revoke ... from public, authenticated` grants persist — no privilege re-exposure. No
  intervening migration redefines these bodies, so no logic is clobbered.
- `next.config.mjs` local image hosts are scoped to `127.0.0.1:54321` / `localhost:54321`
  over `http` only; prod `*.supabase.co` host is untouched. Correctly forced-local.

The findings below are quality/robustness defects and one dead-code privacy-UX gap, not a
breach of the invariant.

## Structural Findings (fallow)

No structural pre-pass was provided for this review.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: `RevealModal.photoError` held-state is dead code — failed clear-photo signing degrades silently during the ceremony

**File:** `apps/web/app/matches/[lockId]/page.tsx:84-96`, `apps/web/app/matches/[lockId]/LockDetail.tsx:101-108`, `apps/web/app/matches/[lockId]/RevealModal.tsx:29,67,102-106`

**Issue:** `RevealModal` ships a `photoError` prop whose documented purpose (lines 27-29,
102-106) is to hold the photo at a light blur with a "couldn't load the photo. pull to
retry. the plan's still locked in." line when clear-photo signing fails upstream. But the
chain never wires it:
- `page.tsx` swallows any signing failure into `photos = []` (catch at line 94) with no
  error flag passed down.
- `LockDetail` renders `<RevealModal ... />` (line 101) and never passes `photoError`.
- So `photoError` always defaults to `false`. When signing genuinely fails, the
  `justLocked` ceremony auto-opens (LockDetail:59-65) and plays the blur(12px)->blur(0)
  un-blur animation over an **empty ProfileCard gradient fallback** (ProfileCard renders
  the Polaroid placeholder when `photos.length === 0`), with no retry affordance. The
  intended "held + retry" state is unreachable.

**Fix:** Surface the signing outcome from the page and thread it through:
```tsx
// page.tsx
let photos: string[] = [];
let photoError = false;
try {
  const rows = await listMyPhotos(supabase, counterpart.id);
  photos = await signClearUrls(supabase, rows.map((r) => r.clear_path));
  // ...legacy mirror fallback...
} catch {
  photos = [];
  photoError = true;
}
// ...pass photoError to <LockDetail photoError={photoError} ... />
// LockDetail forwards it: <RevealModal ... photoError={photoError} />
```
Also consider treating `photos.length === 0` (no rows AND no mirror) as `photoError` so a
genuinely empty reveal shows the retry line rather than a blank ceremony.

### WR-02: `signBlurredUrls` and `signClearUrls` are byte-identical — the privacy boundary is naming convention only, with no enforced path guard

**File:** `apps/web/lib/after5/photos.ts:127-144`

**Issue:** The two functions are mechanically identical (both call
`createSignedUrls(paths, ttl)` with no path inspection). The clear-vs-blurred distinction
is enforced solely by (a) which function the caller imports and (b) the storage RLS
policy. The header comment on `signBlurredUrls` even asserts "NEVER sign the clear path on
a pre-lock surface" — but the function does nothing to prevent it. A future caller that
passes a clear path (`<uid>/<id>.jpg`) to `signBlurredUrls` on a pre-lock surface would
mint a signing request for the clear object. The storage policy `profile_photos_blurred_read_v2`
requires `right(name,12) = '_blurred.jpg'`, so the clear object would not be readable
pre-lock via that policy — but the defense is entirely in the DB, and the named
"blurred-only" signer gives a false sense of an app-layer guard. The e2e helper
(`assertNoClearPhotoSigned`) is the only thing catching a slipped clear path, and only at
test time.

**Fix:** Enforce the invariant in `signBlurredUrls` so misuse fails fast rather than
relying on storage RLS + e2e to catch it:
```ts
export async function signBlurredUrls(client: After5Client, paths: string[], ttl = 600): Promise<string[]> {
  if (paths.length === 0) return [];
  const bad = paths.filter((p) => !/_blurred\.jpe?g$/i.test(p));
  if (bad.length) throw new Error(`signBlurredUrls received non-blurred path(s): ${bad.join(', ')}`);
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ttl);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}
```

### WR-03: Raw private `clear_photo_url` storage path is serialized into client props

**File:** `apps/web/app/matches/[lockId]/page.tsx:35-36,135-147`, `apps/web/app/matches/lock-view.ts:9-20`

**Issue:** The lock select pulls `clear_photo_url` for both `creator` and `matched`
profiles into `PartyProfile`, and `counterpart` (the full `PartyProfile`, including the raw
private storage path) is passed to `LockDetail` as `counterpart` and onward to
`RevealModal` as `person`. The raw path is not rendered (ProfileCard uses the signed
`photos[]` instead), so this is not directly exploitable — a private path is useless
without a signed URL. But it leaks the storage object key (`<uid>/<id>.jpg`) into the
client HTML/RSC payload, which is unnecessary and contradicts the project's
"Storing Sensitive Data in Client Props" anti-pattern (ARCHITECTURE.md). It also
needlessly transmits the path for the side that is NOT the counterpart.

**Fix:** Drop `clear_photo_url` from the `PartyProfile` fields passed to the client, or
strip it before passing `counterpart` to `LockDetail` (the page already signs it
server-side into `photos`). The mirror is only needed server-side for the legacy fallback
at page.tsx:88-92.

### WR-04: Reveal read survives lock cancellation via the unconditional `'accepted'` offer branch

**File:** `apps/web/app/matches/[lockId]/page.tsx:83-96` (consumer); reveal gate in `supabase/migrations/20260527127700_p5_reveal_hardening.sql:55,82,98,121`

**Issue:** The reveal page signs the counterpart's clear photos whenever
`match_reveal_allowed_pair` passes. That predicate reveals on `o.status = 'accepted'`
**unconditionally** (offer stays `accepted` for the life of the lock) in addition to
`l.status in ('active','completed')`. When a lock is cancelled, its row moves to
`cancelled` (excluded by the lock branch) but the originating offer remains `accepted`, so
the clear photo stays revealable to the ex-counterpart indefinitely. `LockDetail` also does
not gate the reveal CTA on `status` — a `cancelled` lock still renders "see their profile"
and signs clear photos (page.tsx never checks `lock.status` before signing). The reveal
gate predicate predates this phase, but this phase's reveal page is the surface that
exercises it, and the phase intent ("clear photo unreachable before both sides lock")
implies it should also become unreachable once the date is called off.

**Fix:** Either (a) tighten `match_reveal_allowed_pair` so the `'accepted'` branch also
requires a non-cancelled lock, or (b) at minimum, gate the clear-photo signing + reveal CTA
in `matches/[lockId]/page.tsx` / `LockDetail` on `lock.status !== 'cancelled'`. Confirm the
intended product rule before changing the shared predicate (it affects every reveal
surface, not just this page).

### WR-05: `OfferDetail` "not interested" action can no-op-degrade to `passOffer` silently

**File:** `apps/web/app/offers/[offerId]/OfferDetail.tsx:165-175`

**Issue:** The "not interested" button calls `withdraw(instanceId)` when `instanceId` is
present, else falls back to `passOffer(offerId)`. `instanceId` comes from
`offer.date_instance_id` (page.tsx:121), which the comment (page.tsx:13-15) says is "always
readable." If that column is ever null (e.g., a malformed offer row), the button silently
*passes* the offer instead of *withdrawing the queue entry* — two semantically different
outcomes (pass resolves only this offer; withdraw removes the candidate from the night's
queue). The user intends "remove me," gets "skip this offer," and may resurface in the
queue. No toast distinguishes the two paths.

**Fix:** This is acceptable degrade only if `date_instance_id` is guaranteed non-null at the
DB level. Verify the `offers.date_instance_id` column is `NOT NULL` (it almost certainly
is, given the FK). If so, drop the `instanceId ? ... : ...` ternary and call `withdraw`
unconditionally with a non-null assertion documented as DB-guaranteed. If it can be null,
the silent fallback should at least be logged.

## Info

### IN-01: Dead/back-compat exports in NightCard

**File:** `apps/web/app/feed/NightCard.tsx:22-33,227`

**Issue:** `coarseTime` and `km` are defined and re-exported "for callers/tests that
imported it from here," but `coarseTime` is unused inside the file (the card uses inline
`LocalTime` formatting at 149-153) and `km` just wraps `formatDistanceAway`. If no current
test/caller imports them, they are dead code.

**Fix:** Grep for external importers; if none remain, delete both and the `export { coarseTime, km }` line.

### IN-02: Speculative `MaybeGeoFields` cast reads fields the contract doesn't provide

**File:** `apps/web/app/feed/NightCard.tsx:39,54-56`

**Issue:** `night as FeedNight & MaybeGeoFields` reads `city_name` / `reach_radius_km`,
which `FeedNight` does not declare and `browse_feed_for_viewer` does not return. This is
intentional forward-compat (commented), but it is an unchecked `as` cast that will read
`undefined` forever until the RPC changes, and silently hides a real type mismatch if the
RPC later returns differently-named fields.

**Fix:** Acceptable as documented forward-compat, but consider adding the optional fields to
`FeedNight` as `?: ... | null` instead of an inline intersection cast, so the type system
tracks the contract drift rather than an ad-hoc cast.

### IN-03: Duplicated `km()` helper across feed components

**File:** `apps/web/app/feed/NightCard.tsx:31-33` and `apps/web/app/feed/NightDetailSheet.tsx:37-43`

**Issue:** Two different `km()` implementations exist — NightCard's delegates to
`formatDistanceAway`, NightDetailSheet's reimplements the km rounding inline. Divergent
distance formatting between the card and its detail sheet is a subtle UX inconsistency.

**Fix:** Have NightDetailSheet import the shared `formatDistanceAway` from `@/lib/distance`
(as NightCard does) rather than reimplementing rounding.

---

_Reviewed: 2026-06-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

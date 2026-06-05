# Phase 5: Progressive Reveal (P2) - Research

**Researched:** 2026-06-04
**Domain:** Three-tier host photo reveal ladder (blur-driven) + gated `identity_revealed` ceremony, on Next.js 15 / Supabase / RLS
**Confidence:** HIGH (all claims grounded in actual code, file:line cited)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Pre-match host tier:** Heavy-blur host avatar + first name + age on the feed card and detail. Consciously relaxes the Phase-4 pure-blind contract. `FeedNight` gains a limited host hint; `signBlurredUrls()` signs the blurred photo. Name+age are known from the feed onward; the offer-stage delta is purely blur reduction.
- **D-02 — Reveal threshold:** Post-lock, at the match. Full reveal + ceremony fire the moment both sides lock (accept). Existing `RevealModal.tsx` lives at lock; `match_reveal_allowed` RPCs already gate post-lock reveal. Rapport-gated reveal explicitly DEFERRED.
- **D-03 — Partial reveal at offer:** Lighter blur at the offer (one step softer). Interested/offer surfaces stay experience-led (night leads, softening face secondary).
- **D-04 — The ceremony:** Animated unblur + subtle Barbiecore flourish. Face resolves from blur into focus (animated dissolve) with a gentle on-brand beat (soft glow/sticker + `sonner` toast), reusing + enhancing `RevealModal.tsx`. Earned, not loud.

### Claude's Discretion
- Exact blur strengths per rung (heavy → light → clear) and whether "lighter blur" is a second pre-generated asset or CSS blur on the same asset.
  - **UI-SPEC DECIDED:** CSS `blur()` on a single signed source asset — rung 1 `blur(8px)`, rung 2 `blur(3px)`, rung 3 swap to clear (zero blur). No second blur tier.
- Precise `FeedNight` shape extension for the host hint.
  - **UI-SPEC DECIDED:** exactly 3 fields — `host_blurred_photo_url`, `host_first_name`, `host_age`.
- Ceremony animation mechanics (framer-motion dissolve, timing, reduced-motion fallback) per DESIGN-SYSTEM.md.
- Whether `identity_revealed` dispatch is already wired at lock or needs a dispatch site.
  - **THIS RESEARCH CONFIRMS:** NOT wired. Needs a dispatch site at BOTH lock RPCs (see §identity_revealed dispatch). This is RPC body wiring, not a migration.

### Deferred Ideas (OUT OF SCOPE)
- **Rapport-gated reveal threshold** — reveal only after chat rapport. Net-new hard-gating logic; revisit as P3.
- **Mutual tap-to-reveal** — both parties tapping "reveal" in chat. Coordination/stuck-state complexity. Backlog.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-E15 | Three reveal tiers; consume `blurred_photo_url`; add `signBlurredUrls()`; limited host hint into `FeedNight`; experience-led `InterestedList`/offer | §signBlurredUrls (storage policy already permits blurred reads), §FeedNight extension (host fields available via creator join, project blind-safe), §Blur tiers (CSS-over-single-asset confirmed safe) |
| REQ-E16 | Dispatch `identity_revealed` at threshold + reveal ceremony | §identity_revealed dispatch (two lock sites, enum already applied, mirror E8 pattern), §Ceremony (enhance `RevealModal`, framer-motion unblur) |
</phase_requirements>

## Summary

This phase is overwhelmingly **wiring**, not plumbing. Every piece of infrastructure the ladder needs already exists in the codebase: the blur generator edge fn, the `blurred_photo_url`/`blurred_path` columns, the storage read policies (including a permissive blurred-read policy that needs NO change), the reveal-gate RPCs (`match_reveal_allowed_pair`), the post-lock reveal surface (`RevealModal` + `LockDetail`), and the `identity_revealed` notification enum (already applied to prod per STATE.md:85). The phase connects these.

The most consequential findings: (1) **no new DDL is required** for the privacy/storage layer — `profile_photos_blurred_read_v2` already lets any authenticated viewer read `*_blurred.jpg` objects, so `signBlurredUrls()` works against the existing policy; (2) **`identity_revealed` is NOT dispatched anywhere** and needs wiring at TWO lock sites (`match_accept_offer` and `match_resolve_reciprocal`, both in the canonical cohort-allowlist migration), mirroring the already-shipped E8 `interest_received` pattern; (3) the **privacy invariant holds for free** because the feed/offer surfaces only ever hold the blurred path — the clear path is signed exclusively on the post-lock reveal page where the RLS'd client passes `match_reveal_allowed_pair`. CSS blur only ADDS blur over an already-safe asset, so it cannot leak the clear face.

The one genuine schema question is whether the host hint (blurred photo path + first name + age) can be projected into the feed blind-safely. The feed RPC `browse_feed_for_viewer` already JOINs `profiles cr on cr.id = di.creator_id`, so the columns are in scope — the only decision is whether to widen the RPC return (add 3 columns) or do a separate limited host-hint read. Either way it may require touching the SECURITY DEFINER feed RPC, which falls under the gated-prod-apply rule.

**Primary recommendation:** Add `signBlurredUrls()` to `apps/web/lib/after5/photos.ts` mirroring `signClearUrls()` (line 132) but with no reveal gate (blurred reads are already authorized). Widen `browse_feed_for_viewer` to return the 3 host-hint columns from the existing `cr` join (gated prod-apply). Wire `identity_revealed` dispatch into both lock RPCs alongside the existing `new_match` dispatch. Enhance `RevealModal` with a framer-motion unblur dissolve fired on `justLocked`. No new storage policy, no second blur asset.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sign blurred photo URL (rung 1+2) | Frontend Server (SSR) | Database / Storage | Server-side RLS'd client mints signed URL; storage RLS authorizes the read |
| Project host hint into FeedNight | Database (RPC) | API Client package | `browse_feed_for_viewer` DEFINER RPC is the blind-safe projection boundary; api-client types it |
| CSS blur tiers (rung 1 heavy / rung 2 light) | Browser / Client | — | Presentation-only `filter: blur()` over the already-safe blurred asset |
| Sign clear photo URL (rung 3) | Frontend Server (SSR) | Database / Storage | Already done in `matches/[lockId]/page.tsx`; gated by `match_reveal_allowed_pair` storage policy |
| `identity_revealed` dispatch | Database (RPC) | — | Fired inside the SECURITY DEFINER lock RPCs, the atomic transition boundary, mirroring `new_match` |
| Reveal ceremony (animated unblur) | Browser / Client | — | framer-motion in `RevealModal`/`LockDetail`, fired on `justLocked` |

## Standard Stack

No new packages. Everything is already installed and version-locked (`apps/web/package.json`):

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| framer-motion | ^12.40.0 | Unblur dissolve, scale/glow, reduced-motion via `useReducedMotion()` | Already the project's motion lib; `MatchConfirmation.tsx` + `SwipeDeck.tsx` use it |
| vaul | ^1.1.2 | The `RevealModal` bottom sheet (already built on `Drawer.Root`) | Project standard for sheets; `RevealModal.tsx` already uses it |
| sonner | ^2.0.7 | `identity_revealed` reveal toast | Project standard for toasts; `LockDetail.tsx` already imports `toast` |
| lucide-react | ^0.460.0 | Any icon needs | Project icon lib |
| @supabase/supabase-js | 2.45.0 | `createSignedUrls` for blurred-photo signing | Already used by `signClearUrls` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Next.js `Image` | 15.1.0 | Render blurred/clear photos | Card avatar + ceremony photo; `next.config.js` remotePatterns already allow Supabase storage signed URLs |
| `cn()` (clsx + tailwind-merge) | 2.1.1 / 2.5.5 | Conditional blur classes | Per CONVENTIONS — never concat class strings |

**Installation:** None. `pnpm install` already satisfies all dependencies.

## Package Legitimacy Audit

> Not applicable — this phase installs NO external packages. All libraries (framer-motion, vaul, sonner, lucide-react, @supabase/supabase-js) are already in `pnpm-lock.yaml` and in production use. No registry/slopcheck pass required.

## Architecture Patterns

### System Architecture Diagram — the reveal ladder data flow

```
                          RUNG 1 (pre-match)                    RUNG 2 (offer)                     RUNG 3 (post-lock)
                          feed card + detail                    InterestedList / offer flow        RevealModal + LockDetail
                                  │                                     │                                   │
  ┌───────────────┐              │                                     │                                   │
  │ feed/page.tsx │  browseFeed  │                                     │                                   │
  │ (SSR, RLS'd)  │──────────────┤                                     │                                   │
  └───────┬───────┘              │                                     │                                   │
          │                      ▼                                     ▼                                   ▼
          │            browse_feed_for_viewer                  match_host_can_see_candidate      match_reveal_allowed_pair
          │            (DEFINER RPC, blind-safe)               (DEFINER, host triage scope)       (DEFINER reveal gate)
          │            ── WIDEN: +host_blurred_photo_url        ── already grants host read of     ── already grants clear
          │                      +host_first_name              candidate Tier-3 pre-offer            photo read post-lock
          │                      +host_age (from cr join)                                                  │
          ▼                                                                                                │
  signBlurredUrls()  ◄── NEW: mirror signClearUrls, no reveal gate                                         │
  (storage.createSignedUrls on blurred_path)                                                       signClearUrls()
          │            storage RLS profile_photos_blurred_read_v2 (already permits)                (matches/[lockId]/page.tsx
          ▼                      ▼                                     ▼                             — ALREADY DONE)
   NightCard: render <img blurred_url> + CSS blur(8px)        same asset + CSS blur(3px)                   ▼
   NightDetailSheet: same                                     experience-led, avatar secondary    RevealModal: clear photo
   + {first_name, age} label                                                                       + framer-motion unblur(12→0)
                                                                                                   + sonner toast + 1 pink flourish
                                                                                                          ▲
                                                                                                          │
                          match_accept_offer ──┐                                                          │
                          match_resolve_reciprocal ──┤ insert lock → dispatch new_match (existing)        │
                                                     └─ ADD: dispatch identity_revealed to BOTH ──────────┘
                                                        (mirror E8 interest_received pattern)
```

**Privacy invariant (load-bearing):** Rungs 1 and 2 NEVER fetch or sign the clear path. The client only ever holds the signed `blurred_path` URL pre-lock. CSS blur is presentation-only and only ADDS blur over the already-downscaled-to-64px asset (`generate-blur/index.ts:8-15`), so it cannot reveal the clear face. The clear URL is signed exclusively in `matches/[lockId]/page.tsx` where the RLS'd viewer passes `match_reveal_allowed_pair` (storage policy `profile_photos_clear_reveal_read`).

### Recommended Project Structure (files this phase touches)
```
apps/web/lib/after5/photos.ts            # ADD signBlurredUrls() next to signClearUrls (line 132)
packages/api-client/src/feed.ts          # EXTEND FeedNight interface (line 4) + browseFeed mapping
apps/web/app/feed/page.tsx               # SIGN host blurred url server-side, pass into SwipeDeck
apps/web/app/feed/NightCard.tsx          # RENDER blurred avatar + {name, age} label (footer, 48px)
apps/web/app/feed/NightDetailSheet.tsx   # RENDER same hint; loosen "host stays anonymous" copy
apps/web/app/dates/[slug]/interested/InterestedList.tsx  # rung-2 lighter blur, experience-led
apps/web/app/dates/[slug]/interested/MakeOfferModal.tsx  # rung-2 host hint if it shows a photo
apps/web/app/matches/[lockId]/RevealModal.tsx            # ceremony: framer-motion unblur dissolve
apps/web/app/matches/[lockId]/LockDetail.tsx             # fire ceremony on justLocked, sonner toast
supabase/migrations/<new>_e15_browse_feed_host_hint.sql  # WIDEN browse_feed_for_viewer (gated prod-apply)
supabase/migrations/<new>_e16_dispatch_identity_revealed.sql  # re-CREATE OR REPLACE both lock RPCs (gated)
```

### Pattern 1: Signed-URL mirror (signBlurredUrls)
**What:** Mirror `signClearUrls` but sign the blurred path with no reveal gate.
**When to use:** Rung 1 + 2, server-side, after fetching the host's `blurred_path`.
**Example:**
```typescript
// Source: apps/web/lib/after5/photos.ts:132 (signClearUrls — the pattern to mirror)
export async function signClearUrls(client: After5Client, paths: string[], ttl = 600): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ttl);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}
// signBlurredUrls() is mechanically identical (same createSignedUrls, BUCKET='profile-photos',
// ttl=600). The ONLY difference is intent: blurred reads are authorized for any authenticated
// viewer by storage policy profile_photos_blurred_read_v2 — no reveal gate needed. [VERIFIED: codebase]
```

### Pattern 2: Notification dispatch inside a DEFINER lock RPC (E8 → E16)
**What:** `perform dispatch_notification(user, type, payload)` alongside the existing `new_match` dispatch.
**When to use:** Both lock transition sites.
**Example:**
```sql
-- Source: supabase/migrations/20260527127800_p5_match_cohort_allowlist.sql:357-358 (match_accept_offer)
perform dispatch_notification(cand, 'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
perform dispatch_notification(cre,  'new_match', jsonb_build_object('instance', inst, 'lock_id', lid));
-- ADD identity_revealed to BOTH parties here, deep-linked to /matches/[lockId]:
-- perform dispatch_notification(cand, 'identity_revealed', jsonb_build_object('lock_id', lid, 'instance', inst));
-- perform dispatch_notification(cre,  'identity_revealed', jsonb_build_object('lock_id', lid, 'instance', inst));
-- Mirror at match_resolve_reciprocal:538-541 too. [VERIFIED: codebase]
```

### Pattern 3: Reduced-motion-aware framer-motion ceremony
**What:** `useReducedMotion()` gates the unblur animation; the toast + clear photo survive.
**Example:**
```typescript
// Source: apps/web/app/matches/[lockId]/MatchConfirmation.tsx:18 (the existing reduced-motion pattern)
const reduce = useReducedMotion();
// ... if (reduce) → render clear photo immediately + ≤200ms opacity cross-fade; still fire toast.
// else → animate filter blur(12px)→blur(0px) over ~900ms, ease [0.22,1,0.36,1], scale 1.02→1.0.
```

### Anti-Patterns to Avoid
- **Generating a second blur asset for rung 2.** The UI-SPEC explicitly rejected this — `generate-blur` produces exactly one `blurred_path`; a second tier means a new column + backfill + prod-apply surface. Use CSS `blur(3px)` over the same asset.
- **Signing the clear path on the feed or offer surface.** Breaks the privacy invariant. The clear path may ONLY be signed where `match_reveal_allowed_pair` passes (post-lock reveal page).
- **Widening the feed RPC's identity surface beyond the 3 hint fields.** Do NOT add `creator_id`, `itinerary_id`, precise venue, handle, or full name. Blind contract preserved minus the explicit hint.
- **Loosening the clear-path storage policy.** `profile_photos_clear_reveal_read` stays exactly as-is. Only blurred reads are permissive (already are).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Blurring the face | A new image processor | `generate-blur` edge fn (`blurred_path = <uid>/<id>_blurred.jpg`) | Already downscales to 64px + softens; the privacy floor exists |
| Reveal authorization | A new gate check | `match_reveal_allowed_pair(viewer, target)` | Bidirectional DEFINER predicate; already powers the storage clear-read policy |
| Blurred-photo read authz | A new storage policy | `profile_photos_blurred_read_v2` (already permits any authenticated read of `*_blurred.jpg`) | No DDL needed for signing blurred URLs |
| Notification delivery | A new dispatch path | `dispatch_notification(user, type, payload)` | Handles consent/quiet-hours/rate-limit/channel; `identity_revealed` falls through to permissive (not in the consent gate) |
| Reveal sheet + ProfileCard | A new reveal UI | `RevealModal.tsx` + `ProfileCard` (already render signed clear photos + prompts post-lock) | Built and shipped; only the animation is new |
| Lock-fired celebration trigger | A new "did I just lock?" hook | `justLocked` prop (from `?just=1` or realtime locks INSERT) | `MatchConfirmation`/`LockDetail` already consume it |

**Key insight:** This phase's risk is almost entirely in (a) the blind-contract relaxation (D-01 — exposing name+age+blurred face pre-match) and (b) not leaking the clear photo. Both are governed by existing RLS surfaces, so the discipline is "wire to the existing gates, don't open new ones."

## Runtime State Inventory

> Rename/refactor categories — mostly N/A for this feature phase, but the schema-touch items matter for gated prod-apply.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `profiles.blurred_photo_url` / `profiles.clear_photo_url` store relative storage PATHS (not URLs), written by `generate-blur` (`profiles_dating.sql:33-34`). `profile_photos.blurred_path` per-photo mirror. No data migration needed — paths already populated for existing users. | None (data already present) |
| Live service config | The `identity_revealed` notification enum value is APPLIED on prod (STATE.md:85, migration `20260603120000`). The notif deep-link map (`notif-map`) already had the inbox row support folded in for #84. | Verify dispatch site lands before relying on the enum (it currently dispatches nowhere) |
| OS-registered state | None | None — verified by scope (web app, no OS registrations) |
| Secrets/env vars | None new. Signing uses the existing RLS'd session client (no service-role needed for blurred reads). | None |
| Build artifacts | None | None |

**Gated prod-apply note:** Two new migrations are likely (browse_feed widen + dispatch wiring). Both touch SECURITY DEFINER functions. Per STATE.md:106 + CLAUDE.md: local-green → run Supabase security advisor after DDL → batched prod apply, NOT auto-pushed. Re-`CREATE OR REPLACE` must re-apply the existing grants (revoke public+anon, grant authenticated) — see `browse_feed_for_viewer` grant block at the end of `20260605120500_e10_browse_feed_filters.sql`.

## Common Pitfalls

### Pitfall 1: Clear photo leaks at the offer stage
**What goes wrong:** Rung 2 ("lighter blur") tempts an implementer to fetch the clear photo and CSS-blur it. That hands the raw face to the client; CSS blur is removable in devtools.
**Why it happens:** "Lighter blur" sounds like "less blur on the real photo."
**How to avoid:** Rung 2 uses the SAME `blurred_path` asset as rung 1 with a lower CSS `blur(3px)`. The clear path is never signed pre-lock. Enforced by: the offer surface code only ever calls `signBlurredUrls`, never `signClearUrls`.
**Warning signs:** Any `signClearUrls` / `createSignedUrl` call reachable from `InterestedList`, `MakeOfferModal`, or the feed path.

### Pitfall 2: browse_feed RPC re-CREATE drops grants
**What goes wrong:** `CREATE OR REPLACE` of `browse_feed_for_viewer` with a changed return signature requires `DROP FUNCTION` first (return type change), which resets privileges. Forgetting to re-`revoke from anon / grant to authenticated` either errors or silently re-opens anon.
**Why it happens:** Adding 3 return columns changes the function signature.
**How to avoid:** Copy the exact `revoke ... from public; revoke ... from anon; grant ... to authenticated;` tail from `20260605120500_e10_browse_feed_filters.sql`. Run the security advisor after.
**Warning signs:** Advisor flags anon-executable, or the feed 403s for authenticated users.

### Pitfall 3: identity_revealed wired at only one lock site
**What goes wrong:** There are TWO lock transition RPCs that insert a lock + dispatch `new_match`: `match_accept_offer` (line 357-358) and `match_resolve_reciprocal` (line 538-541), both in `20260527127800`. Wiring only one means reciprocal matches never get the reveal notification.
**Why it happens:** The "lock path" feels singular.
**How to avoid:** Add the `identity_revealed` dispatch at BOTH sites, both times to both parties.
**Warning signs:** Reciprocal-match test (5b path) shows no `identity_revealed` notification.

### Pitfall 4: New em-dash in reveal copy
**What goes wrong:** Stop-slop violation. STATE.md:42 already tracks one known em-dash at `PostNightForm.tsx:315`; do not add more.
**How to avoid:** Reveal copy is fixed in UI-SPEC Copywriting Contract (lowercase, no em-dash): toast = `the face behind the night. say hi.`, headline = `you cooked.`, sub-line = `here's {first_name}.`, CTA = `slide in`.

### Pitfall 5: Ceremony double-fires or fires for an old match
**What goes wrong:** The ceremony should fire once, when this lock JUST fired (`justLocked`), not on every visit to a months-old match.
**How to avoid:** Gate the unblur ceremony on `justLocked` (already the `?just=1` / realtime-INSERT signal consumed by `MatchConfirmation`). On a return visit (`justLocked=false`), `RevealModal` opens to the clear photo with no entrance animation. The existing `LockDetail` "see their profile" button opens `RevealModal` on demand — keep that quiet.

## Code Examples

### signClearUrls (the pattern signBlurredUrls mirrors)
```typescript
// Source: apps/web/lib/after5/photos.ts:132
export async function signClearUrls(client: After5Client, paths: string[], ttl = 600): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ttl);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}
```

### The existing feed RPC creator join (host columns are already in scope)
```sql
-- Source: supabase/migrations/20260605120500_e10_browse_feed_filters.sql
-- The RPC already joins the creator profile:
from date_instances di
join profiles cr on cr.id = di.creator_id    -- cr.first_name, cr.age, cr.blurred_photo_url are IN SCOPE
join itineraries it on it.id = di.itinerary_id
-- To add the hint, extend the RETURNS TABLE (+3 cols) and SELECT cr.blurred_photo_url, cr.first_name, cr.age.
-- Project ONLY these 3 — never cr.id / cr.email / cr.clear_photo_url / cr.instagram.
```

### Storage policy that authorizes blurred reads (no new DDL)
```sql
-- Source: supabase/migrations/20260602130200_m6_profile_photos_storage.sql
create policy profile_photos_blurred_read_v2 on storage.objects for select
  using (
    bucket_id = 'profile-photos'
    and right(name, 12) = '_blurred.jpg'
    and auth.role() = 'authenticated'   -- ANY authenticated viewer; this is the privacy artifact
  );
```

### The post-lock reveal page already signs clear photos via the gate
```typescript
// Source: apps/web/app/matches/[lockId]/page.tsx
const rows = await listMyPhotos(supabase, counterpart.id);
photos = await signClearUrls(supabase, rows.map((r) => r.clear_path));
// Works ONLY because the pair is locked → profile_photos_clear_reveal_read storage policy
// passes match_reveal_allowed_pair(auth.uid(), counterpart.id). [VERIFIED: codebase]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase-4 pure-blind feed (no host identity at all) | D-01: blurred avatar + first name + age hint pre-match | This phase | `FeedNight` gains 3 fields; NightDetailSheet copy "host stays anonymous until you match" must soften to reflect name+age now showing |
| Reveal photo was a raw private path handed to `next/image` (broken) | M6: `signClearUrls` on the reveal page (`matches/[lockId]/page.tsx`) | M6 (shipped) | Clear photo signing is solved; this phase only adds the BLURRED equivalent + the animation |
| `RevealModal` opens statically on demand | D-04: animated unblur ceremony on `justLocked` | This phase | New framer-motion choreography; static open stays for return visits |

**Deprecated/outdated:**
- Legacy single-photo blur convention (`<uid>/blurred.jpg`) — superseded by per-photo `<uid>/<id>_blurred.jpg` (M6). `generate-blur/index.ts:21` `blurredPathFor()` is the source of truth. Read `profile_photos.blurred_path` / `profiles.blurred_photo_url` rather than reconstructing paths.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The feed page (`feed/page.tsx`, SSR, RLS'd) is the right place to sign the host blurred URL before passing to `SwipeDeck`. An alternative is signing inside the RPC is impossible (RPCs can't mint signed URLs), so signing must be app-side. | signBlurredUrls / FeedNight | LOW — signing must be app-side regardless; only the call-site placement is a planner choice |
| A2 | `dispatch_notification` allows `identity_revealed` through (it is not in the consent `if/elsif` chain, so `v_allowed` stays true). | identity_revealed dispatch | LOW — verified the gate code; a new type defaults permissive. But the planner should confirm whether `identity_revealed` SHOULD respect `matches_enabled` consent (product call). |
| A3 | The host hint can be projected blind-safely by widening `browse_feed_for_viewer` rather than a separate read. | FeedNight extension | LOW — the `cr` join already exposes the columns; widening is the minimal change. A separate read is the fallback if the planner wants to keep the feed RPC's return shape frozen. |
| A4 | `MakeOfferModal` shows (or could show) a host photo at rung 2. Not yet read in full. | rung-2 surfaces | MEDIUM — if the offer flow shows the CANDIDATE's photo (host viewing candidate), not the host's, then rung-2 "softer host blur" applies to the searcher-facing offer view, not the host triage view. Planner must confirm which party sees which photo at the offer stage. |

## Open Questions (RESOLVED)

1. **OQ1 — Which party sees the softened host face at rung 2?**
   - **RESOLVED:** `offers/[offerId]` is the searcher-side rung-2 surface. It currently renders the host `clear_photo_url` pre-lock — a leak this phase fixes (05-02 switches it to the signed blurred photo at `blur(3px)`). `InterestedList` is host candidate-triage gated by `match_reveal_allowed` / `match_host_can_see_candidate` and is explicitly NOT a reveal rung; it is left untouched.
   - Original analysis (for the record): `InterestedList` is the HOST's triage screen (host sees candidates who swiped in, via `match_host_can_see_candidate`). The candidate (searcher) sees the host's blurred photo on the feed/detail (rung 1) and on their own offer-received view. Rung 2 "softer host blur" is about the searcher seeing the HOST resolve more, which lands at `offers/[offerId]`.

2. **OQ2 — Should `identity_revealed` respect `matches_enabled` consent?**
   - **RESOLVED:** Yes. `identity_revealed` is added to the `matches_enabled` consent branch (sibling of `new_match`) in `dispatch_notification`, implemented in 05-03 Task 1. A recipient with `matches_enabled=false` receives no `identity_revealed` notification.
   - Original analysis (for the record): `dispatch_notification` previously let it through permissively; `new_match` respects `matches_enabled` and `identity_revealed` is a sibling beat, so it joins the same branch for consistency.

## Environment Availability

> Skipped sub-checks: this is a code/SQL phase on an already-running stack. Relevant tools:

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI (local stack) | Migration apply + advisor | Assumed ✓ (used in Phases 1–4) | per project | — |
| pnpm + Node ≥22 | Build/typecheck/test | ✓ | 9.12.0 / ≥22 | — |
| Playwright | E2E reveal-tier verification | ✓ 1.49.0 | installed | — |
| Vitest | Unit (signBlurredUrls, path helpers) | ✓ 2.1.8 | installed | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 (unit, `packages/*` Node + `apps/web` jsdom via `vitest.workspace.ts`) + Playwright 1.49.0 (E2E, `apps/web/e2e/*.spec.ts`) |
| Config file | `vitest.config.ts`, `vitest.workspace.ts`; Playwright config in `apps/web` |
| Quick run command | `pnpm vitest run packages/api-client apps/web/lib/after5` |
| Full suite command | `pnpm -w test` then `pnpm --filter web exec playwright test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| E15 | `signBlurredUrls` signs blurred paths, empty-array short-circuit, no reveal gate | unit | `pnpm vitest run apps/web/lib/after5/photos.test.ts` | ❌ Wave 0 (add `photos.test.ts`) |
| E15 | `FeedNight` carries the 3 host-hint fields; `browseFeed` maps them | unit | `pnpm vitest run packages/api-client/src/feed.test.ts` | ✅ extend existing `feed.test.ts` |
| E15 | feed RPC projects host hint blind-safely (no creator_id/email leak) | integration (SQL) | new migration test or manual psql against local | ❌ Wave 0 |
| E15 | Rung 1: NightCard shows blurred avatar + {name, age}, face unreadable | E2E visual @420px | `playwright test e2e/05-reveal-feed.spec.ts` | ❌ Wave 0 |
| E15 | Rung 2: offer surface less blurred than rung 1, experience-led | E2E visual | `playwright test e2e/05-reveal-offer.spec.ts` | ❌ Wave 0 |
| E15 | **Privacy invariant:** clear photo URL is NEVER present in feed/offer DOM or network pre-lock | E2E (assert no `clear` signed url in responses) | `playwright test e2e/05-reveal-feed.spec.ts` + `05-reveal-offer.spec.ts` | ❌ Wave 0 (critical — see below) |
| E16 | `identity_revealed` dispatched to both parties at `match_accept_offer` AND `match_resolve_reciprocal` | integration (extend 5b happy-path + reciprocal) | `playwright test e2e/5b-happy-path.spec.ts` | ✅ extend (assert notification row) |
| E16 | **Inverse consent (safety-critical):** recipient with `matches_enabled=false` receives NO `identity_revealed` notification on lock | integration | `playwright test e2e/05-reveal-ceremony.spec.ts` (or the 5b extension) | ❌ Wave 0 |
| E16 | Ceremony: unblur dissolve runs, toast fires, settles into ProfileCard | E2E visual | `e2e/05-reveal-ceremony.spec.ts` | ❌ Wave 0 |
| E16 | Reduced-motion: no blur animation, immediate clear + cross-fade, toast still fires | E2E (emulate `prefers-reduced-motion`) | `playwright test e2e/05-reveal-ceremony.spec.ts` | ❌ Wave 0 |

### The privacy-invariant test (the one that must not be skipped)
The most important automated check: assert that on the feed and offer surfaces, **no clear-photo signed URL is ever requested or rendered**. Implement as a Playwright network assertion — capture all `storage/v1/object/sign` requests on the feed + offer pages and assert every signed path ends in `_blurred.jpg`, never a bare `<uid>/<id>.jpg`. This directly verifies the privacy invariant rather than eyeballing blur strength.

### Sampling Rate
- **Per task commit:** `pnpm vitest run apps/web/lib/after5 packages/api-client`
- **Per wave merge:** full unit suite + the three reveal Playwright specs (`05-reveal-feed`, `05-reveal-offer`, `05-reveal-ceremony`)
- **Phase gate:** full suite green + visual-verify @420px (forced-local recipe) of all three rungs + reduced-motion + the privacy-invariant network assertion green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/web/lib/after5/photos.test.ts` — covers E15 `signBlurredUrls` (mirror nonexistent — `photos.ts` has no co-located test yet)
- [ ] `apps/web/e2e/05-reveal-feed.spec.ts` — covers E15 rung 1 (feed card + detail) AND the privacy-invariant network assertion on the feed/detail surfaces (carries the shared network helper)
- [ ] `apps/web/e2e/05-reveal-offer.spec.ts` — covers E15 rung 2 (offer surface less blurred, experience-led) AND the privacy-invariant network assertion on the offer surface
- [ ] `apps/web/e2e/05-reveal-ceremony.spec.ts` — covers E16 ceremony (unblur dissolve + toast), reduced-motion, AND the inverse-consent safety case (recipient with matches_enabled=false gets NO identity_revealed row)
- [ ] extend `packages/api-client/src/feed.test.ts` — assert the 3 new FeedNight fields
- [ ] extend `apps/web/e2e/5b-happy-path.spec.ts` (+ reciprocal path) — assert `identity_revealed` notification dispatched to both parties
- [ ] local SQL check (no automated harness for RPC return shape) — confirm widened `browse_feed_for_viewer` returns exactly the 3 hint columns and no extra identity

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth changes; reuses session/`auth.uid()` |
| V3 Session Management | no | Unchanged |
| V4 Access Control | **yes** | The reveal ladder IS access control. Pre-lock: only blurred objects readable (`profile_photos_blurred_read_v2`). Post-lock: clear readable iff `match_reveal_allowed_pair`. Feed hint scoped to 3 columns via DEFINER RPC. NO `USING(true)` on any policy this phase touches. |
| V5 Input Validation | minor | Feed RPC inputs unchanged; dispatch payloads are server-constructed jsonb |
| V6 Cryptography | no | Signed URLs use Supabase's `createSignedUrls` — never hand-roll signing |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Clear photo leaked pre-lock via offer surface | Information Disclosure | Offer/feed code calls only `signBlurredUrls`; privacy-invariant Playwright network assertion |
| Anon re-enabled when feed RPC re-CREATEd | Elevation of Privilege | Re-apply `revoke from anon / grant authenticated`; run security advisor after DDL |
| Feed RPC over-projects creator identity | Information Disclosure | Project exactly 3 hint columns; never `creator_id`/`email`/`clear_photo_url`/`instagram` |
| CSS blur removed in devtools to see "clear" face | Information Disclosure | Mitigated structurally — CSS blurs an already-downscaled-to-64px blurred asset; removing CSS reveals only the blurred artifact, not the face |
| `identity_revealed` dispatched to wrong/extra user | Spoofing | Dispatch only to the two lock participants (`cre`, `cand`) already resolved inside the DEFINER RPC |

**Note (gated prod-apply):** Both candidate migrations modify SECURITY DEFINER functions. Per CLAUDE.md secure-by-default + STATE.md:106: pin `search_path`, no `USING(true)`, run the Supabase security advisor after each DDL, local-green before batched prod-apply, do NOT auto-push to prod (`ufufmcpnysvwtutpbian`). DEFINER-executable advisor warnings are the app's established accepted pattern shared by all `match_*` RPCs.

## Sources

### Primary (HIGH confidence — codebase, file:line)
- `apps/web/lib/after5/photos.ts:132` — `signClearUrls` pattern + BUCKET, M6 multi-photo model (header comment)
- `packages/api-client/src/feed.ts:4` — `FeedNight` interface; `browseFeed` named-param RPC call
- `supabase/migrations/20260605120500_e10_browse_feed_filters.sql` — current `browse_feed_for_viewer` (14 cols, `cr` creator join, grant tail)
- `supabase/migrations/20260602130200_m6_profile_photos_storage.sql` — `profile_photos_blurred_read_v2` (permissive blurred read) + `profile_photos_clear_reveal_read` (gated clear read)
- `supabase/migrations/20260527126600_p5_profiles_revealed_policy.sql` — `match_reveal_allowed_pair` definition
- `supabase/migrations/20260527127400_p5_host_pre_offer_disclosure.sql` — `match_host_can_see_candidate` (host triage read)
- `supabase/migrations/20260527127800_p5_match_cohort_allowlist.sql:357,538` — the TWO lock RPCs + `new_match` dispatch sites (canonical redefinition)
- `supabase/migrations/20260525123600_p2_dispatch_notification.sql` — `dispatch_notification` consent/channel logic
- `supabase/migrations/20260603120000_gated_inbox_notification_types.sql` — `identity_revealed` enum (applied per STATE.md:85)
- `apps/web/app/matches/[lockId]/page.tsx` + `RevealModal.tsx` + `LockDetail.tsx` + `MatchConfirmation.tsx` — reveal surfaces + `justLocked` + reduced-motion pattern
- `apps/web/app/feed/page.tsx` + `NightCard.tsx` + `SwipeDeck.tsx` + `NightDetailSheet.tsx` — feed surfaces
- `supabase/functions/generate-blur/index.ts:8,21` — `blurParams` (64px downscale) + `blurredPathFor` (`<uid>/<id>_blurred.jpg`)
- `.planning/STATE.md:42,85,90,106` — em-dash finding, enum-applied note, E8 dispatch pattern, gated-prod-apply rule

### Secondary (MEDIUM confidence)
- `CLAUDE.md` — stack versions, secure-by-default conventions, design-system rules, stop-slop
- `05-UI-SPEC.md` — blur strengths, ceremony mechanics, copy contract (the approved design contract)

### Tertiary (LOW confidence)
- None — every claim grounded in code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps already installed and version-locked in `package.json`
- Architecture / wiring sites: HIGH — exact file:line for both lock RPCs, storage policies, signing pattern, feed RPC
- Pitfalls: HIGH — derived from the actual policy + RPC structure
- The two open questions (rung-2 party, consent gate): MEDIUM — flagged for discuss-phase/planner

**Research date:** 2026-06-04
**Valid until:** ~2026-07-04 (stable internal codebase; re-verify if `browse_feed_for_viewer` or the lock RPCs are re-CREATEd before planning)

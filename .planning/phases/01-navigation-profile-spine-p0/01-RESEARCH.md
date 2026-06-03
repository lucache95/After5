# Phase 1: Navigation & Profile Spine (P0) - Research

**Researched:** 2026-06-03
**Domain:** Next.js 15 App Router navigation chrome + profile-hub composition (BROWNFIELD, live-on-prod)
**Confidence:** HIGH (all findings verified by direct codebase inspection; no external libraries introduced)

> **Brownfield note:** This is an existing, live-on-prod Next.js 15 / Supabase app. Every recommendation below is an **enhance-in-place** or **reuse-existing** action. No scaffolding, no walking-skeleton, no new packages. All four E-items are nav/UI changes against code that already runs in production.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Repoint the "profile" tab to the EXISTING `/account` hub and enhance it — do NOT build a new `/profile` route. `/account` is already a real, well-built dating hub.
- **D-02:** Enhanced `/account` must show: identity (photo/name/age/city/verification), a dating-profile summary (bio/prompts/vibe), an "as others see it" self-view, and links to edit (`/account/profile`), preferences (new — D-07/E4), and notifications (`/account/notifications`). It must NOT render marketing/onboarding teaser content (strip the `/home` teaser association — F1).
- **D-03:** Render the self-view by reusing `apps/web/components/ProfileCard.tsx` in a preview mode ("preview my profile as others see it"). Reuse, don't rebuild.
- **D-04:** Retarget the "dates" tab from `/my-nights` → `/matches`. Surface "your posted nights" (`/my-nights`) from the profile hub / create flow, not the dates tab.
- **D-05:** Fix the profile tab target from `/home` → `/account`. Update both `BottomTabShell.tsx:24` and `UserMenu.tsx`.
- **D-06:** The `/account` → `/plan/i/${id}` dead link is OUT of this phase (re-scoped to Phase 7). Do not spend P0 effort on it.
- **D-07-nav:** Build a NEW shared `<DeepRouteHeader>` (back arrow + title) and mount it on every deep route AND guard/error terminal: `/matches/[lockId]`, `/matches/[lockId]/rate`, `/offers/[offerId]`, `/messages/[threadId]` (+ `/inbox/[threadId]` re-export), `/dates/[slug]/interested`, `/account/notifications`, plus link-less guard/error states. Do NOT mount the full `BottomTabShell` on deep routes — bottom nav stays on the 5 tab roots only.
- **D-08:** Back behavior must be deterministic (resolve to a sensible parent, not blind `history.back()`). Exact target per route is researcher/planner's call; no route may be a link-less terminal after this phase.
- **D-09:** Build a dedicated settings page at `/account/preferences` reachable from the profile hub, reusing the existing `/onboarding/preferences` form logic (age range / distance / gender / dealbreakers). Include the dating on/off toggle here (currently in `EnableDatingButton` on `/home`). One obvious "settings" destination; clean separation from identity display.

### Claude's Discretion

- Exact `<DeepRouteHeader>` API, title source per route, and back-target resolution.
- How to factor the shared preferences form out of `/onboarding/preferences` for reuse without breaking onboarding.
- Hub layout/section ordering on `/account` (follow DESIGN-SYSTEM.md, Barbiecore, mobile-first 420px).
- Whether `/home` remains a pre-dating first-session landing for not-yet-dating users (lean: keep it as landing, just stop pointing the profile tab at it — do not delete in P0).

### Deferred Ideas (OUT OF SCOPE)

- Chat↔profile↔night cross-links (header→profile, →night) — E18 / Phase 6. Phase 1 adds ONLY the back-header to the conversation route, not outbound cross-links.
- Profile stats (nights hosted / matches / response rate / reviews) — reliability/response-rate aggregation is E17 / Phase 6. Phase 1 shows identity + dating profile + content links; defer computed stats.
- `/account` → `/plan/i/` dead link + legacy-planner `/places`/`/vote` cleanup → Phase 7.
- Deleting `/home` entirely → not in P0; only decoupled from the profile tab.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-E1 | Universal nav chrome: back affordance on every deep route + guard/error terminal | New shared `<DeepRouteHeader>` client component + per-route static back-target map. All 6 deep routes + their link-less guard branches inventoried below with exact file paths, current header state, and recommended back targets. |
| REQ-E2 | Bottom-nav semantics: profile→hub, dates→/matches | Two single-line edits in `BottomTabShell.tsx` (lines 22, 24) + one array edit in `UserMenu.tsx` (line 29). Active-state `isActive()` logic already derives from `usePathname`; no further change needed. |
| REQ-E3 | Profile hub on existing `/account` (ISSUE #15) | `/account/page.tsx` already composes `profiles` + `saved_plans` server-side. Add identity header + dating-profile summary + `ProfileCard` self-view; strip teaser association (already mostly absent — `/account` is NOT the teaser, `/home` is). All required `profiles` columns confirmed to exist. |
| REQ-E4 | Editable dating preferences at `/account/preferences` | Extract `PreferencesStep` into a shared form component; new `/account/preferences/page.tsx` hydrates from the same `profiles` columns; reuse `savePreferences()` (already idempotent, writes the same flat columns); relocate `dating_enabled` toggle from `EnableDatingButton`. |
</phase_requirements>

## Summary

This phase is **pure navigation/UI surgery on a production codebase** — no new dependencies, no schema changes, no RPCs. Every needed library (Next.js `Link`/`usePathname`/`useRouter`, `lucide-react` icons, Barbiecore Tailwind tokens, `ProfileCard`, `savePreferences`) is already present and in active use. The four E-items decompose cleanly:

- **E2** (bottom-nav) is the smallest: 3 edits across 2 files. It is a hard dependency for E3 (the repointed tab needs a real destination) and should land first or alongside.
- **E1** (deep-route chrome) is a new shared `<DeepRouteHeader>` client component mounted into 6 page files plus their inline guard/error JSX branches. The key design decision is a **deterministic static back-target** per route (not `history.back()`), because every deep route can be entered cold via a notification deep-link or direct URL, where `history.back()` would exit the app.
- **E3** (profile hub) enhances the already-rich `/account/page.tsx` server component. All identity columns (`first_name`, `age`, `city`, `verification`, `clear_photo_url`, `vibe_tags`, `prompt_answers`, `pronouns`) and the dating-profile fields exist; the work is reading them and laying out the new sections, plus reusing `ProfileCard` for the self-view.
- **E4** (editable preferences) extracts the existing `PreferencesStep` form into a shared, mode-aware component and mounts it at a new `/account/preferences` route, reusing the already-idempotent `savePreferences()`. The only behavioral nuance: onboarding's form advances the onboarding step machine on submit; the account version must NOT — it just saves and stays.

**Primary recommendation:** Build `<DeepRouteHeader>` first (unblocks E1 across all routes), do the 3-edit E2 change, then extract a `PreferencesForm` shared component (E4) and enhance `/account` (E3) in parallel. Keep the conversation route's E1 change to the back-header ONLY — outbound cross-links are explicitly Phase 6.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Deep-route back chrome | Frontend (client component) | — | Pure presentation + client-side `Link`/navigation; no server or data involvement. `<DeepRouteHeader>` is `'use client'` only if it uses `useRouter`/`usePathname`; a pure-`Link` version can stay a server component (see Pattern 1). |
| Bottom-nav tab targets | Frontend (client component) | — | `BottomTabShell` is already `'use client'` (uses `usePathname`). Edits are to a static `href` map. |
| Profile-hub data composition | Frontend Server (SSR) | Database (RLS reads) | `/account/page.tsx` is an async server component reading `profiles`/`saved_plans` under RLS. Identity + dating summary are server-fetched, passed to client children. |
| Self-view rendering | Frontend (presentational) | — | `ProfileCard` is a pure presentational component; the hub passes it the viewer's own signed photo URLs + profile fields. |
| Preferences read/write | Frontend Server (read) + Frontend client (write) | Database (RLS) | SSR reads the `profiles` prefs columns; the client form writes them via `savePreferences()` (direct `profiles.update` under RLS, `auth.uid()`-scoped). No RPC. |
| Dating on/off toggle | Frontend (client) | Database (RLS + trigger) | `profiles.update({ dating_enabled })` under RLS; the DB age-gate trigger remains the hard enforcement (do not bypass). |

## Standard Stack

This phase introduces **zero new packages**. Everything is already installed and in active production use. The "stack" here is the in-repo primitives the planner must reuse rather than re-invent.

### Core (existing, reuse)
| Primitive | Location | Purpose | Why Standard |
|-----------|----------|---------|--------------|
| `Link` + `usePathname` + `useRouter` | `next/link`, `next/navigation` | Tab targets, back navigation, active-state | Already the sole nav mechanism app-wide (BottomTabShell, UserMenu, every page). [VERIFIED: codebase grep] |
| `lucide-react` `ArrowLeft` | `lucide-react@0.460.0` | Back-arrow icon for `<DeepRouteHeader>` | Already used for "back" on `/account/profile` (`ArrowLeft`, h-4 w-4) and across the app. [VERIFIED: account/profile/page.tsx:8,79] |
| `cn()` | `@/lib/cn` | Conditional Tailwind class merge | Mandated by CONVENTIONS.md; used everywhere. [CITED: CONVENTIONS.md] |
| `createClient()` (server) | `@/lib/supabase/server` | RLS-bound SSR reads for hub + prefs | Established auth-gated page pattern (`redirect('/login?next=...')`). [VERIFIED: account/page.tsx:11,43-49] |
| `ProfileCard` | `@/components/ProfileCard` | "As others see it" self-view (D-03) | Exact reuse target; read-only, takes `name/age/place/photos/vibe_tags/prompts`. [VERIFIED: ProfileCard.tsx] |
| `savePreferences()` | `@after5/api-client` (`packages/api-client/src/profile.ts:45`) | E4 persistence | Already idempotent `profiles.update`; writes the flat prefs columns the S5 feed pre-filter reads. [VERIFIED: profile.ts:45-61] |
| `BottomTabShell` | `@/components/BottomTabShell` | Tier-1 nav (E2 edit site) | The sole tier-1 nav. Tab `href` map at lines 20-25. [VERIFIED: BottomTabShell.tsx:20-25] |
| Barbiecore Tailwind tokens | `tailwind.config.ts` / DESIGN-SYSTEM.md | All new UI styling | `shell.base/accent/ink/pink`, `font-heading` (Caprasimo), `font-body` (Fredoka), 420px width, lowercase copy. [CITED: DESIGN-SYSTEM.md §1-4] |

### Supporting (existing, available if needed)
| Primitive | Location | When to Use |
|-----------|----------|-------------|
| `signClearUrls` / `listMyPhotos` | `@/lib/after5/photos` | If the hub self-view shows the full M6 photo gallery (owner read passes RLS). Already used on `/account/profile`. [VERIFIED: account/profile/page.tsx:10,35-36] |
| `Avatar` | `@/components/Avatar` | Compact identity-header thumbnail if not using the full ProfileCard photo carousel. [VERIFIED: UserMenu.tsx:18] |
| `parseAgePref()` | inline in `onboarding/preferences/page.tsx:9-16` | E4 must reuse this `int4range '[lo,hi)'` → inclusive `{min,max}` parser. **Extract it** rather than duplicate. [VERIFIED] |
| `framer-motion` / `vaul` / `sonner` | installed | Optional polish (toasts on save, drawer). Not required for P0. [CITED: CLAUDE.md stack] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Static per-route back target | `router.back()` / `history.back()` | REJECTED by D-08: deep routes are entered cold via notification deep-links; `history.back()` exits the app or lands on an unrelated page. Static targets are deterministic. |
| New `/profile` route | Enhance `/account` | REJECTED by D-01: `/account` is already the built hub. New route = duplicate + nav-orphan risk. |
| Duplicate the prefs form | Extract shared `PreferencesForm` | Duplication drifts (two validation paths, two save calls). Extraction is the locked D-09 approach. |

**Installation:** None. `pnpm install` not required — no new dependencies.

## Package Legitimacy Audit

**Not applicable.** This phase installs no external packages. All primitives are already in `package.json` and live in production. No slopcheck / registry verification needed.

*Confirmed: `grep` for new imports across the recommended approach yields only `next/*`, `lucide-react`, `@/lib/*`, `@/components/*`, `@after5/*` (workspace), all pre-existing.*

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────┐
                        │  BottomTabShell (Tier-1, 5 roots)    │
                        │  discover · dates · + · inbox ·       │
                        │  profile                              │
                        │   E2: dates → /matches (was          │
                        │       /my-nights)                     │
                        │       profile → /account (was /home)  │
                        └───────────────┬─────────────────────┘
                                        │ Link
              ┌─────────────────────────┼──────────────────────────┐
              ▼                         ▼                          ▼
      ┌──────────────┐         ┌──────────────────┐       ┌──────────────┐
      │  /matches    │         │  /account (HUB)  │ ◄─E3  │  /inbox      │
      │  (tab root)  │         │  SSR: profiles + │       │  (tab root)  │
      └──────┬───────┘         │  saved_plans     │       └──────┬───────┘
             │ Link            │  + identity hdr   │              │ Link
             ▼                 │  + ProfileCard    │              ▼
   ┌───────────────────┐       │    self-view      │     ┌──────────────────┐
   │ /matches/[lockId] │       │  + links:         │     │ /inbox/[threadId]│
   │   DEEP (no tab)   │       │    edit profile   │     │  (re-exports     │
   │  ◄── E1 header    │       │    preferences ───┼──┐  │   /messages/...) │
   └─────────┬─────────┘       │    notifications  │  │  │  ◄── E1 header   │
             │                 │    your nights    │  │  └──────────────────┘
             ▼                 └──────────────────┘  │
   ┌───────────────────┐                             │ E4
   │ /matches/[lockId] │   DEEP ROUTES (E1):         ▼
   │   /rate           │   each gets <DeepRouteHeader>  ┌────────────────────┐
   │  ◄── E1 header    │   (back arrow + title),        │ /account/preferences│
   └───────────────────┘   NO BottomTabShell.           │  NEW route          │
                                                         │  shared PreferencesForm
   ┌───────────────────┐   ┌─────────────────────────┐  │  + dating on/off    │
   │ /offers/[offerId] │   │ /dates/[slug]/interested │  │  writes profiles    │
   │  ◄── E1 header    │   │  ◄── E1 header          │  │  via savePreferences│
   └───────────────────┘   └─────────────────────────┘  └────────────────────┘

   ┌───────────────────────┐
   │ /account/notifications│  DEEP (no inbound link today) ◄── E1 header + linked from hub (E3)
   └───────────────────────┘

   Guard/error terminals ("not your match", "not your offer", "not your date",
   "couldn't load", rate "not yet"/"already rated"): each currently a LINK-LESS
   <main> with only an <h1>+<p>. E1 must add a back affordance to each.
```

### Recommended Component Structure
```
apps/web/components/
└── DeepRouteHeader.tsx        # NEW — back arrow + title; D-07-nav primitive

apps/web/app/account/
├── page.tsx                   # ENHANCE — identity header + dating summary + ProfileCard self-view (E3)
└── preferences/
    └── page.tsx               # NEW — SSR hydrate prefs, render shared form (E4)

apps/web/app/onboarding/steps/
└── PreferencesStep.tsx        # REFACTOR — extract form body into shared <PreferencesForm>

apps/web/components/ (or lib/after5/)
└── PreferencesForm.tsx        # NEW (extracted) — mode-aware: 'onboarding' advances step,
                               #   'account' just saves + toasts
```

### Pattern 1: `<DeepRouteHeader>` — prefer a server-component, static-`Link` back target (E1, D-08)

**What:** A small header (back arrow + title) mounted at the top of each deep route page. Back target is a **static prop**, resolved per-route by the page author, NOT `router.back()`.

**When to use:** Every deep route + every link-less guard/error branch.

**Why static `Link` over `router.back()`:** Deep routes are reachable cold from notification deep-links and direct URLs (confirmed: `redirect('/login?next=/matches/${lockId}')` patterns mean the route is a first-class entry point). `history.back()` from a cold entry exits the app or lands on `/login`. A static target is deterministic per D-08.

**Recommended API (Claude's discretion per CONTEXT):**
```tsx
// apps/web/components/DeepRouteHeader.tsx
// NEW — Tier-1 contextual back-chrome for deep (non-tab) routes (E1 / D-07-nav).
// Static back target (D-08): NO history.back() — deep routes are cold-entry points
// (notification deep-links), so blind back exits the app. Pure <Link>, so this can
// stay a server component (no 'use client') and drop into SSR pages directly.
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DeepRouteHeaderProps {
  /** Static parent route, e.g. '/matches'. Resolved by the page, not the browser. */
  backHref: string;
  /** Accessible label for the back control, e.g. 'back to matches'. */
  backLabel: string;
  /** Optional visible title for the flow. */
  title?: string;
  className?: string;
}

export function DeepRouteHeader({ backHref, backLabel, title, className }: DeepRouteHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[420px] items-center gap-3 px-4 py-3">
        <Link
          href={backHref}
          aria-label={backLabel}
          className="inline-flex h-11 w-11 -ml-2 items-center justify-center rounded-full text-shell-ink/70 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </Link>
        {title && (
          <h1 className="font-heading text-xl lowercase text-shell-ink">{title}</h1>
        )}
      </div>
    </header>
  );
}
```
Note the **44px tap target** (`h-11 w-11`) and `focus-visible` ring per DESIGN-SYSTEM accessibility rules. [CITED: CONVENTIONS.md, DESIGN-SYSTEM.md §4]

### Pattern 2: Mode-aware extracted preferences form (E4, D-09)

**What:** Pull the form body of `PreferencesStep` into a shared `<PreferencesForm>` that takes a `mode` discriminator. Onboarding passes `mode="onboarding"` (advances the step machine + routes to `/onboarding/phone`); account passes `mode="account"` (saves, toasts, stays).

**Why:** The two callers share 100% of the field UI and validation (`PreferencesInputSchema`) but differ ONLY in the post-save action. The current `handleContinue` couples save + `advanceOnboarding` + `router.push('/onboarding/phone')`. Splitting the post-save step out is the whole refactor.

```tsx
// Shared form — onboarding keeps step-advance, account just saves.
async function handleSave() {
  const parsed = PreferencesInputSchema.safeParse(candidate);
  if (!parsed.success) { /* error */ return; }
  const client = browserAfter5Client();
  await savePreferences(client, userId, parsed.data);   // identical for both modes
  if (mode === 'onboarding') {
    await advanceOnboarding(client, 'phone_verify');
    router.push('/onboarding/phone');
  } else {
    toast.success('preferences saved');                 // sonner; account mode stays put
    router.refresh();
  }
}
```
**Critical:** the `int4range` parse (`parseAgePref` in `onboarding/preferences/page.tsx:9-16`) must be **extracted and reused** by `/account/preferences/page.tsx` to hydrate `age_min/age_max` from the stored `age_pref`. Do not re-derive it. [VERIFIED: onboarding/preferences/page.tsx:9-16, profile.ts:55]

### Pattern 3: Enhance `/account` in-place (E3, D-02/D-03)

**What:** `/account/page.tsx` is already an async server component that `Promise.all`s `profiles` + `saved_plans`. Widen the `profiles` select to the identity + dating-summary columns, fetch the viewer's signed photos (reuse `listMyPhotos`/`signClearUrls`), and render: (1) identity header, (2) dating-profile summary, (3) `ProfileCard` self-view, (4) the existing loop links + NEW preferences/notifications links.

**Confirmed available `profiles` columns** (from `20260525120100_p0_profiles_dating.sql` + `/account/profile` select):
`first_name`, `age`, `city`, `neighborhood`, `verification` (verification_state enum), `clear_photo_url`, `vibe_tags`, `prompt_answers`, `pronouns`, `height_cm`, `occupation`, `socials`, `dating_enabled`, plus prefs `age_pref`, `gender_preferences`, `distance_pref_km`, `dealbreakers`. Bio + instagram live on `profiles_private` (`bio`, `instagram_handle`). [VERIFIED: migration + account/profile/page.tsx:25-29]

**ProfileCard prop mapping for the self-view** (D-03):
```tsx
<ProfileCard
  name={firstName}
  age={profile.age}
  place={profile.city ?? profile.neighborhood}
  pronouns={profile.pronouns}
  occupation={profile.occupation}
  height_cm={profile.height_cm}
  photos={signedClearUrls}            // from listMyPhotos + signClearUrls (owner read)
  vibe_tags={profile.vibe_tags ?? []}
  prompts={joinedPrompts}             // join prompt_answers → profile_prompts labels (same as lock page does)
  // instagram_handle intentionally omitted — self-view is a preview, not a contact card
/>
```
The prompt-label join pattern is already implemented on `matches/[lockId]/page.tsx:88-99` — replicate it. [VERIFIED]

### Anti-Patterns to Avoid
- **`history.back()` on deep routes:** breaks cold-entry (notification deep-links). Use static `backHref`. [D-08]
- **Mounting `BottomTabShell` on deep routes:** D-07-nav forbids it — it would imply a wrong active-tab state. Deep routes get `<DeepRouteHeader>` only.
- **Forking the prefs form:** duplicates validation + save logic; they will drift. Extract, don't copy. [D-09]
- **Re-deriving `age_pref` range parsing:** reuse `parseAgePref`; the `[lo,hi)` upper-exclusive convention is easy to get wrong.
- **Stripping `/account`'s working links during the E3 enhance:** the saved-plans wedge + sign-out + edit-profile link all work today; D-02 only forbids *marketing/onboarding teaser* content (which is on `/home`, not `/account`). Don't over-strip.
- **Editing files inside `.claude/worktrees/`:** those are locked parallel-agent worktrees (see Landmines). Only edit the main checkout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Profile self-view render | A new profile-preview component | `ProfileCard` (D-03) | Already handles photo carousel, identity, vibe chips, prompts, empty states, profile-tier tokens. |
| Preferences persistence | A new `profiles.update` call | `savePreferences()` | Already idempotent, handles the `age_pref` int4range literal, writes the exact columns the feed pre-filter reads. |
| Age-range parsing | A new regex | extracted `parseAgePref` | `[lo,hi)` upper-exclusive is subtle; one canonical parser. |
| Prompt-label join | New query | Copy the `matches/[lockId]/page.tsx:88-99` join | Identical shape (prompt_answers → profile_prompts labels). |
| Signed owner photos | New storage signing | `listMyPhotos` + `signClearUrls` | Already used on `/account/profile`; owner read passes RLS. |
| Back-arrow styling | Ad-hoc per page | `<DeepRouteHeader>` | One primitive, consistent 44px tap target + a11y, used across all 6 routes. |
| Dating on/off write | New toggle logic | Relocate `EnableDatingButton`'s `profiles.update({ dating_enabled })` | DB age-gate trigger is the hard gate; reuse the existing gated client write. |

**Key insight:** This phase's risk is NOT missing libraries — it's *re-inventing things that already exist three feet away*. The entire phase is wiring + layout over primitives that are already in production.

## Runtime State Inventory

> This is a nav/UI phase (no rename, no migration, no data mutation beyond user-initiated prefs writes). Most categories are N/A, but verified explicitly per protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — no data is renamed or migrated. E4 writes user prefs via the existing `savePreferences` path (same columns already written at onboarding). No new keys/IDs. | None |
| Live service config | **None** — no external service (n8n, Datadog, Tailscale, Cloudflare) references any string this phase touches. Verified: phase scope is in-repo TSX + one shared component. | None |
| OS-registered state | **None** — no cron, Task Scheduler, pm2, or launchd entry references nav routes. (Vercel Cron entries exist for `process-jobs` but are unrelated to this phase.) | None |
| Secrets/env vars | **None** — no new secrets. Existing Supabase RLS auth (`auth.uid()` session cookie) covers all reads/writes. | None |
| Build artifacts | **None new** — no package rename, no egg-info, no compiled binary. `<DeepRouteHeader>` and `<PreferencesForm>` are new source files picked up by Next.js automatically. | None |

**The canonical question — "after every file is updated, what runtime systems still have the old value cached?":** Nothing. The only persisted change this phase introduces is user-initiated preference edits, which flow through the already-live `savePreferences` write path. No stale state.

## Common Pitfalls

### Pitfall 1: `history.back()` traps on cold-entered deep routes
**What goes wrong:** A user taps a push notification → lands directly on `/matches/[lockId]` with an empty history stack → a back button calling `history.back()` exits the PWA or lands on `/login`.
**Why it happens:** Deep routes are first-class entry points (every one has `redirect('/login?next=...')`), not just in-app sub-pages.
**How to avoid:** Static `backHref` per route (Pattern 1, D-08). Recommended targets in the E1 inventory table below.
**Warning signs:** A back control that uses `useRouter().back()` or `onClick={() => history.back()}`.

### Pitfall 2: The account prefs form advancing the onboarding step machine
**What goes wrong:** Reusing `PreferencesStep` verbatim at `/account/preferences` would call `advanceOnboarding('phone_verify')` and `router.push('/onboarding/phone')` on save — yanking an established user into onboarding.
**Why it happens:** `handleContinue` couples save + step-advance + route-push (PreferencesStep.tsx:70-89).
**How to avoid:** Mode-aware extraction (Pattern 2). Account mode saves + toasts + `router.refresh()`, never advances.
**Warning signs:** `advanceOnboarding` or `/onboarding/phone` reachable from `/account/preferences`.

### Pitfall 3: `age_pref` int4range upper-exclusive off-by-one
**What goes wrong:** `savePreferences` writes `'[min,max]'` (inclusive literal) but the canonical stored form is `'[lo,hi)'` (upper-exclusive); naive parse shows the wrong max age.
**Why it happens:** Two conventions in play; `parseAgePref` already handles both `)` and `]` endings (onboarding/preferences/page.tsx:9-16).
**How to avoid:** Reuse `parseAgePref` to hydrate; let `savePreferences` own the write literal. Don't write your own.
**Warning signs:** Age "to" field showing one less than the user set, or a hand-rolled range regex.

### Pitfall 4: Over-stripping `/account` during the E3 enhance
**What goes wrong:** D-02 says "no marketing/onboarding teaser" — an over-eager strip deletes the working saved-plans wedge, edit-profile link, or sign-out.
**Why it happens:** Conflating `/home` (the teaser) with `/account` (the hub). The teaser is on `/home`; `/account` is already clean.
**How to avoid:** E3 is *additive* (identity header + summary + self-view + prefs/notifications links). Keep the existing working links. The only "strip" is ensuring the profile tab no longer routes through `/home`'s teaser (that's the E2/E5 tab-target change, not an `/account` deletion).
**Warning signs:** A diff to `/account/page.tsx` that removes more than it adds.

### Pitfall 5: Editing a worktree copy instead of the main checkout
**What goes wrong:** 28 locked agent worktrees exist under `.claude/worktrees/`, several touching `messages`/`profile` surfaces (e.g., `m6-comprehensive-profile`). Editing a worktree copy of `BottomTabShell.tsx` or `account/page.tsx` produces a change that never reaches main.
**Why it happens:** `grep`/glob can surface worktree paths.
**How to avoid:** Only edit files under `/Users/lucas/Projects/After5/apps/...` (the main checkout). Never under `.claude/worktrees/`.
**Warning signs:** A target path containing `.claude/worktrees/`.

## Code Examples

### E2 — the exact three edits (REQ-E2, D-04/D-05)
```tsx
// apps/web/components/BottomTabShell.tsx — TABS array (lines 20-25)
const TABS: Tab[] = [
  { key: 'discover', label: 'discover', href: '/feed', icon: Compass },
  { key: 'dates', label: 'dates', href: '/matches', icon: CalendarHeart },   // D-04: was '/my-nights'
  { key: 'inbox', label: 'inbox', href: '/inbox', icon: Inbox, badge: true },
  { key: 'profile', label: 'profile', href: '/account', icon: UserRound },    // D-05: was '/home'
];
// isActive() already derives active-tab from usePathname (line 27-29) — no change needed.
```
```tsx
// apps/web/components/UserMenu.tsx — MENU_ITEMS (line 28-33)
const MENU_ITEMS: { href: string; label: string }[] = [
  { href: '/account', label: 'your profile' },   // D-05: was '/home'
  { href: '/my-nights', label: 'your nights' },   // keep — surfaces posted nights per D-04
  { href: '/matches', label: 'matches' },
  { href: '/messages', label: 'messages' },
];
```

### E1 — deep-route header mount (server-component page, no client needed)
```tsx
// e.g. apps/web/app/matches/[lockId]/page.tsx — wrap the rendered output
return (
  <>
    <DeepRouteHeader backHref="/matches" backLabel="back to matches" />
    <LockDetail ... />
  </>
);

// Guard branch — add the SAME header to the link-less "not your match" <main>:
if (!lock || (lock.creator_id !== user.id && lock.matched_user_id !== user.id)) {
  return (
    <>
      <DeepRouteHeader backHref="/matches" backLabel="back to matches" />
      <main className="flex min-h-dvh flex-col items-center justify-center ...">
        <h1 ...>not your match</h1>
        <p ...>this one belongs to someone else.</p>
      </main>
    </>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Profile tab → `/home` marketing teaser | Profile tab → `/account` real hub | This phase (E2/E3) | Hub becomes nav-reachable; teaser decoupled. |
| Scattered ad-hoc `ArrowLeft` + `Link` per page | Single `<DeepRouteHeader>` primitive | This phase (E1) | Consistent chrome; no link-less terminals. |
| Write-once prefs at `/onboarding/preferences` | Editable at `/account/preferences` | This phase (E4) | Users can change who they see post-signup. |
| `history.back()` / no back | Deterministic static `backHref` | This phase (E1/D-08) | Cold-entry (notification) routes no longer trap. |

**Deprecated/outdated (do NOT touch this phase):**
- Profile *stats* (nights hosted/matches/response rate) — deferred to E17/Phase 6 (needs reliability aggregation that doesn't exist yet).
- Chat↔profile↔night outbound cross-links — deferred to E18/Phase 6. The conversation route gets the back-header ONLY.
- `/account` → `/plan/i/` dead link — Phase 7 (D-06).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ProfileCard` self-view should omit `instagram_handle` (preview, not contact card) | Pattern 3 | LOW — cosmetic; planner can include it if the founder wants the self-view to mirror the post-reveal card exactly. |
| A2 | `/account/preferences` should `router.refresh()` + sonner toast on save (account mode) rather than redirect | Pattern 2 | LOW — UX choice within D-09's "Claude's discretion"; trivially adjustable. |
| A3 | The `dating_enabled` toggle belongs in `/account/preferences` (per D-09) and should reuse `EnableDatingButton`'s gated write, but rendered as a labelled on/off control (not just a "turn on" CTA) since the account context includes already-on users | E4 | LOW-MEDIUM — `EnableDatingButton` only handles the OFF→ON case today; an account toggle also needs ON→OFF. Planner should confirm the "turn dating off" path's side effects (does it withdraw active offers? — verify before shipping the off-switch). |
| A4 | Recommended back targets (e.g. `/offers/[offerId]` → `/inbox`) are sensible parents | E1 inventory | LOW — adjustable per route; none are link-less after the change regardless. |

**A3 is the one to surface to the founder/planner:** turning dating OFF from the hub is a new capability not present today (the current button is ON-only). Its downstream effects (active offers, visibility in others' feeds) need a one-line product decision before build.

## Open Questions (RESOLVED)

> All three resolved before planning. Q1 (dating-OFF cascade) → LOCKED in 01-CONTEXT D-09 / planner A3: OFF = `dating_enabled=false` only, no offer/lock cascade (implemented in 01-03). Q2 (self-view photo source) → full gallery via `listMyPhotos` (01-04 interfaces). Q3 (messages back target) → `/inbox` (01-02). Do not re-open during execution.

1. **Does turning `dating_enabled` OFF need side-effect handling (withdraw active offers, hide from feeds)?**
   - What we know: `EnableDatingButton` only flips OFF→ON today; the DB age-gate trigger guards ON. Feed eligibility reads `dating_enabled`.
   - What's unclear: whether an explicit OFF from the hub should cascade (cancel pending offers/locks) or just stop new feed exposure.
   - Recommendation: For P0, ship OFF as "stop new exposure" only (simple `profiles.update`), and flag any cascade as a follow-up. Confirm with founder during planning (links to A3).

2. **Self-view photo source: full M6 gallery or single `clear_photo_url`?**
   - What we know: `/account/profile` already loads the M6 gallery via `listMyPhotos`/`signClearUrls` with a legacy single-photo fallback.
   - What's unclear: whether the hub self-view should show all gallery photos (carousel) or just the primary.
   - Recommendation: Reuse the exact `/account/profile` photo-load block (gallery + fallback) and pass all signed URLs to `ProfileCard` (it renders a carousel for >1). Low effort, matches "as others see it."

3. **`/matches` vs `/inbox` as the back target for `/messages/[threadId]`?**
   - What we know: `/inbox/[threadId]` re-exports `/messages/[threadId]`; the inbox absorbed the messages tab (#84). A thread can be reached from `/inbox` (in-tab) or from a `/matches/[lockId]` lock.
   - Recommendation: Back to `/inbox` (the tab that owns threads now). The lock→thread cross-link is Phase 6 (E18), so don't try to be context-aware here — a single static `/inbox` target satisfies E1/D-08. The `/inbox/[threadId]` re-export inherits the header automatically since it re-exports the same module — confirm the header is added to the shared page, not forked.

## Environment Availability

> Skipped — this phase has no external tool/service dependencies. It is in-repo TSX + one shared component, building on already-installed packages (Next.js, React, lucide-react, Tailwind, Supabase JS). No CLI, DB-provisioning, or network dependency is introduced. The existing dev stack (pnpm, Next dev server, Supabase local) already runs the app.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.8 (unit/component, jsdom for `apps/web`) + Playwright 1.49.0 (E2E) + jest-axe (a11y) |
| Config file | `vitest.config.ts`, `vitest.workspace.ts` (splits node vs jsdom), `apps/web/e2e/` for Playwright |
| Quick run command | `pnpm vitest run apps/web` (component/unit) |
| Full suite command | `pnpm turbo test` + `pnpm --filter web exec playwright test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-E2 | Profile tab href === `/account`, dates tab href === `/matches` | unit (component) | `pnpm vitest run apps/web/components/__tests__/BottomTabShell.test.tsx` | ❌ Wave 0 (UserMenu.test.tsx exists; add/extend BottomTabShell) |
| REQ-E2 | `UserMenu` "your profile" → `/account` | unit | `pnpm vitest run apps/web/components/__tests__/UserMenu.test.tsx` | ✅ extend existing |
| REQ-E1 | `<DeepRouteHeader>` renders an `ArrowLeft` link to `backHref` with a11y label; jest-axe clean | unit + a11y | `pnpm vitest run apps/web/components/__tests__/DeepRouteHeader.test.tsx` | ❌ Wave 0 |
| REQ-E1 | Each deep route (incl. guard branches) exposes a back link; route-smoke asserts no link-less terminal | E2E | `pnpm --filter web exec playwright test e2e/route-smoke.spec.ts` | ✅ extend (deep routes already in smoke list 206-208; add lockId/offerId/threadId/interested + assert a `back` affordance) |
| REQ-E3 | `/account` renders identity header (name/age/city/verification) + ProfileCard self-view + preferences link | component (mocked Supabase) + E2E | `pnpm vitest run apps/web/app/account/__tests__/` | ❌ Wave 0 |
| REQ-E3 | `/account` does NOT render marketing teaser content | component | same | ❌ Wave 0 |
| REQ-E4 | `/account/preferences` hydrates current prefs and saves without advancing onboarding | component + E2E | `pnpm vitest run apps/web/app/account/preferences/__tests__/` + smoke visit | ❌ Wave 0 |
| REQ-E4 | Shared `PreferencesForm` in `mode="account"` calls `savePreferences` but NOT `advanceOnboarding` | unit | mock `savePreferences`/`advanceOnboarding`, assert call counts | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run apps/web` (the touched component/page tests; < 30s).
- **Per wave merge:** `pnpm turbo test` + the `route-smoke` Playwright spec.
- **Phase gate:** Full Vitest + Playwright `route-smoke` green; jest-axe clean on the new `<DeepRouteHeader>` and enhanced `/account`; manual visual-verify (Playwright screenshot) of `/account`, `/account/preferences`, and one deep route per DESIGN-SYSTEM rubric (per the user's standing "visual-verify UI changes" rule).

### Observable success per E-item (Nyquist)
- **E1:** Playwright visits each deep route + each guard state (e.g., hit `/matches/<other-users-lock>` to trigger "not your match") and asserts a visible/clickable back control resolving to a real route. No `history.back()` in the DOM.
- **E2:** Component test reads the rendered tab `href` attributes; E2E clicks the profile tab and asserts URL becomes `/account`, clicks dates and asserts `/matches`.
- **E3:** Component test asserts identity fields + a `ProfileCard`-rendered region present; asserts absence of teaser strings. E2E: profile tab → `/account` shows the user's name/age.
- **E4:** E2E: from `/account`, click preferences → `/account/preferences`, change distance, save, reload, assert the new value persisted (round-trips through `savePreferences`); assert URL never entered `/onboarding/*`.

### Wave 0 Gaps
- [ ] `apps/web/components/__tests__/DeepRouteHeader.test.tsx` — covers REQ-E1 (render + a11y)
- [ ] `apps/web/components/__tests__/BottomTabShell.test.tsx` — covers REQ-E2 (href map) *(may not exist; verify and create)*
- [ ] `apps/web/app/account/__tests__/page.test.tsx` — covers REQ-E3 (identity + self-view + no-teaser)
- [ ] `apps/web/app/account/preferences/__tests__/page.test.tsx` — covers REQ-E4 (hydrate + save)
- [ ] `PreferencesForm` mode-discriminator unit test — covers REQ-E4 (no onboarding advance in account mode)
- [ ] Extend `apps/web/e2e/route-smoke.spec.ts` to assert back-affordance presence on deep routes + guard states
- [ ] Framework install: none — Vitest + Playwright already configured.

## Security Domain

> `security_enforcement: true`, ASVS Level 1, block on high. This is a UI/nav phase with one user-initiated write path (preferences). Most ASVS categories are inherited from existing infra, not newly introduced.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (inherited) | All new/edited authed pages keep the established gate: `createClient()` → `getUser()` → `redirect('/login?next=...')`. `/account/preferences` MUST replicate this (don't ship an ungated prefs page). [VERIFIED pattern: account/page.tsx:43-48] |
| V3 Session Management | no (inherited) | Supabase httpOnly session cookie + middleware refresh; unchanged. |
| V4 Access Control | yes | All reads/writes stay `auth.uid()`-scoped under RLS. `savePreferences` writes `profiles` filtered `.eq('id', userId)` where `userId` is the session user. Do NOT accept a `userId` from the client untrusted — derive it from `getUser()` server-side and pass to the client form (as PreferencesStep already does). |
| V5 Input Validation | yes | E4 form validates via existing `PreferencesInputSchema` (zod) before `savePreferences`. Reuse it; do not bypass. [VERIFIED: PreferencesStep.tsx:72] |
| V6 Cryptography | no | No new crypto. Signed photo URLs use existing Supabase storage signing. |

### Known Threat Patterns for Next.js 15 / Supabase RLS

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Ungated new route leaks profile data | Information Disclosure | `getUser()` + redirect gate on `/account/preferences` (mirror existing pages). |
| Client-supplied `userId` on the prefs write | Elevation of Privilege | Derive `userId` server-side from session; RLS `auth.uid()` is the backstop. `profiles.update().eq('id', userId)` + RLS policy keyed on `auth.uid()`. |
| Self-view leaking PII not meant for self-preview | Information Disclosure | Self-view is the user's OWN data (no cross-user read), so no reveal-gate concern; just don't surface `profiles_private` fields the founder doesn't want in the preview (A1). |
| Deep-route back link to an unauthorized parent | — | Back targets are public-within-app tab roots (`/matches`, `/inbox`), themselves auth-gated; no new exposure. |
| Turning dating OFF without cascade | Repudiation / stale state | Open Question #1 — confirm whether OFF must withdraw active offers; ship the simple flip for P0 if not. |

**No high-severity security blocker identified.** The single new write path reuses an existing validated, RLS-scoped, idempotent helper.

## Sources

### Primary (HIGH confidence — direct codebase inspection)
- `apps/web/components/BottomTabShell.tsx` (lines 20-29) — tab href map, isActive logic [VERIFIED]
- `apps/web/components/UserMenu.tsx` (lines 28-33) — MENU_ITEMS [VERIFIED]
- `apps/web/app/account/page.tsx` — hub composition (profiles + saved_plans), existing links [VERIFIED]
- `apps/web/components/ProfileCard.tsx` — self-view prop contract [VERIFIED]
- `apps/web/app/account/profile/page.tsx` — photo-load + profiles select pattern, existing ArrowLeft back [VERIFIED]
- `apps/web/app/onboarding/preferences/page.tsx` + `apps/web/app/onboarding/steps/PreferencesStep.tsx` — form + parseAgePref + save/advance coupling [VERIFIED]
- `apps/web/app/home/EnableDatingButton.tsx` — dating on/off write [VERIFIED]
- `apps/web/app/matches/[lockId]/page.tsx`, `/rate/page.tsx`, `offers/[offerId]/page.tsx`, `messages/[threadId]/page.tsx`, `inbox/[threadId]/page.tsx`, `dates/[slug]/interested/page.tsx`, `account/notifications/page.tsx` — deep-route header state + guard branches [VERIFIED]
- `packages/api-client/src/profile.ts` (45-99) — savePreferences, advanceOnboarding [VERIFIED]
- `supabase/migrations/20260525120100_p0_profiles_dating.sql` — profiles columns (age, city, verification, dating_enabled, age_pref, gender_preferences, distance_pref_km, dealbreakers) [VERIFIED]
- `.planning/REQUIREMENTS.md`, `.planning/codebase/CONCERNS.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `CLAUDE.md`, `docs/superpowers/DESIGN-SYSTEM.md` [CITED]

### Secondary (MEDIUM confidence)
- `git worktree list` — confirmed 28 locked agent worktrees (landmine context for Pitfall 5) [VERIFIED via git]
- `apps/web/e2e/route-smoke.spec.ts` (lines 206-263) — existing deep-route smoke coverage [VERIFIED]

### Tertiary (LOW confidence)
- None. No external-source claims; this phase introduces no new packages or APIs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every primitive verified present in the repo; zero new packages.
- Architecture: HIGH — patterns derived directly from existing working code (account/profile photo load, lock-page prompt join, BottomTabShell active-state).
- Pitfalls: HIGH — each is grounded in a specific verified code coupling (history.back cold-entry, advanceOnboarding coupling, age_pref convention, worktree locks).
- Security: HIGH — single write path reuses validated RLS-scoped helper; auth gate pattern is established.

**Landmine flag (CONCERNS.md / worktrees):** 28 locked agent worktrees under `.claude/worktrees/` (notably `m6-comprehensive-profile`) touch profile/messages surfaces. The Mobile-UX fleet (per MEMORY) has committed-not-merged work overlapping `messages`/`my-nights`/`profile`. **Conflict risk:** if that fleet merges between planning and execution, `account/page.tsx`, `BottomTabShell.tsx`, or the messages route may move under this phase's feet. Recommendation: the planner should add a Wave-0 "rebase/reconcile check" — confirm `main` is the intended base and that no pending merge re-touches these exact files before editing. Only ever edit the main checkout, never a worktree copy.

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (stable — in-repo, no fast-moving external deps; but re-verify file paths if the mobile-UX fleet merges first).

---
phase: 01-navigation-profile-spine-p0
verified: 2026-06-03T00:00:00Z
status: passed
score: 4/4
overrides_applied: 0
deferred:
  - truth: "Profile hub shows stats (nights hosted / matches / response rate / reviews)"
    addressed_in: "Phase 6"
    evidence: "ROADMAP.md Phase 6 SC1: 'A reliability_score is computed from match_ratings and surfaced on the badge'; CONTEXT.md deferred decision: 'Profile stats (nights hosted / matches / response rate / reviews) — ISSUE #15 lists these, but reliability/response-rate aggregation is E17 / Phase 6. Phase 1 can show identity + dating profile + content links; defer computed stats to when E17 lands.'"
---

# Phase 1: Navigation & Profile Spine (P0) — Verification Report

**Phase Goal:** Every deep route has a way back and the profile tab lands on a real, editable profile — the user is never trapped and can manage their dating identity.
**Verified:** 2026-06-03
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | From any deep route and guard/error terminal the user can navigate back and reach bottom nav — no link-less dead-ends | VERIFIED | `DeepRouteHeader` mounted on all 6 routes + all guard/error branches with static `backHref` (no `history.back`); confirmed across `/matches/[lockId]` (2 guards), `/matches/[lockId]/rate` (not-yet + already-rated + form), `/offers/[offerId]` (not-your-offer + AccountGate + happy path), `/messages/[threadId]` (not-your-conversation + happy path), `/dates/[slug]/interested` (not-your-date + happy path), `/account/notifications`. `/inbox/[threadId]` is a re-export of the messages page, inheriting the header. No `history.back` or `router.back` found in any of these files. |
| 2 | "Profile" tab → `/account`; "dates" tab → `/matches` (not `/my-nights`) | VERIFIED | `BottomTabShell.tsx` TABS: `dates.href = '/matches'`, `profile.href = '/account'`. `UserMenu.tsx` MENU_ITEMS[0]: `href: '/account', label: 'your profile'`. No `/home` or `/my-nights` remain in either nav component. |
| 3 | Profile hub shows identity + dating profile + self-view ("as others see it") + edit/preferences/notifications links; no marketing/teaser | VERIFIED | `account/page.tsx` renders: identity block (Polaroid + name/age/city/pronouns + verified/unverified chip), dating profile summary (bio + vibe chips + up to 2 prompts, or an authored empty-state), `SelfViewTrigger` → `SelfViewSheet` (reuses `ProfileCard`), SECONDARY links array (`/account/profile`, `/account/preferences`, `/account/notifications`). Grep confirms: zero `welcome`, `get started`, `EnableDating`, `teaser` strings. No computed stats — correctly deferred to E17/Phase 6 (see Deferred Items). |
| 4 | Logged-in user can edit age/distance/gender/dealbreakers + toggle dating on/off after signup | VERIFIED | `PreferencesForm.tsx` (mode-aware): age-from/to inputs, distance slider, gender chips (I'm a / show me), dealbreakers chips, `DatingToggle` (`dating_enabled` only — A3 semantics). `/account/preferences/page.tsx`: auth-gated (`redirect('/login?next=/account/preferences')`), SSR-hydrates prefs + `dating_enabled`, mounts `DeepRouteHeader backHref="/account"` + `<PreferencesForm mode="account">`. `parseAgePref.ts` handles upper-exclusive `[lo,hi)` correctly. |

**Score:** 4/4 truths verified

---

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Computed profile stats (nights hosted / matches / response rate / reviews) | Phase 6 | ROADMAP.md Phase 6 SC1 covers `reliability_score` from `match_ratings`; CONTEXT.md §Deferred explicitly scopes this to E17/Phase 6 |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/components/DeepRouteHeader.tsx` | Shared static-Link back-chrome primitive | VERIFIED | 53 lines; pure server component, no `'use client'`, no `history.back`; props: `backHref`, `backLabel`, optional `title`, optional `right`; `<Link href={backHref} aria-label={backLabel}>` |
| `apps/web/components/BottomTabShell.tsx` | dates→`/matches`, profile→`/account` | VERIFIED | TABS array: `dates.href='/matches'`, `profile.href='/account'`; no `/home`, no `/my-nights` |
| `apps/web/components/UserMenu.tsx` | "your profile" → `/account` | VERIFIED | `MENU_ITEMS[0]: { href: '/account', label: 'your profile' }`; no `/home` reference |
| `apps/web/app/account/page.tsx` | Identity-forward profile hub | VERIFIED | Server component; fetches profile + bio + photos + prompts; renders identity, dating summary, SelfViewTrigger, SECONDARY links, LOOP links; no teaser content |
| `apps/web/components/SelfViewSheet.tsx` | Vaul drawer reusing ProfileCard | VERIFIED | `'use client'`; `<Drawer.Root>`; renders `<ProfileCard>` with owner's signed photos; no `instagram_handle` (A1) |
| `apps/web/components/SelfViewTrigger.tsx` | Thin client boundary for sheet open state | VERIFIED | `'use client'`; owns `useState(false)` for open; renders trigger button + `<SelfViewSheet>` |
| `apps/web/components/PreferencesForm.tsx` | Mode-aware shared form + dating toggle | VERIFIED | `mode: 'onboarding' \| 'account'`; account mode: `toast.success + router.refresh()`, never `advanceOnboarding`; `DatingToggle` inlined with A3 semantics (`dating_enabled` only) |
| `apps/web/app/account/preferences/page.tsx` | Auth-gated settings route | VERIFIED | `force-dynamic`; `redirect('/login?next=/account/preferences')`; SSR hydrates prefs + `dating_enabled`; mounts `DeepRouteHeader title="preferences" backHref="/account"`; renders `<PreferencesForm mode="account">` |
| `apps/web/lib/after5/parseAgePref.ts` | Canonical int4range parser | VERIFIED | Handles `[lo,hi)` (upper-exclusive, subtracts 1) and `[lo,hi]` (inclusive); fallback to `{min:25, max:40}` on bad input |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `/matches/[lockId]/page.tsx` | `/matches` | `DeepRouteHeader backHref="/matches"` | WIRED | Happy path + 2 guard branches all carry the header |
| `/matches/[lockId]/rate/page.tsx` | `/matches/[lockId]` | `DeepRouteHeader backHref={\`/matches/${lockId}\`}` | WIRED | 3 branches: not-yet, already-rated, form — all have the header |
| `/offers/[offerId]/page.tsx` | `/inbox` | `DeepRouteHeader backHref="/inbox"` | WIRED | not-your-offer + AccountGate + happy path — all 3 have the header |
| `/messages/[threadId]/page.tsx` | `/inbox` | `DeepRouteHeader backHref="/inbox"` | WIRED | not-your-conversation + happy path |
| `/inbox/[threadId]/page.tsx` | inherits | re-export of messages page | WIRED | `export { default, dynamic } from '../../messages/[threadId]/page'` |
| `/dates/[slug]/interested/page.tsx` | `/my-nights` | `DeepRouteHeader backHref="/my-nights"` | WIRED | not-your-date + happy path |
| `/account/notifications/page.tsx` | `/account` | `DeepRouteHeader backHref="/account"` | WIRED | Single branch |
| `/account/preferences/page.tsx` | `/account` | `DeepRouteHeader backHref="/account"` | WIRED | `title="preferences"` present |
| `account/page.tsx` SelfViewTrigger | `SelfViewSheet` → `ProfileCard` | props passed from server to client child | WIRED | Server fetches `listMyPhotos` + `signClearUrls`; passes signed URLs + fields to `SelfViewTrigger`; `SelfViewSheet` renders `ProfileCard` |
| `PreferencesForm.tsx` (account mode) | `savePreferences` | `browserAfter5Client()` + `savePreferences(client, userId, data)` | WIRED | `DatingToggle` writes `{ dating_enabled: next }` only (A3) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `account/page.tsx` identity block | `profile`, `bio`, `selfPhotos`, `prompts` | `supabase.from('profiles').select(...)`, `profiles_private`, `listMyPhotos + signClearUrls`, `profile_prompts` | Yes — real DB queries, no static returns | FLOWING |
| `account/preferences/page.tsx` | `p` (prefs), `age`, `initial` | `supabase.from('profiles').select('gender, gender_preferences, age_pref, distance_pref_km, dealbreakers, dating_enabled')` | Yes — real DB query | FLOWING |
| `PreferencesForm.tsx` DatingToggle | `enabled` | Hydrated from server-fetched `dating_enabled` prop; writes via `client.from('profiles').update(...)` | Yes — real read+write | FLOWING |
| `SelfViewSheet` → `ProfileCard` | `photos`, identity fields | Passed from server via `SelfViewTrigger` props (signed URLs from `listMyPhotos`) | Yes — real signed URLs | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — all core behaviors verified via code reading + the prompt states typecheck 6/6 clean, vitest 485/485 pass, onboarding regression 42 pass. No runnable server checks required to confirm file-level wiring (all key paths verified at levels 1-4).

---

### Probe Execution

No probes declared or conventional probe scripts found for this phase.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REQ-E1 | 01-02-PLAN.md | Universal nav chrome on every deep route and guard/error terminal | SATISFIED | `DeepRouteHeader` mounted on 6 routes + all guard/error branches; static `backHref`; no `history.back`; `/inbox/[threadId]` re-exports messages page |
| REQ-E2 | 01-01-PLAN.md | Bottom-nav semantics: dates→`/matches`, profile→`/account` | SATISFIED | `BottomTabShell.tsx` TABS confirmed; `UserMenu.tsx` confirmed; no `/home`/`/my-nights` in nav |
| REQ-E3 | 01-04-PLAN.md | Profile hub: identity + dating profile + self-view + edit/prefs/notifications links; no teaser | SATISFIED | `account/page.tsx` verified at all 4 levels; deferred stats explicitly in scope of Phase 6 |
| REQ-E4 | 01-03-PLAN.md | Editable age/distance/gender/dealbreakers + dating on/off from profile hub post-signup | SATISFIED | `PreferencesForm` + `/account/preferences` page + A3 `DatingToggle` wired end-to-end |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/web/app/error.tsx` | 40 | `href="/home"` — global error boundary links to `/home` rather than a primary tab root | INFO | `/home` is a real, nav-equipped route (has `BottomTabShell`), so this is not a link-less dead-end. The error boundary is outside the 6 deep routes scoped to E1; `/home` still exists as the pre-dating landing page. Low impact — not a P0 blocker, but consider updating to `/feed` or `/account` in Phase 7 cleanup alongside the legacy-planner sweep. |

No `TBD`, `FIXME`, or `XXX` markers found in any phase-modified file.

---

### Human Verification Required

**None.** All success criteria verified programmatically. The visual-verify (420px Playwright, 2026-06-03) was performed by the executor and declared PASSED for: hub, self-view sheet, preferences (A3 "pause dating" control + correct `[25,45)→44` age parse), and `DeepRouteHeader` on `/account/notifications`.

---

### Minor Polish Finding (LOW — not a blocker)

**DeepRouteHeader title blank on `/account/notifications`:**
- `/account/preferences/page.tsx` passes `title="preferences"` to `DeepRouteHeader` — the sticky header shows the page name in the masthead.
- `/account/notifications/page.tsx` passes **no** `title` prop — the sticky header shows only the back arrow, no visible page name in the masthead area.
- This is an intentional a11y choice (the page has its own `<h1>notifications</h1>` below, preserving one-`<h1>`-per-surface); however it creates a visual inconsistency between the two sibling deep routes.
- **Verdict:** LOW polish gap. The page is not a dead-end; navigation works correctly. The `<h1>` below the header makes the page title visible. No user is trapped. Recommend aligning to `title="notifications"` in a future cleanup pass.

---

### Gaps Summary

No blocking gaps. All 4 success criteria are met. One item (computed stats) is explicitly deferred to Phase 6/E17, documented in the CONTEXT.md deferred decisions and covered by Phase 6 SC1. The one minor anti-pattern (`error.tsx` → `/home`) is out of E1 scope (global error boundary, not one of the 6 named deep routes) and `/home` is a navigated page not a dead-end.

---

_Verified: 2026-06-03_
_Verifier: Claude (gsd-verifier)_

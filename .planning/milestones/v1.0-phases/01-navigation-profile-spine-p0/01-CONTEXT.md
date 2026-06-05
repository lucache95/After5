# Phase 1: Navigation & Profile Spine (P0) - Context

**Gathered:** 2026-06-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the app never trap the user, and make the "profile" tab land on a real, editable profile identity. Delivers the P0 navigation/profile spine: audit items **E1** (universal back-chrome on deep routes), **E2** (fix bottom-nav semantics), **E3** (profile hub — ISSUE #15), **E4** (editable dating preferences).

**In scope:** back-affordance on every deep route + guard/error terminal; profile-tab and dates-tab retargeting; profile hub built on the existing `/account`; self-view; a settings surface for dating preferences + dating on/off.

**Out of scope (own phases):** loop-closure / lifecycle (Phase 2), host controls / RPCs (Phases 2–3), filters (Phase 4), reveal ladder (Phase 5), chat↔profile↔night wiring (Phase 6 — E18; Phase 1 only fixes nav-chrome on the conversation route, not the cross-links). Deleting `/home` outright (only decouple it from the profile tab).
</domain>

<decisions>
## Implementation Decisions

### Profile hub (E3 / ISSUE #15)
- **D-01:** Repoint the "profile" tab to the EXISTING `/account` hub and enhance it — do NOT build a new `/profile` route. Live-verify confirmed `/account` is already a real, well-built dating hub (links to feed/matches/my-nights); E3 is an enhance, not a from-scratch build.
- **D-02:** The enhanced `/account` hub must show: identity (photo/name/age/city/verification), a dating-profile summary (bio/prompts/vibe), an "as others see it" self-view, and links to edit (`/account/profile`), preferences (new — see D-07), and notifications (`/account/notifications`). It must NOT render marketing/onboarding teaser content (strip the `/home` teaser association — F1).
- **D-03:** Render the self-view by reusing the existing `ProfileCard` component (`apps/web/components/ProfileCard.tsx`, currently only in the reveal modal) in a preview mode — "preview my profile as others see it." Reuse, don't rebuild.

### Bottom-nav semantics (E2)
- **D-04:** Retarget the "dates" tab from `/my-nights` → `/matches` (the searcher's matched/locked dates — "dates you're going on"). Surface "your posted nights" (`/my-nights`) from the profile hub / create flow, not the dates tab.
- **D-05:** Fix the profile tab target from `/home` → `/account` (per D-01). Update both `BottomTabShell.tsx:24` and `UserMenu.tsx`.
- **D-06:** The `/account` → `/plan/i/${id}` dead link is OUT of this phase — re-scoped to Phase 7 legacy-planner cleanup (live-verify C10 = NOT_REPRO for the dating flow; it only manifests for slug-less legacy planner data). Do not spend P0 effort on it.

### Deep-route nav chrome (E1)
- **D-07-nav:** Build a NEW shared contextual back-header primitive (e.g. `<DeepRouteHeader>` with back arrow + title) and mount it on every deep route AND guard/error terminal: `/matches/[lockId]`, `/matches/[lockId]/rate`, `/offers/[offerId]`, `/messages/[threadId]` (+ `/inbox/[threadId]` re-export), `/dates/[slug]/interested`, `/account/notifications`, and the link-less guard/error states ("not your match/date", "couldn't load", reciprocal errors). Do NOT mount the full `BottomTabShell` on deep routes — bottom nav stays on the 5 tab roots only (these are focused flows, not tab destinations; bottom nav would imply wrong active-tab state).
- **D-08:** Back behavior should be deterministic (resolve to a sensible parent, not blind `history.back()` which can exit the app) — exact target per route is planner/researcher's call, but no route may be a link-less terminal after this phase.

### Editable dating preferences (E4)
- **D-09:** Build a dedicated settings page at `/account/preferences` reachable from the profile hub, reusing the existing `/onboarding/preferences` form logic (age range / distance / gender / dealbreakers). Include the dating on/off toggle here (currently buried in `EnableDatingButton` on `/home`). One obvious "settings" destination; clean separation from identity display.

### Claude's Discretion
- Exact `<DeepRouteHeader>` API, title source per route, and back-target resolution.
- How to factor the shared preferences form out of `/onboarding/preferences` for reuse without breaking onboarding.
- Hub layout/section ordering on `/account` (follow DESIGN-SYSTEM.md, Barbiecore, mobile-first 420px).
- Whether `/home` remains a pre-dating first-session landing for not-yet-dating users (lean: keep it as landing, just stop pointing the profile tab at it — do not delete in P0).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope source (the E-queue)
- `docs/superpowers/reports/2026-06-03-MVP-AUDIT.md` §E (E1–E4 definitions), §B (Critical #6/#7/#8, High #9/#16/#17), §C (dead-ends), §F (#1 strip teaser from profile, #2 delete orphaned `account/ProfileForm.tsx`) — the authoritative requirements for this phase.
- `docs/superpowers/reports/2026-06-03-LIVE-NAV-VERIFY.md` — live verdicts: C4/C7/C8 nav dead-ends CONFIRMED; D11 dates-tab→/my-nights CONFIRMED; D12 profile-tab→/home CONFIRMED; new-issue #3 (`/account` is a real nav-orphaned hub — the cheap E3 path); C10 NOT_REPRO (the re-scope in D-06).
- `.planning/REQUIREMENTS.md` — REQ-E1..REQ-E4 + traceability.
- `.planning/intel/decisions.md`, `.planning/intel/context.md` — ISSUE #15 expected contents, top-3 gaps, guardrails.

### Design system (MANDATORY for all UI)
- `docs/superpowers/DESIGN-SYSTEM.md` — Barbiecore, three-tier color, gesture motion, display font, 420px mobile-first. Every new surface (hub, header, preferences page) follows this.

### Existing surfaces to read
- `apps/web/components/BottomTabShell.tsx` (tab definitions — lines 21–24 are the targets to fix), `apps/web/components/UserMenu.tsx`, `apps/web/app/account/page.tsx` (the hub to enhance), `apps/web/components/ProfileCard.tsx` (self-view reuse), `apps/web/app/account/profile/page.tsx` (the editor), `apps/web/app/onboarding/preferences/page.tsx` (preferences form to reuse), `apps/web/app/home/` (teaser to decouple).

### Codebase maps
- `.planning/codebase/STRUCTURE.md` (route map), `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md` (design-system + RLS conventions), `.planning/codebase/CONCERNS.md`.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/web/app/account/page.tsx` — already the dating hub (LOOP = feed/matches/my-nights, saved plans below). Enhance in place for E3.
- `apps/web/components/ProfileCard.tsx` — read-only profile render; reuse for the "as others see it" self-view.
- `apps/web/app/onboarding/preferences/page.tsx` — existing age/distance/gender/dealbreakers capture; extract the form for `/account/preferences`.
- `apps/web/app/home/EnableDatingButton.tsx` — the dating on/off toggle to relocate into preferences.
- `apps/web/components/BottomTabShell.tsx` — the sole tier-1 nav; tab `href` map is the E2 fix site.

### Established Patterns
- App Router server components + `createClient` (server) for auth-gated pages (`redirect('/login?next=...')`), Barbiecore tokens (`shell.*`, `font-heading/body`), 420px phone width, lowercase dry copy. Follow these for new surfaces.
- No canonical back-button/header component exists yet (only scattered `router.back()` / ArrowLeft usages) — E1 introduces the shared primitive.

### Integration Points
- `BottomTabShell` tab targets + `UserMenu` (E2). New `<DeepRouteHeader>` mounted into 6 deep-route layouts/pages + guard states (E1). New `/account/preferences` route + a link from the hub (E4). Hub enhancements consume `profiles` row + `ProfileCard` (E3).
</code_context>

<specifics>
## Specific Ideas

- Vision framing for the hub: it's the user's "dating home" / identity — not a settings dump and not a marketing page. Identity-forward, with edit/settings/notifications as clear secondary links.
- "Dates" = dates you're going ON (matched), not nights you posted — that retarget is the founder's explicit IA intent.
</specifics>

<deferred>
## Deferred Ideas

- Chat↔profile↔night cross-links (header→profile, →night) — that's E18 / Phase 6. Phase 1 only adds the back-header to the conversation route, not the outbound cross-links.
- Profile stats (nights hosted / matches / response rate / reviews) — ISSUE #15 lists these, but reliability/response-rate aggregation is E17 / Phase 6. Phase 1 can show identity + dating profile + content links; defer computed stats to when E17 lands.
- `/account` → `/plan/i/` dead link + legacy-planner `/places`/`/vote` cleanup → Phase 7.
- Deleting `/home` entirely → not in P0; only decoupled from the profile tab here.

### Reviewed Todos (not folded)
None — no matching pending todos.
</deferred>

---

*Phase: 1-Navigation & Profile Spine (P0)*
*Context gathered: 2026-06-03*

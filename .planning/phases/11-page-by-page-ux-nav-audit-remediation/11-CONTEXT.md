# Phase 11: Page-by-Page UX & Nav Audit + Remediation - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning
**Mode:** mvp — audit then prioritized remediation (nav/traps first, brand second, cosmetic deferred). Not a redesign.

<domain>
## Phase Boundary
The last v2.0 phase. UX-01: an empirical, browser-driven audit of every route against the design
system + a nav/flow rubric → a severity-scored findings inventory. UX-02: remediate the findings,
prioritized (nav gaps/traps/missing-back first, brand-consistency second, cosmetic deferred).

**Environment reality (discovered 2026-06-05):** the Playwright **MCP** browser is network-isolated
in After5 sessions (can't reach localhost or public URLs), so the live interactive loop is
unavailable here. The audit uses **scripted Playwright** (`CI=1 npx playwright test`, which boots its
own server) as a collector — captures screenshot @420px + console errors + failed network +
nav-affordance per route — and Claude reviews/judges the evidence into the findings. Recipe:
`docs/superpowers/playwright-authed-flow.md`.

**In scope:** every navigable route (60 page.tsx) + shared nav chrome. NOT new features.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Primary path (from /gsd discuss, accepted)
- Audit is empirical/browser-driven (scripted Playwright in this env), authed via local PKCE+Mailpit (`loginAs`, QA acct lucache95@gmail.com), @420px mobile-first.
- Coverage: prioritize the navigable surface — public (/ , /login), the core dating loop (/feed, /create, /create/generate, /account, /account/preferences, /matches, /my-nights, /inbox, /nights/new, /places), and the deep/ID routes (/matches/[lockId], /messages/[threadId], /offers/[offerId], /places/[slug], /dates/[slug]/interested) via minimal seeded fixtures.
- Per-route checklist: layout/overflow · broken/flashing images · console errors · failed 4xx/5xx network · dead/no-op buttons · broken nav / traps / missing back-up · @420px parity · a11y · brand/DESIGN-SYSTEM drift.

### Area 2 — Findings + remediation
- UX-01 output: a severity-scored findings inventory (bug · route · repro · screenshot · severity) + screenshots in docs/superpowers/audits/.
- UX-02: fix BLOCKER/HIGH nav gaps (missing back/up, dead-ends, traps) + high-severity brand violations; defer purely-cosmetic nits (logged, not silently dropped).

### Area 3 — Bare-minimum discipline
- Remediation is prioritized, not a redesign. The whole-app visual redesign is explicitly out of scope (REQUIREMENTS.md). Fix what's broken/trapping/off-brand-and-high-severity; defer cosmetic.

### Claude's Discretion
- The exact route list + seeding, the severity rubric thresholds, which cosmetic nits to defer.
</decisions>

<code_context>
## Existing Code Insights
- `apps/web/e2e/_helpers/auth.ts` (loginAs — PKCE via Mailpit) + `_helpers/seed.ts` (fixture seeding) — reuse for the authed audit + the ID routes.
- v1.0 `DeepRouteHeader` primitive (the never-trap nav chrome from Phase 1) — the nav-affordance probe checks every deep route mounts it / has a working back-up.
- `docs/superpowers/DESIGN-SYSTEM.md` — the brand rubric.
- `docs/superpowers/playwright-authed-flow.md` — the audit recipe (written this phase).
- The v1.0/Phase-7 `route-NN-visual.spec.ts` capture pattern — the scripted-spec scaffold to mirror.

## Integration Points
- The audit covers the NEW Phase-10 create/generate surfaces (CreateChooser demotion, the city selector, ImproveControls) + the whole pre-existing app.
</code_context>

<specifics>
## Specific Ideas
- Phase 11 also closes the milestone — after UX-02, the v2.0 milestone audit runs (the Phase-8/9 prod cutover remains separately key-gated).
</specifics>

<deferred>
## Deferred Ideas
- Whole-app visual redesign (out of scope).
- Cosmetic nits surfaced by the audit (logged for a future polish pass).
</deferred>

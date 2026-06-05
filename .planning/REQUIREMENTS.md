# Requirements — Milestone v2.0: AI Date-Planner (revive + harden + make-compliant)

> Source: 2026-06-05 v2.0 research (`.planning/research/SUMMARY.md` + VENUE-DATA.md + GENERATION.md).
> Discipline: bare-minimum MVP. The AI planner engine (`supabase/functions/generate-plan/`) already
> exists and is live on prod; v2.0 makes it **legal, any-city, provably-good, and the primary way to
> create a dating night** — not a from-scratch build. Roughly half of this is hardening + compliance.

## Core value (this milestone)

A user can **generate a real, coherent multi-stop date for their own city in one tap** — from
legally-sourced venues — then **make it better** with simple tweaks, and publish it into the dating
feed. The generated date must be one a real person actually wants to go on (proven by an eval
harness), and its ambient sound fits its cover.

---

## v2.0 Requirements

### DATA — venue corpus & compliance
- [ ] **DATA-01** — Foursquare Places becomes the canonical, stored, LLM-fed `places` corpus; Google is demoted to a live display-only layer keyed by `google_place_id` (never persisted as content, never fed to the model). The existing Google→LLM path is removed.
- [ ] **DATA-02** — When a user sets their profile location, their city's venues ingest into `places` in the background (async pre-seed); generation falls back to a live fetch if the city is still cold, with a graceful "warming up" state.
- [ ] **DATA-03** — Proximity and opening-hours validators use real geo/hours and **fail loud on missing data** (no silent pass), so a cold city cannot read as valid when it isn't.

### PLAN — generation
- [ ] **PLAN-01** — A user generates a coherent multi-stop date for their city in one tap from real venues (hardened existing engine: any-city provider + PostGIS proximity hop-gate + tool-use structured output).
- [ ] **PLAN-02** — A user can swap a single stop and apply natural-language tweaks ("cheaper", "more romantic", "later"), and the itinerary stays coherent (single-stop re-pick + intent parsing, persisted via `update_itinerary_stops`).

### EVAL — prove it's good
- [ ] **EVAL-01** — An eval harness scores generated dates with deterministic hard checks (proximity, hours-open-at-time, schedule monotonicity, budget sum, no hallucinated venues) + an Opus-4.8 LLM-judge rubric (coherence, desirability, feasibility, budget realism, local specificity), over a golden set that includes a cold on-the-fly city, surfacing `unverified_rate` per city, gated in CI.

### SOUND — fits the date
- [ ] **SOUND-01** — More ambient tracks, and a generated date auto-receives a vibe-matched ambient sound (sound ↔ cover cohere via shared vibe tags; no image-ML matching).

### FLOW — into the dating product
- [ ] **FLOW-01** — Generating a date becomes the primary way to create a night in the dating app (publishes to the feed); the legacy manual `/create` planner funnel (and its orphaned `/plan`/catalog surfaces) is retired or replaced.

### UX — page-by-page brand + navigation audit
- [ ] **UX-01** — A systematic audit of **every** route/page and shared component against (a) the design system (DESIGN-SYSTEM.md / Barbiecore brand consistency) and (b) a navigation + flow rubric (every deep route has a working back/up affordance, no dead-ends or traps, correct tab/back-stack semantics, consistent chrome, sane entry/exit). Produces a severity-scored findings inventory covering the whole app surface (incl. the legacy planner surfaces being retired under FLOW-01).
- [ ] **UX-02** — Remediate the UX-01 findings, prioritized: fix all navigation gaps (missing back/up, dead-ends, traps) and brand-consistency violations; defer purely-cosmetic nits. Outcome: no page is a navigation trap and every page reads as one coherent branded product.

---

## Future Requirements (deferred to v2.1+)
- Multi-city expansion as a marketed capability (beyond on-demand per-user seeding).
- Candidate-side AI recommendations ("plan a night like this near me").
- Cover-image → audio ML matching (beyond vibe-tag matching).
- Richer compatibility/chemistry ranking; automatic standby promotion (carried from v1.0).
- Phase-5 WR-04 cancelled-lock reveal (carried todo).
- E25 draft-state, typing indicators, read receipts; business-ownership/claim (carried from v1.0).

## Out of Scope (explicit exclusions, with reasoning)
- **Bespoke web-scraping of venue data** — worst legal posture (ToS), brittle, no cost upside vs a licensed API; rejected by research.
- **Whole-app visual redesign** — dilutes the milestone; the only UX in scope is the creation flow + retiring the legacy planner surfaces.
- **Storing Google Maps content (name/hours/price/photos) or feeding it to the LLM** — forbidden by Google's 2026 Maps ToS; the entire DATA track exists to remove this.

---

## Audit methodology (UX-01)

The UX-01 audit is **empirical, browser-driven** — not a code read. Use the Playwright / Chromium
/ playwright-MCP browser tools to navigate **every** route in the running app (prod
`ufufmcpnysvwtutpbian` deployment and/or forced-local), screenshot each page at the @420px
mobile-first viewport, and check each against the nav/flow rubric + DESIGN-SYSTEM.md. The findings
inventory cites real screenshots + concrete page URLs, so UX-02 remediation is grounded in what the
app actually does, not what the code implies.

## Traceability
*(filled by the roadmapper — every REQ maps to exactly one phase)*

| Requirement | Slug | Category | Phase | Status |
|-------------|------|----------|-------|--------|
| DATA-01 | foursquare-corpus | DATA | — | Pending |
| DATA-02 | city-preseed | DATA | — | Pending |
| DATA-03 | failloud-guards | DATA | — | Pending |
| PLAN-01 | one-tap-generate | PLAN | — | Pending |
| PLAN-02 | improve-loop | PLAN | — | Pending |
| EVAL-01 | eval-harness | EVAL | — | Pending |
| SOUND-01 | vibe-matched-sound | SOUND | — | Pending |
| FLOW-01 | generate-into-dating | FLOW | — | Pending |
| UX-01 | ux-nav-brand-audit | UX | — | Pending |
| UX-02 | ux-remediation | UX | — | Pending |

**Coverage:** 10/10 requirements (to be mapped by roadmap).

# Phase 11 — UX-01 Findings Inventory (v2.0)

**Method:** scripted Playwright audit-collector (`apps/web/e2e/route-11-audit.spec.ts`) — the Playwright MCP
browser is network-isolated in this env, so the audit is the scripted-batch form (capture → Claude
review/judge). Authed via local PKCE+Mailpit, @420px. Evidence: `__audit__/*.png` + `__audit__/audit-raw.json`.

**Coverage (this pass):** 17 of 60 routes — the core navigable surface + the new Phase-10 create flow + the
deep/ID routes. Remaining ~43 routes (mostly admin/legal/marketing/secondary) are a documented next pass.

## Findings

| # | Severity | Route | Finding | Disposition |
|---|----------|-------|---------|-------------|
| **F1** | **HIGH (nav trap)** | `/places/[slug]` | No back/up affordance — only the "after5" wordmark over the hero. It is a POST-MATCH landing target (v1.0 E21 links matched-night stops here), so a user arrives with no way back but browser-back. The one deep route missing the `DeepRouteHeader` never-trap chrome. | **REMEDIATE (UX-02)** — add a back affordance (history-aware: `router.back()` when there's history, else a sensible home), preserving the public/SEO rendering. |
| **F2** | **MEDIUM (brand/contrast)** | `/create/generate` | The "make my date" CTA renders pale-pink bg + white text → low contrast, reads disabled even when active (selections made). | **REMEDIATE (UX-02)** — verify the active state uses the full `shell.accent` (#E0218A); if the pale state is the *enabled* state, fix the contrast; if it's correctly disabled-until-valid, leave + note. |
| F3 | LOW (a11y) | `/feed`, `/nights/new` | No semantic `<h1>` (a styled display heading exists; visual hierarchy is fine). | DEFER (cosmetic a11y — log for a future polish pass). |
| — | env artifact (NOT a bug) | all 17 | `GET /api/stats → 500` on every route = the forced-local webserver missing `SUPABASE_SECRET_KEY` (`createAdminClient` throws). One config issue surfacing everywhere, not 17 route bugs. | Re-run the collector with `SERVICE_ROLE_KEY` exported to clear it; spot-check `/api/stats` on real prod separately. |

## Clean (rendered 200, heading present, deep routes have a working back control)
`/`, `/login`, `/create`, `/account`, `/account/preferences`, `/matches`, `/my-nights`, `/inbox`,
`/places`, `/matches/[lockId]`, `/messages/[threadId]`, `/offers/[offerId]`, `/dates/[slug]/interested`.

Phase-10 surfaces verified visually: `/create` (generate = dominant door, manual demoted, back arrow
present), `/create/generate` (the new city selector renders) — both on-brand Barbiecore.

## Next pass (documented, resumable)
The remaining ~43 routes (admin, legal/marketing, secondary deep routes) via the same collector spec
(it takes a route list). Re-run with `SERVICE_ROLE_KEY` exported. The spec + recipe
(`docs/superpowers/playwright-authed-flow.md`) are reusable.

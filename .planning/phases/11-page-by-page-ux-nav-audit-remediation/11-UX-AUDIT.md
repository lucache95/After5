# Phase 11 — UX-01 Findings Inventory (v2.0)

**Method:** scripted Playwright audit-collector (`apps/web/e2e/route-11-audit.spec.ts`) — the Playwright MCP
browser is network-isolated in this env, so the audit is the scripted-batch form (capture → Claude
review/judge). Authed via local PKCE+Mailpit, @420px. Evidence: `__audit__/*.png` + `__audit__/audit-raw.json`.

**Coverage (this pass):** 17 of 60 routes — the core navigable surface + the new Phase-10 create flow + the
deep/ID routes. Remaining ~43 routes (mostly admin/legal/marketing/secondary) are a documented next pass.

## Findings

| # | Severity | Route | Finding | Disposition |
|---|----------|-------|---------|-------------|
| **F1** | **HIGH (nav trap)** | `/places/[slug]` | No back/up affordance — only the "after5" wordmark over the hero. It is a POST-MATCH landing target (v1.0 E21 links matched-night stops here), so a user arrives with no way back but browser-back. The one deep route missing the `DeepRouteHeader` never-trap chrome. **Root cause:** a back chip existed but was `hidden sm:inline-flex` (desktop-only) AND only rendered when `?from=` was present — invisible at 420px and on cold/SEO entry. | **✅ DONE (UX-02)** — added `components/PlaceBackButton.tsx`: always-visible @420px, history-aware (`router.back()` when in-app history exists, else `/places`), keeping the static "back to your plan" link when a sanitized `?from=` is present. Public/SEO rendering preserved (SSR'd, history check only on click). Visual-verified both entry modes @420px. |
| **F2** | **MEDIUM (brand/contrast)** | `/create/generate` | The "make my date" CTA renders pale-pink bg + white text → low contrast, reads disabled even when active. **Root cause:** the pale state WAS the disabled state (`disabled:opacity-40` on a `bg-shell-accent` button → pale-pink-on-white that reads as a weak *active* button), gated on `vibe.length >= 1`, with no hint why it was inert. | **✅ DONE (UX-02)** — swapped `disabled:opacity-40` for the codebase's canonical neutral disabled treatment (`bg-shell-ink/10 text-shell-ink/35`) so disabled reads as unmistakably inert and enabled is full `#E0218A` + white; added a one-line hint (`pick a vibe to start` / `add a city`) naming what's missing. Visual-verified both states @420px. |
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

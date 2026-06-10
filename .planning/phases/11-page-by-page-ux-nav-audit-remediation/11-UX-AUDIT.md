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

---

# Pass 2 (2026-06-09) — remaining 42 routes

**Method:** same scripted collector (`apps/web/e2e/route-11-audit-pass2.spec.ts`), authed + seeded
(admin allowlist, onboarding-fresh user, reciprocal pair, open rating window, feedback token),
@420px. Evidence: `__audit__/pass2/` (42 PNGs + `audit-raw-pass2.json`). The pass-1 `/api/stats`
env artifact was FIXED for this run (SERVICE_ROLE_KEY exported into the webserver env) — zero
network failures ≥400 across all 42 routes. 3 parallel judge agents reviewed the pixels.

**Coverage now 59/~60 routes across both passes.**

## Findings + dispositions

| # | Severity | Route | Finding | Disposition |
|---|----------|-------|---------|-------------|
| **P2-F1** | **HIGH (blind-contract leak)** | `/inbox` thread list | Pre-lock threads rendered the counterpart's CLEAR photo (`clear_photo_url` projected with no lock gate; profiles RLS opens the row at offer-stage with no column revoke — projection is the UI's contract). | **✅ FIXED (db3ff64)** — photo gated on `chat_threads.lock_id` (clear only post-lock, E16); thread page stops over-fetching the column; swept all other `clear_photo_url` projections (matches/* post-lock ✓, account/* self ✓, interested = spec'd host disclosure ✓). |
| **P2-F2** | **HIGH (nav trap)** | `/reciprocal/[pairId]` | Zero chrome + a binding keep-one choice as the only exit. | **✅ FIXED (b91c10a)** — DeepRouteHeader + quiet "decide later" → /home; titles line-clamp-2. |
| **P2-F3** | **HIGH** | `/onboarding/phone` | One-way door: no resend, no escape if SMS never arrives. | **✅ FIXED (62ce7b8)** — resend w/ 30s throttle, "use a different number", support mailto after failure. No skip (verification is the trust promise). |
| **P2-F4** | **HIGH** | `/onboarding/done` | "you're in. profile's set and verified." rendered ABOVE a dating-gate failure footnote. | **✅ FIXED (a91d6ef)** — branches on gate.ok: blocked → "almost there" + prominent alert; no false "verified". Gate copy de-slopped. |
| P2-F5 | MEDIUM | `/terms`, `/privacy` | Planner-era legal copy ("free-to-use planning tool") binding dating users; no dating data disclosures. | **✅ RECOPIED (d8ef4af)** — real dating terms + privacy w/ verified processor list (Supabase/Vercel/Persona/Twilio/Resend/Anthropic/Foursquare/Mapbox/Replicate/PostHog). NEEDS REAL LAWYER before funding/scale (noted in-file). |
| P2-F6 | MEDIUM | sitewide | EarlyAccessBanner shown to authed users (incl. mid-onboarding, CTA → /login), on /offline, Title-Case voice. | **✅ FIXED (d211b15)** — hidden when authed + on /offline; copy lowercased. |
| P2-F7 | MEDIUM | `/plans/[id]/edit` | No exit chrome; save+publish twin pink primaries. | **✅ FIXED (f30a794)** — history-aware close; save demoted to secondary. |
| P2-F8 | MEDIUM | `/matches/[lockId]/rate` | No consequence transparency on reliability questions. | **✅ FIXED (632e584)** — one muted line: "your answers shape their reliability badge — answer straight." |
| P2-F9 | MEDIUM | `/onboarding/preferences` | Title-Case pills; hard-no chips offered both polarities (double negatives). | **✅ FIXED (8c10944)** — lowercase; dealbreaker display labels reworded (stored values unchanged). |
| P2-F10 | MEDIUM | onboarding 2–6 | No retreat affordance mid-funnel. | **✅ FIXED (cc15e31 + 626ef84)** — per-step back chip (not on first/done). |
| P2-F11 | MEDIUM | `/dates/[slug]`, `/feedback/[token]` | React missing-key console errors; `/dates/[slug]` also lacked a back affordance. | **✅ FIXED (9c5ec33, f47b498)** — keys fixed; history-aware BackButton added (PlaceBackButton generalized w/ fallbackHref). |
| P2-F12 | MEDIUM | `/reciprocal/[pairId]` | Choice cards barely differentiable (truncated titles, same stock photo, only the date differs). | PARTIAL (line-clamp-2 shipped); venue-context line + per-night covers need a query change → carry to polish backlog. |
| P2-F13 | MEDIUM | `/account/saved` | Full legacy planner page (serif Title-Case, "Back to dashboard") inside the dating shell. | **OPEN — user decision:** rebrand or retire (the standing brand-alignment item). |
| P2-F14 | MEDIUM | `/vote/[id]` | Suspected ambiguous vote affordance. | **VERIFIED OK (no change)** — each card is a real vote button; capture cut it at the fold. |
| P2-F15 | LOW | `/dates` etc. | "1 plans"/"1 stops" pluralization; doubled "· after5" title suffix (14 pages); /tell-us missing metadata. | **✅ FIXED (9c5ec33)**. |
| P2-F16 | LOW | `/join`, `/`, `/roadmap`, LandingHero | Planner-era "plan a night" CTA label. | **✅ FIXED (f47b498)** — "make my date". |
| P2-F17 | LOW | catalog surfaces | Kelowna hardcoded in titles/copy (`/dates /types /vibes /neighborhoods`). | DEFER to any-city work (v2.0 cold-city item) — acceptable Kelowna-SEO interim. |
| P2-F18 | LOW | misc | Inbox thread duplicate heading; notifications duplicate heading + native time inputs; Title-Case filter chips + stock imagery on /dates; eyebrow-breadcrumb links on catalog deep routes; pass-1 F3 missing h1. | DEFER — cosmetic polish backlog. |

## KEEP / REBRAND / RETIRE (legacy-surface verdicts, judge batch 1)
**No retire candidates.** about/join/roadmap/tell-us/offline already wear the dating brand;
the catalog (`/dates /types /vibes /neighborhoods`) is the planner-moat supply surface (keep,
de-Kelowna at any-city); terms/privacy were recopy (done); `/account/saved` is the ONE remaining
legacy-styled page → user decision (P2-F13).

## Evidence gaps for a future pass
- `/matches/[lockId]/rate` live form state was code-verified, not pixel-verified (capture caught the pre-date gate; the consequence-line fix shipped with a spec assertion).
- Admin surfaces judged at the internal-tooling bar: all 7 usable, none flagged.

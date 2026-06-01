# Prod full walkthrough + brand audit — tryafter5.app (2026-06-01)

Two-cohort production walkthrough driven by `apps/web/prod-walkthrough-full.mjs` (Playwright,
mobile 390x844, `timezoneId: America/Los_Angeles`). Logged-out public pass + authed r2host
(host view) + authed r2cand (candidate view). Read-only except ONE allowed write: r2host sent
a single chat message ("walkthrough check 18:47:48") in the shared thread to verify the live
write path. Screenshots + `summary.json` in `prod-full-walkthrough-2026-06-01/` (gitignored).

Both logins succeeded. Every surface returned HTTP 200. PDT context: instance `starts_at`
2026-06-01 20:44 UTC = **1:44 PM PDT** (8:44 PM would be the old UTC bug); offer `expires_at`
18:59 UTC = 11:59 AM PDT.

## Per-surface table

| Surface | URL | HTTP | Console err | Local-time verdict | Brand verdict + reason |
|---|---|---|---|---|---|
| landing | `/` | 200 | none | n/a | ON-BRAND — Caprasimo, lowercase, hot-pink CTAs, warm cream, 4 distinct polaroids + hero cluster |
| login | `/login` | 200 | none | n/a | ON-BRAND — Caprasimo "let's get you in.", pink "email me a link", warm shell |
| plan (planner) | `/plan` | 200 | none | n/a | LEGACY-PLANNER (expected) — Fraunces serif, sentence case, warm cream; clashes w/ dating brand but in-scope |
| places (planner) | `/places` | 200 | none | n/a | LEGACY-PLANNER (expected) — serif catalog, Kelowna-hardcoded copy; SEO surface, low priority |
| host home | `/home` | 200 | none | n/a | ON-BRAND — Caprasimo "hey r2 host", pink chips, polaroid date cards |
| host feed | `/feed` | 200 | none | n/a | ON-BRAND — huge Caprasimo empty state "that's everyone for now.", bottom-tab shell |
| host my-nights | `/my-nights` | 200 | none | PDT ✓ (Wed Jun 3 1:44 PM; Mon Jun 1 1:44 PM matched) | ON-BRAND — pink polaroid placeholders, lowercase, real cohort content |
| host interested | `/dates/<inst>/interested` | 200 | none | n/a (empty) | ON-BRAND — "who's interested / shortlist / drag people up", real page (not ComingSoon) |
| host matches | `/matches` | 200 | none | PDT ✓ (Mon Jun 1 1:44 PM) | ON-BRAND — "your matches / LOCKED IN", graceful pink polaroid placeholder |
| host match detail | `/matches/<lock>` | 200 | none | PDT ✓ (Monday Jun 1 1:44 PM) | ON-BRAND — Caprasimo, pink "message", real content |
| host match rate | `/matches/<lock>/rate` | 200 | none | PDT ✓ ("after Jun 1, 6 PM") | ON-BRAND — gated "not yet" state, lowercase |
| host messages | `/messages` | 200 | none | PDT ✓ (Mon Jun 1 1:44 PM) | ON-BRAND — thread list, pink avatar tile |
| host thread + SEND | `/messages/<thread>` | 200 | none | PDT ✓ (bubbles 11:00 AM, 11:47 AM) | ON-BRAND — pink bubbles, "say something" / "send it" composer |
| host account | `/account` | 200 | none | n/a | PARTIAL/OFF — legacy planner shell (Fraunces, sentence-case "Hello, R2 Host", planner cards) on a dating route |
| cand home | `/home` | 200 | none | n/a | ON-BRAND — same as host home |
| cand feed | `/feed` | 200 | none | n/a | ON-BRAND — empty state |
| cand offer | `/offers/<offer>` | 200 | none | PDT ✓ (Monday Jun 1 1:44 PM; countdown "11:13 left to decide") | ON-BRAND — Caprasimo "you've got an offer", real photo polaroid, pink accept |
| cand matches | `/matches` | 200 | **2 (Connection closed → error boundary)** | n/a (crashed) | OFF — renders global error boundary (Fraunces "We hit a snag.", black button), NOT the matches list |
| cand messages | `/messages` | 200 | none | PDT ✓ (Mon Jun 1 1:44 PM) | ON-BRAND — shows host's just-sent message in preview |
| cand thread | `/messages/<thread>` | 200 | none | PDT ✓ (11:00 AM, 11:47 AM) | ON-BRAND — sees r2host's "walkthrough check 18:47:48" message |
| cand account | `/account` | 200 | none | n/a | PARTIAL/OFF — same legacy planner shell as host account |

## Functional-fix verdicts (1–6)

1. **Local timestamps everywhere — PASS.** Every absolute time renders in PDT. The R2 date
   shows **1:44 PM** on my-nights, matches, match-detail, offer, messages and the thread; the
   chat bubble sent at 18:47 UTC shows **11:47 AM**. No `8:44 PM` UTC artifact anywhere. The
   rate-gate copy reads "after Jun 1, 6 PM" (correct local).
2. **No React #418 / hydration errors — MOSTLY PASS.** No #418 / hydration / pageerrors on any
   page, including ExpiryCountdown (`/offers`) and all messages pages. The ONLY console errors
   were on **cand `/matches`**: `Error: Connection closed.` (Supabase realtime websocket),
   caught by the error boundary — a runtime data error, not a hydration error.
3. **Chat live — PASS.** r2host typed + sent one message; it appeared optimistically AND
   persisted across reload; r2cand then opened the same thread and saw it. Confirmed in DB
   path end-to-end.
4. **Distinct landing polaroids — PASS.** Hero shows three distinct film photos; the "how it
   works" cluster shows four different labeled polaroids (active / foodie / chill / evening).
   Barbiecore hero present.
5. **Cohort gating — PASS.** Host and candidate match/host pages render real cohort content
   (matches, offer, interested, my-nights), not the "matching launches soon" ComingSoonBanner.
   (Exception: cand `/matches` is blocked by the realtime crash, not by gating.)
6. **Polaroid placeholders — PASS.** Null-photo cards render a soft-pink polaroid tile with
   the person's name and tilt/shadow; no broken-image icons (host matches, my-nights).

## NEW bugs / regressions (prioritized)

- **[HIGH] Candidate `/matches` crashes to the error boundary.** `Error: Connection closed.`
  (realtime websocket, chunk `6449-…`) is thrown and the After5 error boundary renders
  "SOMETHING DIDN'T LAND / We hit a snag." instead of the matches list. Host `/matches`
  renders fine, so this is candidate-side / role-specific (likely a realtime subscription or
  RLS-scoped channel that closes for the candidate). Candidate cannot see their locked-in
  match. Repro: log in as r2cand, open `/matches`.
- **[LOW] `/account` is the legacy planner shell on dating routes.** Both cohorts' `/account`
  renders the warm-cream Fraunces planner account (sentence-case "Hello, R2 …", planner saved-
  dates cards). The spec lists account as a dating (Barbiecore) surface, so this is a brand
  clash, but it is the known legacy planner page, not a regression.
- **[LOW] Global error boundary is off-brand.** The fallback ("We hit a snag.") uses Fraunces
  + a black button, not Caprasimo/pink — visible because of the HIGH bug above.

## Brand-alignment summary — "are all pages brand aligned?"

**No — almost, with two exceptions.** All core dating surfaces (landing, login, home, feed,
my-nights, interested, matches, match-detail, rate, messages, thread, offer) are fully
Barbiecore: Caprasimo headings, lowercase dry copy, hot-pink accents on warm cream, polaroids,
phone-width layout, bottom-tab shell. The off/partial pages:

- **`/account` (both cohorts) — PARTIAL/OFF:** legacy planner aesthetic on a route the spec
  treats as a dating surface.
- **cand `/matches` — OFF (functional):** shows the off-brand error boundary because of the
  realtime crash, not the intended Barbiecore matches page.
- **`/plan`, `/places` — legacy planner (expected, lower priority):** serif/sentence-case;
  `/places` still hardcodes Kelowna in copy. In-scope per DESIGN-SYSTEM legacy carve-out.

Everything else: on-brand.

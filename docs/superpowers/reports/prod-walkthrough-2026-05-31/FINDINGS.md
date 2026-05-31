# Prod Walkthrough — tryafter5.app (2026-05-31 PM)

Playwright (headless Chromium, 390×844 mobile) drove the live prod site after the R2 batch deploy (`16900a5`). Logged-out pass + authed pass as cohort `r2host` (login via admin-generated magiclink `token_hash` → `/auth/confirm`, read-only — no swipes/offers). Re-run: `node apps/web/prod-walkthrough.mjs`. Screenshots + `summary.json` in this folder (gitignored).

## Results

| Page | Auth | HTTP | Result |
|---|---|---|---|
| `/` landing | anon | 200 | ✅ Distinct polaroids (hero trio + 4-card grid), Barbiecore branding, footer ok |
| `/login` | anon | 200 | ✅ |
| `/plan` | anon | 200 | ✅ |
| `/places` | anon | 200 | ✅ |
| `/feed` | anon | 302 | ✅ Correctly redirects → `/login?next=/feed` |
| `/home` | r2host | 200 | ✅ |
| `/feed` | r2host | 200 | ✅ Clean empty state ("that's everyone for now") — r2host swiped through all during R2 |
| `/my-nights` | r2host | 200 | ✅ New host surface: "your nights" list, status pills (open / **matched**), `dates` tab active |
| `/matches` | r2host | 200 | ✅ Renders the R2 lock (r2 cand, "locked in"); cohort gate passed (not ComingSoonBanner) |
| `/account` | r2host | 200 | ✅ |

## Confirmed fixes (live)
- **#3 polaroids** distinct on landing (was: all identical placeholder).
- **#5 nav** `dates` tab → `/my-nights` works; host now has in-app path to nights → interested.
- **#21 Polaroid** null-photo → graceful gradient placeholder (r2 cand card; my-nights cover-less cards).
- **#6 gating** cohort sees the real match pages (keystone deployed).

## Issues found
1. **`/matches` + `/matches/[id]` React hydration error #418** — `MatchesList`/`LockDetail` (both `'use client'`) format dates with `toLocaleString(undefined, …)`: server renders UTC, client renders local TZ → text mismatch. **FIXED** this session via `suppressHydrationWarning` on the date elements (the divergence is intentional — user should see local time). Page rendered fine regardless (React recovers), but it was a real console error.
2. **Server-rendered dates show UTC, not local** (minor UX) — `my-nights/page.tsx`, `offers/OfferDetail.tsx`, `rate/page.tsx`, `MakeOfferModal.tsx` are server components calling `toLocaleString(undefined,…)` → they emit the server's UTC time (e.g. my-nights "Thu, Jun 4, 12:40 AM" is UTC). No hydration error (server-only), but times read wrong for the user. **Not yet fixed** — needs a client-rendered local-time component or TZ passed from the client. Low priority; tracked.
3. **`/how-it-works` 404** — **non-issue**: no code links to it; the "how it works" content is a section on the landing. Only my direct probe hit it.

## Not covered (need specific IDs / would mutate prod)
Offer detail (`/offers/[id]`), host interested list (`/dates/[id]/interested`), rate flow, and the swipe interaction itself (deck was empty for r2host). The swipe green-wash fix (#4) is covered by unit tests + code review, not re-verified live here.

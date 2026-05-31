# Prod walkthrough EXTRA — 2026-05-31

Read-only Playwright pass over the 3 authed surfaces the first walkthrough missed.
Target: https://tryafter5.app (prod ref `ufufmcpnysvwtutpbian`). Mobile viewport
(390x844). Auth via admin-generated magiclink token_hash through `/auth/confirm`.
No swipes, offers, ratings, or mutations — navigate + screenshot only.

## Prod IDs used (resolved via read-only MCP SQL)

- date_instance (r2host, status=matched): `ae89bfeb-3132-4e5d-9bfd-7feaa65d12db`
- offer (creator=r2host, candidate=r2cand, status=accepted): `a2fca2d6-f671-44d0-bb26-e0bedb7431c4`
- lock (creator=r2host, matched_user=r2cand): `823aa47a-c5f8-4abe-a75a-59e874ed5627`
- r2host = `3e7e47b2-81f3-4e40-9934-338b3c5433f0` (`lucache95+r2host@gmail.com`)
- r2cand = `95215f53-23c9-4661-bfcb-236df3cdadcd` (`lucache95+r2cand@gmail.com`)

The offer and lock both hang off the same matched instance `ae89bfeb`.

## Per-surface results

| Surface | URL | HTTP | Final URL | Redirect | Console/React errors |
|---|---|---|---|---|---|
| Host interested | `/dates/ae89bfeb…/interested` (r2host) | 200 | same | no | none |
| Rate (host) | `/matches/823aa47a…/rate` (r2host) | 200 | same | no | none |
| Offer detail | `/offers/a2fca2d6…` (r2cand) | 200 | same | no | **React #418 (hydration)** |
| Rate (cand) | `/matches/823aa47a…/rate` (r2cand) | 200 | same | no | none |

All 5 navigations (2 logins + 4 page visits) returned HTTP 200. No redirects to
`/login`, no `ComingSoonBanner`, no 403 ("not your date") gate — auth and ownership
gating all resolved correctly for the chosen participants.

### 1. Host interested list — VERDICT: PASS
`/dates/<instanceId>/interested` rendered the host-only list correctly for r2host.
Shows two sections: "shortlist" (empty: "nobody shortlisted yet. drag people up
from below.") and "new interest" (empty: "no new right-swipes yet."). The
`creator_id === user.id` ownership check passed (no "not your date" 403 state).
Match flag is ON for this viewer (no ComingSoonBanner). Clean — no console errors.
Note: the list is empty for this instance because no `queue_entries` exist for it;
the surface itself works.

### 2. Offer detail — VERDICT: PASS WITH BUG (React #418 hydration error)
`/offers/<offerId>` rendered correctly for the recipient r2cand: header "you've got
an offer", host card "r2 host, 31" with a polaroid photo, "the night" Monday Jun 1
1:44 PM, the live countdown "20h 34m left to decide", and accept / pass / not
interested actions. Layout and Barbiecore styling look right.

BUG: the page throws **Minified React error #418** on load (hydration text
mismatch; args `text` + empty). Root cause is `ExpiryCountdown.tsx`: `now` is seeded
with `useState(() => Date.now())` and the remaining-time string is computed during
render (`format(remaining)` at line 66). The server renders the countdown text at
SSR time; the client re-renders it at hydration time (>=1s later), so the two text
nodes differ and React bails out of hydration for that subtree. It is non-fatal
(client re-render recovers and the timer ticks), but it is a real hydration error
that ships on every offer-detail view with a live countdown.

Suggested fix: gate the live value behind a mounted flag (render a stable
placeholder or the server value until `useEffect` sets `mounted = true`), or seed
`now` from a server-passed timestamp so first client render matches SSR.

### 3. Rate flow — VERDICT: PASS (correctly time-gated)
`/matches/<lockId>/rate` rendered the expected gated state for BOTH participants
(r2host and r2cand): heading "not yet", body "you can rate this once the date's
done, after Jun 2, 1 AM." This is correct — rating is time-gated until after the
date (the lock's date is Jun 1/2). No rating was submitted. Clean — no console
errors on either participant's view. Both lock participants can reach the page and
see the same gated copy, which is the intended behaviour.

## Overall verdict: DONE_WITH_CONCERNS

All three surfaces load (200), gate correctly, and render with no redirect/403/
ComingSoon surprises. One real bug: the offer-detail page emits a React #418
hydration error from the live `ExpiryCountdown`. Recommend fixing before public
launch since it fires on every offer view.

## Artifacts
- `host-interested.png`, `host-rate.png`, `cand-offer.png`, `cand-rate.png`
- `summary.json` (status / finalUrl / consoleErrors / body-text snippet per page)

(PNGs and summary.json are gitignored by `docs/superpowers/reports/prod-walkthrough-*/`.)

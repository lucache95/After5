# Reality Audit — Date Generation, Legacy, Dead-UI (2026-05-30)

READ-ONLY audit of After5. Authority order: implementation > tests > migrations > types > routes > edge-fns > docs > plans.

## Phase 3 — Date Generation Reality

### Canonical generation path
1. UI: `apps/web/app/plan/page.tsx` (5-question form) calls `supabase.functions.invoke('generate-plan', …)` at line 421.
2. Edge fn: `supabase/functions/generate-plan/index.ts` — hybrid generator. Deterministic SQL filters candidate `places`, scores/selects `templates`, greedy-fills slots, then Claude Sonnet 4.6 does a writing-only pass (LLM never picks places — hallucination structurally impossible). Persists rows to **`itineraries`** (service-role write).
   - Modules: `places-filter.ts`, `templates.ts`, `scoring.ts`, `prompt.ts`, `editorial-packs.ts`.
   - Returns 3 itineraries; renders at `/plan/i/[id]`.
3. Cover art: `generate-cover` / `generate-blur` edge fns (cosmetic).

This is the ONLY live generator. No second/legacy generation system runs — `date-engine-v2`, `contextual-bandits`, and the "good-date-standard" eval exist **only as specs/`.planning` docs**; grep finds zero references to them in `apps/web`, `supabase/functions`, or `packages`.

### Does generation feed the dating loop? **YES.**
The bridge is the `post_night` RPC (`supabase/migrations/20260527120200_s5_post_night.sql`):
- UI `apps/web/app/nights/new/page.tsx` lists the user's owned/public `itineraries`; `PostNightForm` → `packages/api-client/src/feed.ts::postNight` → RPC `post_night(p_itinerary, …)`.
- `post_night` requires `dating_enabled AND verification='verified'`, then `INSERT INTO date_instances (itinerary_id, creator_id, city_id, …, status='seeking')`.
- `date_instances` are surfaced as swipeable nights via `browse_feed_for_viewer` (feed.ts `browseFeed`) → `apps/web/app/feed/SwipeDeck.tsx` → `record_swipe`.

So a generated itinerary becomes a swipeable dating night once a verified user posts it. Generation is the planner "wedge" that supplies content to the dating marketplace.

### Eval
`apps/web/app/api/admin/eval/route.ts` + `/admin/eval` is a real, connected **read-only** dashboard aggregating `itineraries.generation_log`, `saved_plans`, `plan_feedback`. It scores nothing back into generation — observability only. No bandit/feedback loop wired.

## Phase 4 — Legacy Classification

| Item | Class | Note |
|---|---|---|
| `generate-plan` planner + `itineraries`/`places`/`templates`/`modifiers` | **KEEP** | The wedge; feeds dating loop via `post_night`. |
| `/plan`, `/plan/i/[id]`, `/templates/[id]`, `/wow/[id]`, `/vibes`, `/neighborhoods`, `/types`, `/places` | **KEEP/MERGE** | Planner-era SEO/browse routes; all backed by real tables (`templates`, `modifiers`, `itineraries`). Marketing surface, not dangerous. |
| `/vote/[id]` (`vote_sessions`) | **MERGE/REPLACE** | Pre-dating "vote on a plan" flow; backed by `vote_sessions` table but disconnected from the dating loop. Candidate to fold in or retire. |
| `/account` vs `/home` dual dashboard | **DANGEROUS** | Two competing post-login "your home" pages. `/home` (FirstSessionHome) is the dating-aware destination (reads `dating_enabled`, drives onboarding/enable flow); `/account` is the legacy planner dashboard ("your home after signing in", saved plans). Both claim to be home → split-brain navigation, users land in planner-only view and never reach the dating loop. |
| `generate-plan` service-role writes | KEEP (verify) | Writes only to `itineraries`, never to `date_instances`/dating tables directly — the only dating write-path is the RLS-gated `post_night` RPC. No dangerous planner→dating write path found. |
| `roadmap`, `tell-us`, `insiders`, `about` marketing pages | KEEP | Real backends (`/api/tell-us`, `/api/stats`, insiders tables). |

No pre-After5 branding remnants found (consistent "After5"/tryafter5.app).

## Phase 7 — Dead-UI Findings
Notably FEW fakes — most surfaces are wired:
- **"X spots left" — REAL, not fake.** `components/EarlyAccessBanner.tsx:33` fetches `/api/stats`; `app/api/stats/route.ts:32-37` computes `remaining = 100 - count(subscribers)`. Cap `EARLY_ACCESS_CAP=100` is the only constant. Legitimate.
- **Dual dashboard dead-end** — `/account` (legacy) and `/home` (dating) both present as the signed-in home; a user routed to `/account` sees planner-only UI with no path into feed/matches. (`app/account/page.tsx` vs `app/home/page.tsx`.)
- **`/vote/[id]`** — functional (`vote_sessions`) but orphaned from the dating loop; reachable legacy flow with no onward connection to swiping/matches.
- No noop `onClick={() => {}}`, no `href="#"`, no `alert()` stubs, no hardcoded stat counts found across `app/**` + `components/**`. All audited `disabled=` bindings are state-driven (busy/expired/canPost), not fake.

### Open items / could not fully verify under context budget
- Did not diff local vs prod for `date_instances`/`post_night` presence (memory notes 5a-loop migration gap was closed mid-run on prod).
- `/types`, `/vibes`, `/neighborhoods` confirmed table-backed but not exhaustively checked for empty-state dead-ends.

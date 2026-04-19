# After5 — Technical Implementation Plan

> Companion to `PLAN.md`. PLAN.md = strategy, what + why. TECH_PLAN.md = sequence, how + when.
> Last updated: 2026-04-19

## Where we are

```
Phase 0: Foundation        ████████░░  80%   in progress
Phase 1: Generation API    ░░░░░░░░░░   0%   blocked on Phase 0
Phase 2: Web shell         ░░░░░░░░░░   0%   Vercel link lives here
Phase 3: Generation flow   ░░░░░░░░░░   0%
Phase 4: Save + feedback   ░░░░░░░░░░   0%
Phase 5: Library + SEO     ░░░░░░░░░░   0%
Phase 6: Polish            ░░░░░░░░░░   0%
Phase 7: Launch            ░░░░░░░░░░   0%
```

**Done so far**: monorepo, Supabase project, schema migration applied, TS types generated, MCP wired, Railway on standby, GitHub repo live.

**Next concrete action**: seed the 50 places (Phase 0 task #6).

---

## Guiding principles

1. **Backend-first.** The generation pipeline is the hardest, riskiest, highest-value piece. Build and validate it before building any UI. If generation quality fails, no UI saves us.
2. **Vertical slices.** Each phase ships a narrow slice that works end-to-end before adding breadth. We'd rather have a working "generate one plan" than a half-built "generate / save / share / rate" all in flight.
3. **Production-shaped from day one.** Even Phase 1 calls Claude via the same Edge Function path the production app will use. No throwaway prototypes.
4. **Testable boundaries.** Each phase has acceptance criteria you can prove with one command or one click. If you can't prove it works, it isn't done.
5. **No frontend until backend works.** UI is faster to build than backend. Building UI first hides backend pain.

---

## Phase 0 — Foundation

**Goal**: every dependency installed, schema in cloud DB, seeded with real Kelowna data, every credential in `.env.local`. From here, every phase has what it needs.

### Tasks

| # | Task | Status |
|---|---|---|
| 1 | Monorepo scaffold (Turborepo + pnpm) | ✅ done |
| 2 | Supabase project provisioned | ✅ done |
| 3 | Initial schema migration written | ✅ done |
| 4 | Migration applied to cloud DB | ✅ done |
| 5 | TypeScript types generated → `packages/types/src/database.ts` | ✅ done |
| 6 | Seed 50 places into cloud DB (transform `places/seed.json` → SQL) | ⬜ next |
| 7 | Seed 10 templates into cloud DB (transform `templates/templates.yaml`) | ⬜ |
| 8 | Get Anthropic API key, save to `.env.local` | ⬜ |
| 9 | Get Resend API key, save to `.env.local` | ⬜ |
| 10 | Get PostHog API key, save to `.env.local` | ⬜ |
| 11 | Verify `.env.local` complete via a script that reads it and reports missing keys | ⬜ |
| 12 | `pnpm install` at root (workspaces resolve) | ⬜ |

### Acceptance

```bash
# All pass:
pnpm install
pnpm typecheck
psql $DB_URL -c "select count(*) from places"   # → 50
psql $DB_URL -c "select count(*) from templates" # → 10
node scripts/verify-env.mjs                       # → all keys present
```

---

## Phase 1 — Generation API (the core)

**Goal**: a Supabase Edge Function that takes user inputs and returns 3 high-quality itineraries. Tested via curl. Quality verified by hand against the 10 reference itineraries in `itineraries/`.

### Architecture

```
POST /functions/v1/generate-plan
  ├─ Validate input (Zod, packages/validators)
  ├─ Filter places (deterministic SQL query)
  ├─ Select 3 templates (scoring against vibe + duration + must_includes)
  ├─ Assemble candidates per template
  ├─ Score combinations (geographic + pairing + variety)
  ├─ Pick top combo per template (3 total)
  ├─ Call Anthropic Claude Sonnet 4.6 (writing pass: title + hook + why_it_works + per-stop)
  ├─ Insert itinerary into DB
  └─ Return 3 plans
```

### Tasks

| # | Task | Notes |
|---|---|---|
| 1 | Build `packages/business/` — pure logic | Filtering, scoring, prompt builders |
| 2 | Build `packages/business/src/filter.ts` | DB query builder for candidate places |
| 3 | Build `packages/business/src/templates.ts` | Template scoring + slot matching |
| 4 | Build `packages/business/src/score.ts` | Combination scoring (geographic, pairing, variety) |
| 5 | Build `packages/business/src/prompt.ts` | Anthropic prompt builder + response parser |
| 6 | Write Edge Function: `supabase/functions/generate-plan/index.ts` | Composes the above |
| 7 | Set Edge Function secrets (ANTHROPIC_API_KEY) via `supabase secrets set` | Server-only |
| 8 | Deploy Edge Function: `supabase functions deploy generate-plan` | |
| 9 | Test with curl: 5 different input combinations | Romantic boujee $$$ / chill spontaneous $ / etc. |
| 10 | Manual quality review against `itineraries/README.md` | Does generated quality match reference? |
| 11 | Implement prompt caching | Anthropic prompt caching for system prompt + place catalog |

### Quality bar

The generated itineraries must:
- Use only real places from the database (no hallucinations — guaranteed by the LLM never picking places)
- Stay within drive_tolerance_min between adjacent stops
- Match user vibe in ≥70% of stops
- Have a coherent narrative ("why this works" reads as if a local wrote it)
- Cost within ±20% of user budget
- Pace correctly (no 3 sit-down stops in a row)

### Acceptance

```bash
# Generate a plan via curl
curl -X POST $SUPABASE_URL/functions/v1/generate-plan \
  -H "Authorization: Bearer $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"occasion":"date","duration_min":180,"budget_per_person":50,"vibe":["chill","romantic"],"must_includes":["food","walk"],"drive_tolerance_min":15,"effort":"low"}'

# Returns: 3 itineraries, each:
#   - 2-4 stops
#   - All places exist in DB
#   - Total cost <= 60 (50 + 20%)
#   - Vibe match >= 70%
#   - Pacing valid
#   - Title, hook, why_it_works, per-stop suggestions all written
```

5 different input combinations all pass the quality bar = Phase 1 done.

### Cost target

Each generation: < $0.05 (Claude Sonnet 4.6 with prompt caching).
Budget for first 1000 generations: < $50.

---

## Phase 2 — Web shell + Vercel

**Goal**: Next.js 15 app scaffolded, deployed to Vercel, connected to Supabase. Landing page renders with copy from PLAN.md Part 11.

### Tasks

| # | Task | Notes |
|---|---|---|
| 1 | `pnpm create next-app apps/web --typescript --tailwind --app --use-pnpm --no-eslint` | Latest Next.js 15 |
| 2 | Add shadcn/ui — `pnpm dlx shadcn@latest init` in apps/web | Tailwind already in place |
| 3 | Wire `apps/web/lib/supabase/client.ts` + `server.ts` (per Supabase Next.js docs) | |
| 4 | Add packages as workspace deps: `@after5/types`, `@after5/validators` | |
| 5 | Build the landing page (`/app/page.tsx`) — copy from PLAN.md Part 11 | |
| 6 | Add design tokens: After5 brand color, type scale, spacing | Reference: ui-ux-pro-max skill |
| 7 | Push to GitHub | Auto-deploys via Vercel once linked |
| 8 | Link Vercel project: import GitHub repo at vercel.com/new, set root to `apps/web` | |
| 9 | Add env vars in Vercel dashboard (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) | |
| 10 | Connect domain (after5.app or chosen domain) | Cloudflare DNS → Vercel |
| 11 | Verify production deploy renders correctly | |

### Vercel setup (when we get here)

Easiest path is the **web UI**, not the CLI:

1. Go to [vercel.com/new](https://vercel.com/new)
2. **Import Git Repository** → select `lucache95/After5`
3. Configure:
   - **Root directory**: `apps/web`
   - **Framework**: Next.js (auto-detected)
   - **Build command**: `cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @after5/web build`
   - **Install command**: leave empty (handled in build)
4. Add environment variables (copy from `.env.local`)
5. Deploy

Every push to `main` triggers a production deploy. PRs get preview deploys for free.

### Acceptance

- `pnpm --filter @after5/web dev` runs locally on port 3000
- Production URL renders the landing page
- Lighthouse: LCP < 2s, CLS < 0.1, no console errors

---

## Phase 3 — Generation flow UI

**Goal**: User can complete the 5-step flow on the web app and see 3 generated itineraries. End-to-end, real Claude calls, real DB writes.

### Tasks

| # | Task |
|---|---|
| 1 | Build `/app/plan/page.tsx` — multi-step form with state via URL params |
| 2 | Build step components: occasion, time, vibe+budget, must-includes |
| 3 | Loading screen with progress copy ("Pulling together places…") |
| 4 | Build `/app/plan/result/page.tsx` — 3 itinerary cards |
| 5 | Build `/app/plan/[id]/page.tsx` — single itinerary detail (timeline, why-it-works, drive flow) |
| 6 | Wire `useGeneratePlan` hook → calls Edge Function |
| 7 | Open in Maps button (Google Maps directions deep link) |
| 8 | Try a different one button (re-generate with same inputs, suppress recent places) |
| 9 | Mobile-responsive (375px → 1440px) |
| 10 | Skeleton/loading states on every async surface |

### Acceptance

- A user can land on /, click "Plan my date", complete 5 inputs, wait ~10s, and see 3 plans
- Each plan can be expanded to a full timeline view
- "Open in Maps" launches Google Maps with the route
- Works on mobile Safari + desktop Chrome
- No console errors during the full flow

---

## Phase 4 — Save + feedback loop

**Goal**: Users can save plans (email gate), get a follow-up email after the date, submit feedback. Per-place feedback scores update.

### Tasks

| # | Task |
|---|---|
| 1 | Add Supabase Auth — passwordless magic link via email |
| 2 | "Save this plan" button → if not authed, request email → magic link → save |
| 3 | `/app/saved/page.tsx` — list of saved plans for authed user |
| 4 | Resend integration: send "How was your date?" email at `start_at + 24h` |
| 5 | Use `pg_cron` (Supabase scheduled) to enqueue + send the emails |
| 6 | `/app/feedback/[id]/page.tsx` — feedback form (3 questions) |
| 7 | Edge Function `submit-feedback` — writes to `feedback`, updates `places.feedback_score` + `total_loved` / `total_skipped` |
| 8 | Update `pairings` table (trigger or function) |

### Acceptance

- A user can save a plan, log out, log back in, see the saved plan
- 24h after the plan's start time, an email arrives at their address
- Clicking the email link lands on the feedback form
- Submitting feedback updates the place's `feedback_score` (verifiable in DB)

---

## Phase 5 — Public library + SEO

**Goal**: Itineraries that hit the quality threshold (3+ "loved" feedbacks) get auto-promoted to public, SEO-indexed pages. First 5 pillar pages live.

### Tasks

| # | Task |
|---|---|
| 1 | Add `is_public` and `loved_count` columns (migration) — DONE in Phase 0 |
| 2 | Background job: every itinerary with `loved_count >= 3` and `loved_count > skipped_count` gets `is_public = true` |
| 3 | `/app/kelowna/itinerary/[slug]/page.tsx` — public itinerary view (SSR + ISR) |
| 4 | JSON-LD: `TouristTrip` + nested `LocalBusiness` for each stop |
| 5 | Open Graph + Twitter card meta on every page |
| 6 | `/app/sitemap.ts` — auto-generated, only includes public itineraries |
| 7 | `/app/robots.txt` |
| 8 | `/app/llms.txt` and `/app/llms-full.txt` |
| 9 | First 5 pillar pages: `/kelowna/best-date-ideas`, `/kelowna/cheap-dates-under-50`, `/kelowna/free-date-ideas`, `/kelowna/sunset-date-ideas`, `/kelowna/rainy-day-dates` |
| 10 | Each pillar surfaces the top 5–10 public itineraries matching the theme |
| 11 | Submit sitemap to Google Search Console |

### Acceptance

- A public itinerary at /kelowna/itinerary/[slug] renders with full SSR HTML, JSON-LD, OG tags
- 5 pillar pages live, each with at least 5 surfaced itineraries
- Sitemap includes all public pages, excludes private
- Lighthouse SEO score: 100

---

## Phase 6 — Polish

**Goal**: production-quality UX. No rough edges, no broken states, no console errors.

### Tasks

| # | Task |
|---|---|
| 1 | Empty states (no plans saved yet, no feedback yet, etc.) |
| 2 | Error states (generation failed, network error, place closed) |
| 3 | Loading skeletons consistent across the app |
| 4 | Accessibility audit — keyboard navigation, ARIA, contrast |
| 5 | Performance pass — image optimization, font preloading, route prefetching |
| 6 | Real photos for top 30 places (replace stock) |
| 7 | Analytics events wired (PostHog): plan_generated, plan_saved, feedback_submitted, etc. |
| 8 | Error monitoring (Sentry) |

### Acceptance

- Lighthouse: Performance 90+, Accessibility 95+, SEO 100, Best Practices 100
- Manual click-through across 10 user paths: zero broken states
- All analytics events firing correctly

---

## Phase 7 — Launch

**Goal**: live at after5.app, public, ready to drive traffic.

### Tasks

| # | Task |
|---|---|
| 1 | Domain hookup (after5.app or chosen) → Vercel + Supabase custom domain |
| 2 | Production env vars verified |
| 3 | Privacy policy + terms (both required for app stores later) |
| 4 | Cookie banner (only if needed — minimal tracking) |
| 5 | Landing page copy review (final pass) |
| 6 | Concierge cohort invite (the 50 from week 1) |
| 7 | Public launch posts: r/kelowna, Kelowna Facebook groups, Instagram, TikTok |
| 8 | Tourism Kelowna pitch (might place us on their blog) |
| 9 | First-week monitoring: PostHog funnel, Sentry, Supabase logs |

### Acceptance

- after5.app loads HTTPS in prod
- 100 generations completed by real users in week 1
- 25%+ of those users save the plan
- 10%+ of saved plans receive feedback

---

## Mobile (post-launch, month 4+)

**Goal**: native iOS/Android via Expo, sharing 100% of the backend.

### Tasks (rough)

| # | Task |
|---|---|
| 1 | `pnpm create expo-app apps/mobile --template typescript` |
| 2 | Add workspace deps: `@after5/types`, `@after5/validators`, `@after5/api-client` |
| 3 | Wire Supabase client (same SDK, RN-compatible) |
| 4 | Build the 5-step flow in React Native |
| 5 | Native share sheet for screenshots |
| 6 | Push notifications for "your plan is tomorrow" |
| 7 | EAS build + submit to App Store + Play Store |

This is its own arc — don't open this until web has retention.

---

## Cross-cutting concerns

### Testing strategy

- **Phase 1**: integration tests for the generation pipeline (Deno test in the Edge Function)
- **Phase 3+**: Playwright for the critical user flow (generate → view → save)
- **Schema**: every migration tested by applying to a fresh local Supabase before pushing
- No unit-test fundamentalism. Test what would catch real regressions; skip what wouldn't.

### Deployment

- `main` → production (Vercel auto-deploys, Supabase migrations pushed manually)
- PRs → Vercel preview deploys
- Edge Functions → `supabase functions deploy` from CLI (manual until we wire CI)
- Future: GitHub Action to push migrations on merge to main

### Data backfill

- The `places` and `templates` tables are seeded once via migration
- Adding more places later: write SQL migrations OR use Supabase Studio for ad-hoc edits + dump back to a migration file

### Cost monitoring

- Anthropic spend → watch in Anthropic console weekly
- Supabase compute → MICRO until generation volume warrants SMALL
- Vercel → free tier covers first 10k visitors
- Resend → free tier covers first 3000 emails/mo

---

## Decision log

Living record of architectural decisions made and not to relitigate.

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-19 | Hybrid generation (deterministic filter + LLM writer) | Hallucination-free; LLM cannot pick places |
| 2026-04-19 | Supabase + Edge Functions (not custom backend) | Build-once for web + mobile; no DevOps |
| 2026-04-19 | Monorepo from day one (Turborepo + pnpm) | Shared types/validators between web + mobile, no drift |
| 2026-04-19 | Public itinerary pages gated by 3+ "loved" feedback | Avoids Google HCU penalty; quality cannot game the system |
| 2026-04-19 | Web first, mobile month 4+ | SEO compounds; no app store delay; mobile is downstream of retention |
| 2026-04-19 | Railway on standby (not active) | Edge Functions cover the workload; Railway ready as escape hatch for workers/cron beyond pg_cron |
| 2026-04-19 | After5 as final name | Self-explanatory positioning; no taglining required |

---

## Right-now task

**Phase 0, task #6**: seed the 50 places into the cloud DB. Building the seed migration now.

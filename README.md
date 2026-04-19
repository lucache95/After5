# After5

> Plan the perfect Kelowna date in 30 seconds.

After work, after the day, after 5 — that's when life starts. After5 plans your night.

A curated date/outing planner for Kelowna. Hybrid system: hand-vetted local place database + constrained LLM assembly + feedback loop that compounds. Launch wedge: dates, Kelowna only.

## Status

Pre-build. Concierge MVP phase.

## Folder structure

Monorepo (Turborepo + pnpm). Backend built once; both web and mobile clients share it.

```
PLAN.md              — full founder plan (research, MVP, build spec, roadmap)
README.md            — this file

apps/
  web/               — Next.js 15 app (build first)
  mobile/            — Expo + React Native app (build month 4+)

packages/
  types/             — shared TypeScript types
  api-client/        — Supabase client wrappers, query/mutation helpers
  validators/        — Zod schemas for inputs/outputs
  business/          — pure logic (scoring, prompt builders, formatters)

supabase/
  migrations/        — schema as code
  functions/         — Edge Functions (generation pipeline, Deno)

itineraries/         — the 10 reference itineraries (also in PLAN Part 6)
places/seed.json     — 50 starting Kelowna places with tags
templates/           — itinerary template definitions (templates.yaml)
docs/                — concierge log, supporting research
```

## Next 7 days (concierge MVP)

1. Stand up Instagram `@after5.kelowna` or similar.
2. Post the 10 itineraries from `itineraries/` as carousels (one per day).
3. DM offer in bio: "Tell me your vibe, budget, time — I'll plan your date free."
4. Hand-plan 10 real dates. Track requests + feedback in `docs/concierge-log.md`.
5. Stand up landing page (Carrd / Framer) using copy from `PLAN.md` Part 11.

## Build kickoff (week 2)

When you're ready to write code, see `PLAN.md` Part 7 (tech stack, schema, endpoints) and Part 10 (30-day roadmap).

## Name

**After5.** Domains to grab: after5.app, getafter5.com, after5.co, tryafter5.com, after5kelowna.com.

## Owner

Lucas Senechal · Kelowna, BC

# prod deploy checklist — open-city /create

scope: fully-open city creation. `/create` now takes a free-text city; the
`generate-plan` edge fn geocodes it and warms a night around that center.
the frontend changes ship with the normal vercel deploy. the edge change is
human-gated. nothing below has been deployed.

## gated steps (need human approval)

1. **redeploy the `generate-plan` edge function.**
   - new files: `open-city.ts`; new exports in `google-places.ts`
     (`geocodeCity`, `radiusFromViewport`). `index.ts` now resolves a free-text
     `city_query` into an ad-hoc city when `city_slug` doesn't match a curated
     row.
   - deploy: `supabase functions deploy generate-plan --project-ref ufufmcpnysvwtutpbian`
   - backward-compatible: a request with only `city_slug` hits the identical
     pre-change path. no schema migration required.

2. **confirm the google key can run Places Text Search for localities.**
   - geocoding reuses the existing `places:searchText` endpoint and the existing
     `GOOGLE_PLACES_API_KEY` edge secret — the SAME api the warmer already calls.
   - the **Geocoding API is NOT used and does NOT need enabling.** only the
     Places API (already enabled, already proven by the warmer) is touched.
   - if the key has an api restriction list, verify **Places API (New)** is on
     it (it already is — the warmer works).

3. **no new env vars or secrets.** open-city adds zero secrets. it reuses
   `GOOGLE_PLACES_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ANTHROPIC_API_KEY` — all already set on the edge fn.

## notes for the deployer

- ad-hoc cities are written to `public.cities` with `is_active = false` and a
  slug prefixed `open-`, so they never surface in the public city list or the
  quick-pick chips. the service-role client does the upsert; RLS is not in the
  path.
- cost: each first-time city = 1 geocode Text Search + ~5 warm Text Searches.
  repeat generations for the same city reuse the row and skip both (cold-count
  threshold + existing-row reuse).
- rollback: redeploy the previous `generate-plan` revision. the frontend
  tolerates it — a `city_query` with no matching slug returns `unknown_city`
  (422) and the user sees the "that one slipped away" retry copy.

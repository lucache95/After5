# 5b Sub-project H — E2E test track + CI integration (design spec)

> **Roadmap:** Task 9 of `docs/superpowers/plans/2026-05-27-5b-master-roadmap.md`. Overview spec §1-H + §4.3/§4.4. Authored 2026-05-29.
> **Status:** spec only. No app/test code written yet. Plan lives at `docs/superpowers/plans/2026-05-29-5b-H-e2e-ci.md`.

## 1. Goal

Prove the full 5b loop works as a *system* — host posts a night → candidate swipes right → host shortlists + makes an offer → candidate accepts → both see the lock + Tier-3 reveal — and gate every PR to `main` on the complete test pyramid (SQL + Deno edge + web Vitest + Playwright E2E) running in CI. H adds the only browser-level coverage of 5b; everything below it (Z/A/B/C SQL, C Deno, D-G Vitest) already exists.

## 2. First-hand realities this spec is built on (verified 2026-05-29)

These are the load-bearing facts. Every design choice below traces to one of them.

1. **Edge functions are NOT served by `supabase start`.** `supabase start` brings up Postgres + Auth + Realtime + Studio + Mailpit, but the `match-*` functions return **503 / connection-refused** until `supabase functions serve` is running. The UI's accept / pass / offer / shortlist actions all POST to `/functions/v1/match-*`. **Therefore the happy-path E2E REQUIRES `supabase functions serve` to be up.** This is gotcha #1: any run-all or CI stage that drives the UI through a match action must start functions-serve first, with `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_PUBLISHABLE_KEY`), and `SUPABASE_SERVICE_ROLE_KEY` in its env (the shared handler in `supabase/functions/_shared/match.ts` reads exactly those three; it fails closed with 503 if any is missing).

2. **`.env.local` points at PROD.** Both `/.env.local` and `/apps/web/.env.local` set `NEXT_PUBLIC_SUPABASE_URL=https://ufufmcpnysvwtutpbian.supabase.co`. A naive `next dev` talks to production. The E2E web server MUST be launched **forced-local** with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local publishable>`. Playwright's `webServer` block sets these inline so the spawned Next process never reads the prod values.

3. **`match_v2_enabled` gates the entire UI.** When the `feature_config` row is `false`, host/candidate routes render `ComingSoonBanner` and the match RPCs raise `P5000`. The seed step flips it `true` in the test DB before any spec runs.

4. **PKCE login is the only working auth path.** Admin `generate_link` produces an *implicit* (`#access_token`) link that does NOT set the SSR cookies the RSC gate reads, so protected routes bounce to `/login`. There is **no `/signup` route** — OTP via `/login` only. The working recipe (per memory `reference_local-qa-browser-login.md`): navigate `/login` → type email → click **"Email me a sign-in link"** (this calls `signInWithOtp` with `emailRedirectTo=${origin}/auth/callback?next=...` and sets the PKCE `code_verifier` cookie in that context) → fetch the email from Mailpit (`GET http://127.0.0.1:54324/api/v1/messages?limit=N` → newest message `ID` → `GET /api/v1/message/<id>` → regex `auth/v1/verify?token=pkce_...&redirect_to=...`) → navigate to that verify URL in the **same context** → `/auth/callback?code=...` exchanges the code with the verifier cookie → SSR session cookies land → authed.

5. **Seeding patterns that work** (mirror `scripts/5b-smoke-prod/1-seed-profiles.sql` + `2-seed-date.sql`, run with a service-role client / psql so RLS is bypassed):
   - Promote a profile: `profiles_private.birthdate` (must exist before `dating_enabled` flips — the age-gate trigger enforces it) + `profiles` `dating_enabled=true`, `verification='verified'`, `onboarding_step='done'`, `onboarding_completed_at=now()`, gender/prefs/city/photos.
   - **Host** needs a `date_instances` row (`status='seeking'`) with an `itineraries` row (`itinerary_id` is NOT NULL FK). `duration_min` defaults to 150; `time_range` derives from `starts_at`.
   - The **local** Kelowna `city_id` is *not* the prod UUID (`06b7bad2-…`). Resolve it via `select id from cities where slug='kelowna'` (matches `_fixtures.sql` `mk_instance`).
   - `queue_entries` link candidate → host instance (status `interested`/`shortlisted`, `creator_id` = host). `offers`/`locks` carry partial-unique constraints (one active offer per instance; `locks.date_instance_id` unique). RLS policies (127400 host-disclosure, 127500 recipient date-read) + reveal (126600) gate cross-user reads — so the E2E must drive reads through the right JWT/context.

6. **Schema facts for assertions:** `lock_status` enum = `active|completed|cancelled|no_show`. `profiles` **Tier-3** reveal shape = `first_name, age, city, neighborhood, clear_photo_url, vibe_tags` (NO `bio`, NO `photos[]`, NO `expectations[]` — the older overview-spec acceptance list that named those fields is wrong for the live schema; F's reveal modal renders the Tier-3 set).

## 3. Investigation findings (current repo state)

- **Playwright is NOT a dependency** — no `@playwright/test` in either `package.json`, no `playwright.config.*`, no `apps/web/e2e/` directory. H must **add `@playwright/test` to `apps/web` devDependencies** and run `playwright install --with-deps chromium` in CI.
- **Package manager:** root declares `pnpm@9.12.0`. Web test command is `pnpm --filter @after5/web test`. (Root `db:test` is a raw `psql` loop, not pnpm.)
- **SQL suite runner:** `npm run db:test` = `for f in supabase/tests/*.sql; do psql … -v ON_ERROR_STOP=1 -f "$f" || exit 1; done`. Tests are `DO $$ … RAISE EXCEPTION on failure $$` blocks; clean exit = PASS. `_fixtures.sql` provides `mk_user/mk_itinerary/mk_instance`. `.sh` race harnesses (`z_chat_thread_races.sh`, `p5_concurrency_lib.sh`) are separate.
- **Deno edge tests:** unit tests (`supabase/functions/match-*/index.test.ts`, `_shared/*.test.ts`) import `{ handler }` from `index.ts` and use the `_shared/_test_supabase_stub.ts` stub via `_shared/_test_import_map.json`. They run with `deno test --allow-env --allow-net --import-map=supabase/functions/_shared/_test_import_map.json supabase/functions/`. These are **pure/stubbed** — they do NOT need a live stack or functions-serve. (Note the dual naming: some files are `*.test.ts`, one is `notify_test.ts` — the glob must catch both; `deno test <dir>` picks up both `_test.ts` and `.test.ts`.)
- **Vitest:** `vitest.workspace.ts` = node project (`packages/*`) + web project (`apps/web`, jsdom). `vitest run --project web` runs the D-G component/route tests with jest-axe a11y.
- **Local stack ports** (`supabase/config.toml`): API `54321`, DB `54322`, Studio `54323`, Mailpit/inbucket `54324`. Local default publishable key = `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH`. `enable_signup=true`, `enable_confirmations=false` (email OTP works without a real SMTP; Mailpit captures it).

## 4. Architecture

### 4.1 — `_all_5b.sh` master runner

`set -euo pipefail`. A bash file that runs the whole pyramid in dependency order and exits non-zero on the first failure. Stages (per overview §4.4):

```
0. preflight  — assert stack reachable (pg_isready on 54322); assert functions-serve health
1. db reset   — supabase db reset  (clean slate; applies all Z/A/B/C migrations + seed.sql)
2. SQL suite  — npm run db:test     (Z + A + B + C psql; covers Z→A→B→C order in filename sort)
3. SQL races  — bash the .sh race harnesses (z_chat_thread_races.sh, p5_concurrency_lib consumers)
4. Deno edge  — deno test --allow-env --allow-net --import-map=…/_test_import_map.json supabase/functions/
5. Web vitest — pnpm --filter @after5/web test   (D + E + F + G components)
6. E2E        — pnpm --filter @after5/web exec playwright test   (H happy + negatives)
```

**Ordering note.** The literal Z→A→B→C→(D/E/F/G)→H dependency order is satisfied two ways: (a) the psql suite runs files in `supabase/tests/*.sql` sort order, where the `z_`/`a_`/`b_`/`c_` prefixes already sort correctly; (b) the *stage* order above runs SQL (Z-C) before web (D-G) before E2E (H). The script does NOT re-implement per-sub-project gating beyond stage ordering — a failure anywhere aborts via `set -e`.

**Functions-serve responsibility.** `_all_5b.sh` is the orchestrator. It is responsible for ensuring `supabase functions serve` is up before stage 6 (the E2E), because the E2E drives real match RPCs (reality #1). Two options were considered:
- (A) `_all_5b.sh` starts functions-serve as a background job before stage 6, traps EXIT to kill it.
- (B) Playwright `globalSetup` starts/health-checks it.

**Decision:** `_all_5b.sh` owns starting functions-serve (background, with a readiness poll + EXIT trap to clean up), AND Playwright's `globalSetup` *health-checks* it (probes `/functions/v1/match-shortlist` for a non-503) and fails fast with a clear message if it is down. Belt-and-suspenders: the script guarantees it for the run-all path; the global-setup guard catches the "developer ran `playwright test` directly without functions-serve" case with an actionable error rather than a confusing UI timeout. The Deno unit tests (stage 4) do NOT need functions-serve (they use the stub).

Exit semantics: any non-zero stage propagates (`set -e`); the EXIT trap tears down the background functions-serve regardless of pass/fail.

### 4.2 — Playwright config (`apps/web/playwright.config.ts`)

- `testDir: './e2e'`, `testMatch: '5b-*.spec.ts'`.
- `webServer`: command `pnpm --filter @after5/web dev` (or `next start` against a prebuilt build in CI) launched **forced-local**:
  ```
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  }
  url: 'http://127.0.0.1:3000', reuseExistingServer: !process.env.CI
  ```
  This is reality #2 — the spawned Next process gets local URL+key inline and never reads the prod `.env.local`.
- `use`: `baseURL: 'http://127.0.0.1:3000'`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`.
- `globalSetup: './e2e/_helpers/global-setup.ts'` — health-checks functions-serve (reality #1) and (optionally) asserts the stack is reachable; throws with remediation text if not.
- `projects`: single `chromium`. `workers: 1` in CI (the seed mutates shared DB state; serial avoids cross-test interference). `timeout`/`expect.timeout` generous enough for Realtime fan-out (the happy path must complete in <5 min per acceptance).
- `reporter`: `list` locally, `['html', 'github']` in CI.

### 4.3 — Two-context Playwright architecture

The happy path is inherently **two-actor**: a host and a candidate acting concurrently against shared state. Playwright models this with **two independent `BrowserContext`s** (isolated cookie jars / storage) inside one test:

```
const hostContext = await browser.newContext();
const candContext = await browser.newContext();
const hostPage = await hostContext.newPage();
const candPage = await candContext.newPage();
```

Each context authenticates as its own seeded user via the PKCE helper (reality #4). Because contexts have separate cookie stores, the two SSR sessions never collide. The test then interleaves actions: candidate swipes right → host sees the interest (Realtime) and shortlists + offers → candidate sees the offer and accepts → **both** pages assert the lock/reveal state. We do NOT use Playwright `storageState` files for this (the PKCE verifier-cookie exchange is dynamic per run); instead each context logs in live at test start.

### 4.4 — Helpers

**`apps/web/e2e/_helpers/auth.ts`** — `loginAs(context, email)`:
1. `page.goto('/login')`, fill the email input, click the "Email me a sign-in link" button.
2. Poll Mailpit (`http://127.0.0.1:54324/api/v1/messages?limit=10`), find the newest message addressed to `email`, fetch `/api/v1/message/<id>`, regex out `https?://[^"\s]*auth/v1/verify\?token=pkce_[^"&\s]*&redirect_to=[^"\s]*`.
3. `page.goto(verifyUrl)` in the SAME page/context → wait for redirect to the authed landing route. Returns once `page` is on an authed route (assert no bounce to `/login`).
Uses `context.request` (Playwright's APIRequestContext) for the Mailpit fetches so it shares no auth with the page. Retries the Mailpit poll (email delivery is async) with a short backoff + timeout.

**`apps/web/e2e/_helpers/seed.ts`** — `seedTwoUsersAndNight()`:
- Uses `@supabase/supabase-js` createClient with the **local service-role key** (from `SUPABASE_SERVICE_ROLE_KEY` env, defaulted to the well-known local CLI key) to bypass RLS, OR shells out to `psql` against `54322`. **Decision: service-role JS client** — keeps the helper self-contained, no psql dependency in the web package, and mirrors how the app's server actions seed.
- Creates two `auth.users` (host + candidate) with known emails (e.g. `host+<runid>@e2e.local`, `cand+<runid>@e2e.local`) via the Admin API (`auth.admin.createUser`, email_confirm true) — emails are unique-per-run to avoid Mailpit cross-talk between retries.
- Promotes both profiles per reality #5 (birthdate first, then dating_enabled/verified/done/city/photos/gender/prefs). Resolves local Kelowna `city_id` via `cities where slug='kelowna'`.
- Creates host itinerary + `date_instances` (status `seeking`, starts +5 days).
- Flips `feature_config.match_v2_enabled = true` (reality #3).
- Returns `{ hostEmail, candEmail, hostId, candId, instanceId }`.
- Provides a `cleanup()` (delete the seeded rows + auth users) called in `afterAll` / `afterEach` so reruns are idempotent. Unique-per-run emails make this best-effort rather than strictly required.

### 4.5 — Happy path (`5b-happy-path.spec.ts`)

One test, two contexts (§4.3):
1. `seedTwoUsersAndNight()` in `beforeAll`.
2. `loginAs(hostContext, hostEmail)`; `loginAs(candContext, candEmail)`.
3. Candidate navigates the feed, swipes right on the host's night (writes `swipes` + the S5 hook calls `match_ingest_interest` → a `queue_entries` row, status `interested`).
4. Host opens `/dates/[instanceId]/interested`, sees the candidate appear (Realtime), drag-ranks/shortlists, opens MakeOfferModal, confirms the offer → `match-make-offer` edge → `offers` row.
5. Candidate opens `/offers/[offerId]`, sees the countdown, clicks Accept → `match-accept-offer` edge → `lock` created (status `active`), off-market cascade fires.
6. **Both** assert the lock/reveal: host on `/matches/[lockId]` and candidate likewise see the MatchConfirmation overlay + Tier-3 reveal modal (`first_name, age, city, neighborhood, clear_photo_url, vibe_tags` — reality #6). Optionally assert a DB row (`locks.status='active'`) through the seed client.

### 4.6 — Negatives (`5b-negatives.spec.ts`)

Three scenarios (overview §1-H / §4.3):
1. **Expired offer.** Seed an `offers` row whose `expires_at` is already in the past (service-role insert), navigate the candidate to `/offers/[offerId]`, assert the "expired" UI state and that Accept is disabled / raises `offer_expired`/`P5007`.
2. **Account-gated.** Seed a host who makes an offer to a candidate whose `account_state`/`verification`/`standing` fails the gate (e.g. not verified), assert `match_make_offer` surfaces `P5002` (account_gated) — driven either through the host UI error toast or a direct edge call asserting the 4xx body. **Decision:** assert via a direct `context.request` POST to `/functions/v1/match-make-offer` with the host JWT, checking the JSON error code, because the host UI may not expose the recipient's gate reason — the edge response is the contract surface and is the more robust assertion.
3. **Concurrent accept.** Two candidates (or two contexts for the same offer is impossible — one recipient; so model it as two overlapping offers/instances where accepting one must cascade-cancel the other, OR fire two `match-accept-offer` requests racing the SAME offer from one context). **Decision:** fire two near-simultaneous `match-accept-offer` calls against the same offer via `Promise.all` of two `context.request` POSTs; assert exactly one returns ok/200 and the other returns the `time_conflict`/already-resolved error. This exercises the advisory-lock + GiST-exclusion path from the HTTP edge rather than re-testing the SQL race (which A's `.sh` harness already covers) — H's job is the transport-level concurrency assertion.

### 4.7 — CI workflow (`.github/workflows/5b-tests.yml`)

`on: pull_request: branches: [main]` (+ `push` to main optional). Stages:
1. **paths-filter** — a `dorny/paths-filter` (or a `paths-ignore` on the trigger) step that skips the heavy job when only `**.md` / `docs/**` changed. Implemented as a gate job whose output the test job `needs:` + `if:`.
2. **test job** (ubuntu-latest):
   - checkout; setup-node (22) + pnpm (9.12.0) + cache; `pnpm install`.
   - install Supabase CLI; `supabase start` (brings up stack; `[analytics] enabled=false` already avoids the Colima-only issue, fine on Linux CI).
   - export local keys: `SUPABASE_URL`, `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from `supabase status -o env`.
   - **`supabase functions serve` in the background** with those envs (reality #1), poll until healthy.
   - setup Deno; install Playwright browsers (`pnpm --filter @after5/web exec playwright install --with-deps chromium`).
   - run `bash supabase/tests/_all_5b.sh` (which itself reset → SQL → Deno → vitest → Playwright). The web server for Playwright is launched by Playwright's own `webServer` (forced-local env) — CI sets `CI=true` so `reuseExistingServer:false`.
   - upload the Playwright HTML report + traces as an artifact on failure.

CI starts functions-serve at the *job* level (so it is up for the whole run incl. the E2E), and `_all_5b.sh` also guards it — consistent with §4.1's belt-and-suspenders.

## 5. What runs where: local sandbox vs CI

| Layer | This local sandbox (now) | CI (GitHub Actions) |
|---|---|---|
| SQL suite + races | YES — stack is up, `npm run db:test` works | YES |
| Deno edge unit tests (stubbed) | YES — no stack needed | YES |
| Web Vitest (D-G) | YES (jsdom) | YES |
| Playwright happy/negatives | **Partially.** Requires: stack up + `supabase functions serve` running + a forced-local `next dev` + Mailpit reachable + Chromium installed. Achievable here once functions-serve + a local Next dev are started, but this sandbox has not historically kept all three running simultaneously, and `@playwright/test` + browsers are not yet installed. Treat full happy-path E2E as **CI-primary**; locally it is runnable but more setup-heavy. | YES — the workflow provisions all of it deterministically |

**Honest scoping:** H's *authoring* (this spec + the plan + the files) is fully doable now. *Green E2E locally* depends on bringing up functions-serve + a forced-local dev server in this session, plus a one-time `playwright install`. The plan's "run locally" step documents exactly that bring-up; if any piece can't run in-sandbox, CI is the source of truth (acceptance criterion: the workflow goes green on a draft PR).

## 6. Bug-class guardrails (these already cost 9 fixes — design defends each)

- **Route-param consistency:** specs read `[instanceId]`, `[offerId]`, `[lockId]` exactly as D/E/F created them; the plan greps the real route dirs before hardcoding.
- **Columns-that-exist:** seed.ts uses only the columns proven in `scripts/5b-smoke-prod/*.sql` + `_fixtures.sql`; Tier-3 assertions use the reality-#6 field list, not the stale overview list.
- **RLS user-context reads:** cross-user reads in the E2E go through the correct context's JWT (host reads candidate only post-lock); the seed client uses service-role only for *writes/setup*, never to fake a user read the test means to verify.
- **FK-hinted embeds:** seed creates `itineraries` before `date_instances` (FK order).
- **Server/client boundary:** the auth helper drives the real `/login` → `/auth/callback` SSR-cookie exchange (not a client-only token inject) so the RSC gate is satisfied.
- **Unique Realtime channel names:** N/A to H directly, but the happy path's Realtime waits use `expect(...).toBeVisible({timeout})` polling rather than asserting on a specific channel, so a channel-name regression surfaces as a visible-timeout failure (caught), not a false pass.

## 7. Acceptance criteria

1. `@playwright/test` added to `apps/web` devDependencies; `playwright.config.ts` exists with forced-local `webServer` + functions-serve `globalSetup` guard.
2. `apps/web/e2e/_helpers/auth.ts` logs a context in via the real PKCE + Mailpit flow; `seed.ts` seeds two promoted users + a posted night + flips the flag, with cleanup.
3. `5b-happy-path.spec.ts` runs two contexts through swipe → shortlist → offer → accept → reveal; both contexts see the lock/reveal. Completes < 5 min.
4. `5b-negatives.spec.ts` covers expired offer, account-gated (P5002), concurrent accept (one wins / one `time_conflict`).
5. `supabase/tests/_all_5b.sh` (`set -euo pipefail`) runs db-reset → SQL → Deno → Vitest → Playwright in order, starts+tears-down functions-serve around the E2E, exits non-zero on any failure.
6. `.github/workflows/5b-tests.yml` runs on PRs to main, provisions stack + functions-serve + Deno + Playwright browsers, runs `_all_5b.sh`, uploads report on failure, skips docs-only PRs via paths-filter. Goes green on a draft PR.
7. H merged to `main`.

## 8. Autonomous decisions (locked here, no further brainstorm)

- **functions-serve ownership:** `_all_5b.sh` starts it; Playwright `globalSetup` health-checks it. (§4.1)
- **seed.ts mechanism:** service-role JS client, not psql shell-out. (§4.4)
- **Unique-per-run seed emails** to avoid Mailpit cross-talk; cleanup is best-effort. (§4.4)
- **Concurrent-accept negative** = two racing HTTP `match-accept-offer` POSTs on one offer via `Promise.all`, asserting one winner. (§4.6)
- **Account-gated negative** asserts the edge JSON error code via `context.request`, not a UI toast. (§4.6)
- **Single chromium project, workers:1 in CI** (shared mutable DB state → serial). (§4.2)
- **No `storageState` reuse** — live PKCE login per context per run. (§4.3)
- **paths-filter** via a gate job + `needs/if` (works with required-status-checks better than `paths-ignore`).

## 9. Divergences from the roadmap/overview text

- Overview §4.4 step 7 says `pnpm -r --filter ./apps/web test`; the real command is `pnpm --filter @after5/web test` (the package name, matching `apps/web/package.json`). Plan uses the real form.
- Overview/old acceptance lists describe the reveal as `first_name, age, photos[], bio, city, expectations[]`. The **live Tier-3 shape** is `first_name, age, city, neighborhood, clear_photo_url, vibe_tags` (reality #6). Assertions follow the live shape; F's spec is the authority.
- Concurrent-accept "second loser sees `time_conflict`": modeled at the HTTP edge layer (§4.6), since one offer has one recipient — we race two POSTs rather than two recipients.

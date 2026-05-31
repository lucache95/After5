# After5 — Prod R2 Traversal Punch-List (2026-05-31)

Gaps surfaced while manually driving the first real prod dating-loop traversal (cohort = `r2host` 3e7e47b2 / `r2cand` 95215f53, both cohort-unblocked + in `match_cohort`). Theme: the dating UI was **built + locally-tested but never exercised on prod as a real user** — exactly what the reality/infra audits predicted. Confirmed-working: login (via `/auth/confirm`), discover feed, swipe → `record_swipe` → `queue_entry` (3 `interested` rows verified in DB).

## Punch-list — status (batch fixed 2026-05-31 PM, deployed `c9bc3b7`)

1. ✅ **Auth — admin links failed `no_code`** → FIXED earlier: `/auth/confirm` token-hash route (verifyOtp). Deployed.
2. ⏳ **Email magic-link rate-limited** (Supabase built-in emailer, `over_email_send_rate_limit`) → needs **Resend custom SMTP** in the Supabase **Auth → SMTP** dashboard (host `smtp.resend.com`, user `resend`, pass = a Resend API key, from = a verified `RESEND_FROM` domain). **USER/DASHBOARD action** — not code; `RESEND_API_KEY` is on Vercel but Auth email is configured in the Supabase dashboard, and the Resend sending domain must be DNS-verified.
3. ⏳ **Landing/how-it-works polaroids all identical** → `apps/web/public/gallery/` is **gitignored** ("copyrighted Pinterest saves"), 404s on prod, falls back to one placeholder. **Needs ship-safe (AI-gen/licensed) committed images** — an asset decision, deferred for human input.
4. ✅ **Swipe-deck green wash bleeds to all cards** → FIXED `fa7d831`: `SwipeDeck.tsx` ActiveCard resets the drag motion value `x` (→ overlay opacity 0) when the card id changes, plus the existing per-card remount key.
5. ✅ **Nav dead tabs** → FIXED `901eecd`: `dates` bottom-nav tab now links to a new `/my-nights` host-nights list (status pills, links to `/dates/[id]/interested`). `messages` stays a Phase-7 coming-soon stub. (Host surface lives at `/my-nights` because `/dates` is the public SEO catalog.)
6. ✅ **Page-level flag gating ignores the cohort allowlist** → FIXED `a537e7a`: added no-arg SECURITY DEFINER `app_match_enabled_self()` (= `app_match_enabled(auth.uid())`, granted `authenticated` only, anon denied), applied to prod; the 5 pages (`/dates/[id]/interested`, `/offers/[id]`, `/matches`, `/matches/[id]`, `/rate`) now gate via the shared `isMatchEnabledForViewer()` helper instead of the raw global flag. **Global `match_v2_enabled` flipped OFF after the deploy went live** — cohort works with the flag OFF; obligation closed.
7. ✅ **Persona ID/age verification** → FIXED this session: created the Persona webhook (`wbh_A2qFsmNvZMHxm4fJWNqdhg1WgE2W8J`, kebab inflection, inquiry events) → `https://ufufmcpnysvwtutpbian.supabase.co/functions/v1/persona-webhook`, and set `PERSONA_WEBHOOK_SECRET` on prod edge. `start-verification` already passes `reference-id = uid`. ⚠️ Webhook created in Persona **Sandbox** — confirm prod `PERSONA_API_KEY` is a sandbox key (else recreate in Production env); needs a live end-to-end inquiry test.

## Recommended next step — systematic walkthrough
Manual click-through finds these one-at-a-time. Run a **Playwright two-context (host+candidate) walkthrough against prod** (cohort auth via `/auth/confirm` admin links), traversing discover→swipe→interested→offer→accept→lock→reveal→rate, cataloguing every UI gap in one pass. Build on sub-project H's happy-path E2E. Output: a complete punch-list to fix as a batch.

## ⚠️ Open obligation
`match_v2_enabled` was flipped **ON** on prod 2026-05-31 ~18:57 UTC for the attended R2 test. **Flip it OFF** (`update feature_config set value='false' where key='match_v2_enabled'`) once the traversal is done — leaving it ON is only safe while organic verification stays closed.

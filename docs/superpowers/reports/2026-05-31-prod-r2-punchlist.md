# After5 — Prod R2 Traversal Punch-List (2026-05-31)

Gaps surfaced while manually driving the first real prod dating-loop traversal (cohort = `r2host` 3e7e47b2 / `r2cand` 95215f53, both cohort-unblocked + in `match_cohort`). Theme: the dating UI was **built + locally-tested but never exercised on prod as a real user** — exactly what the reality/infra audits predicted. Confirmed-working: login (via `/auth/confirm`), discover feed, swipe → `record_swipe` → `queue_entry` (3 `interested` rows verified in DB).

## Punch-list

1. **Auth — admin links failed `no_code`** → FIXED: added `/auth/confirm` token-hash route (verifyOtp). Deployed.
2. **Email magic-link rate-limited** (Supabase built-in emailer, `over_email_send_rate_limit`) → needs **Resend custom SMTP** in Auth settings (RESEND_API_KEY already on Vercel; verify Resend domain).
3. **Landing/how-it-works polaroids all identical** → `apps/web/public/gallery/` is **gitignored** ("copyrighted Pinterest saves"), 404s on prod, falls back to one placeholder. Need ship-safe (AI-gen/licensed) committed images.
4. **Swipe-deck green wash bleeds to all cards** → `apps/web/app/feed/SwipeDeck.tsx` ~L210-216: the top-card drag "interested" overlay (`bg-emerald-500/35`) opacity/`x` not reset as the next card surfaces. Cosmetic; data unaffected.
5. **Nav dead tabs** → `dates` + `messages` bottom-nav tabs are "coming soon" stubs. **Host has NO in-app path to posted nights / interested lists** — `/dates/[id]/interested` is direct-URL only. Wire the `dates` tab → host's nights → interested/candidate lists.
6. **Page-level flag gating ignores the cohort allowlist** → host/match pages (`/dates/[id]/interested`, `/offers/[id]`, `/matches`, `/matches/[id]`, `/rate`) gate on the **raw global `match_v2_enabled`** (client read → ComingSoonBanner), NOT `app_match_enabled(user)`. So cohort users see "matching launches soon." **Fix: make these pages call `app_match_enabled` so the cohort works with the global flag OFF.** (Interim: global flag flipped ON 2026-05-31 for the attended test — MUST flip OFF after.)
7. **Persona ID/age verification broken** → `PERSONA_WEBHOOK_SECRET` blank on prod → persona-webhook fails closed → organic users can't clear the verification gate (phone now works via Twilio).

## Recommended next step — systematic walkthrough
Manual click-through finds these one-at-a-time. Run a **Playwright two-context (host+candidate) walkthrough against prod** (cohort auth via `/auth/confirm` admin links), traversing discover→swipe→interested→offer→accept→lock→reveal→rate, cataloguing every UI gap in one pass. Build on sub-project H's happy-path E2E. Output: a complete punch-list to fix as a batch.

## ⚠️ Open obligation
`match_v2_enabled` was flipped **ON** on prod 2026-05-31 ~18:57 UTC for the attended R2 test. **Flip it OFF** (`update feature_config set value='false' where key='match_v2_enabled'`) once the traversal is done — leaving it ON is only safe while organic verification stays closed.

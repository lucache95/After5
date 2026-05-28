# Loop 5a Finalization Plan

> **For agentic workers:** Execute task-by-task. Tasks 1 & 2 can run in parallel (independent). Task 3 depends on Task 2's findings. Task 4 depends on Task 3 green.

**Goal:** Land the remaining 5a polish (design-system capture + a11y/visual audit + fixes), then merge `feat/loop-5a-post-browse` → `main`. Sets up clean ground for Phase 5b (Match & Lock).

**Architecture:** Two independent parallel tasks (doc edit + read-only audit), then a dependent fix task, then merge. No new features — purely polish + capture.

**Tech Stack:** Markdown (DESIGN-SYSTEM.md), Playwright MCP (HTTP :8931), axe-core (via `browser_evaluate`), existing Tailwind 3.4.17 + framer-motion stack.

---

## Context (read first)

- Branch: `feat/loop-5a-post-browse` (Step 2 + onboarding/home/shell shipped, branding locked: warm-filmic + pink accent + polaroid + Caprasimo/Fredoka).
- MP design at `magicpatterns.com/c/3whblzj3skdhzhhknxyzii` already inspected; this plan captures the borrow-list.
- Auth recipe for local QA: memory `reference_local-qa-browser-login.md` (PKCE via `/login` + Mailpit, NOT admin `generate_link`).
- QA account: `lucache95@gmail.com` (UUID `5f387641-2ee9-443a-abb8-bb7f8e48a1a0`), done/verified/dating_enabled.
- Dev server expected forced-local: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 ...`.
- Earlier this session: `better-animation` skill applied 4 motion fixes; `audit-a11y` skill consulted (not yet run as real axe-core sweep).

---

## Task 1: Fold MP borrow-list into DESIGN-SYSTEM.md

**Files:**
- Modify: `docs/superpowers/DESIGN-SYSTEM.md`

**Why:** Capture the genuinely-useful patterns observed in Magic Patterns design so future phases (esp. 5b) build against them instead of re-deriving. Documentation only — no code changes.

**Borrow-list (concrete additions):**

1. **`tagBg` — 4th per-experience color in vibePalette.** Today vibePalette returns `{bg, accent, ink}`. Add `tagBg` for tag-chip backgrounds distinct from card bg. Update spec section that documents the Tier-2 contract; add a note in `packages/business/src/vibePalette.ts` reference (don't change code — just doc the addition as upcoming).

2. **Emoji-paired vibe tags.** Document the `{label, emoji}` chip pattern (e.g. ✨ Creative, 🍷 Boozy, 🌙 Evening, 🎷 Music). Add an "Imagery & Iconography" subsection or extend §Chips with an emoji-mapping table. Note: emoji per canonical vibe tag, not free-form per chip.

3. **`expectations[]` field on date_instances.** A short "what to expect" list per posted night (e.g. "Getting messy", "Learning a new skill", "Good conversation"). Document as a card/detail content element — anxiety-reducer, sets tone. Don't add to schema yet; capture as upcoming data shape.

4. **ExperienceDetail screen** — tap-card → full detail (description, expectations, host) before deciding. Add to IA section as a planned screen between feed-card and swipe-decision. Note this is post-5b polish (5b's Match & Lock is higher priority).

5. **Secondary accents `sage` (#5CDBA0) + `blush` (#FFB3D1).** Document as Tier-1 OPTIONAL accents (NOT primary) for success states (sage on match-confirmed) and softer pink backgrounds (blush). Add to token reference table. Do not add to `tailwind.config.ts` yet.

**Constraints:**
- Additive only. Don't restructure existing sections.
- Don't change any code or tokens — this is documentation capture.
- Match the doc's existing voice (concise, opinionated, examples).
- Mark each as "Planned" or "Reserved" where it's not yet implemented.

**Deliverable:** Updated `DESIGN-SYSTEM.md` + brief summary of which sections were touched.

---

## Task 2: A11y + Visual Audit (read-only, parallel-safe)

**Files:**
- Create: `docs/superpowers/plans/audits/2026-05-27-loop-5a-a11y-visual.md`

**Why:** Real axe-core sweep + contrast + visual screenshot walk over the routes we just restyled. The earlier `audit-a11y` skill consultation was advisory — this is the real test before merge. Catches regressions before 5b is layered on top.

**Routes to audit:** `/login`, `/home`, `/feed`, `/nights/new`. (Skip `/onboarding/*` for now — covered by S3 work.)

**Method (use Playwright MCP via existing :8931 HTTP server):**

1. **Verify dev server.** `curl -sI http://localhost:3000/login` → expect 200. If down, **STOP** and report; do not start the server yourself (env vars matter).

2. **Authenticate browser session via PKCE recipe** (memory `reference_local-qa-browser-login.md`):
   - `browser_navigate` → `/login`
   - `browser_type` email `lucache95@gmail.com` → submit
   - Fetch latest Mailpit message: `curl http://127.0.0.1:54324/api/v1/messages?limit=1` → extract message ID → `curl http://127.0.0.1:54324/api/v1/message/<id>` → regex the `auth/v1/verify?token=pkce_...&redirect_to=...` URL
   - `browser_navigate` to that URL → lands authed

3. **For each route, capture:**
   - `browser_resize` to 390×844 (iPhone 15 viewport) — this is a mobile-first app.
   - `browser_snapshot` (structural a11y tree).
   - `browser_take_screenshot` (visual proof; save under `docs/superpowers/plans/audits/screens/`).
   - `browser_evaluate` with axe-core injected from CDN: `https://cdn.jsdelivr.net/npm/axe-core@4.10.0/axe.min.js` (use `fetch` + `eval` pattern inside `browser_evaluate`). Run `axe.run()` and collect `violations`.
   - Contrast spot-checks: pink-on-cream (`#E0218A` on `#FAF4EC` ≈ 3.9:1), small chip text (11px), `swipe.nope` overlay (`#3A0410` at 55% over photos). Report ratios.

4. **Categorize findings:**
   - **Critical** — WCAG AA failures (contrast < 4.5:1 on body text, missing labels, keyboard trap, focus-not-visible, broken aria).
   - **Important** — WCAG AA on large text (< 3:1), missing landmarks, lowercase-only h1, motion-reduce gaps.
   - **Polish** — heuristic gripes (touch target < 44px, ambiguous icon-only buttons, color-only signaling).

5. **For each violation:** include file + line if obvious (use Read/Grep), the offending element (selector or snapshot excerpt), and a one-line proposed fix.

**Constraints:**
- READ-ONLY. Do not edit any source file. Audit produces a report only.
- If Playwright MCP tools aren't bound in your session, STOP and report — don't fall back to manual curl-only.
- Save screenshots to `docs/superpowers/plans/audits/screens/<route>.png` (gitignore-safe; under our tracked plans dir).
- Don't audit `/onboarding/*` (out of scope).
- Cap depth: 30 min worth of audit, then stop and write the report. We can deepen later.

**Deliverable:** `docs/superpowers/plans/audits/2026-05-27-loop-5a-a11y-visual.md` with Critical/Important/Polish sections, each finding `{ route, element, issue, fix, severity }`. Plus screenshots.

---

## Task 3: Apply audit fixes (depends on Task 2 output)

**Files:** TBD — derived from Task 2 findings.

**Method:** After Task 2 lands, controller (me) reads the audit report and either:
- Dispatches a focused implementer subagent for Critical + Important findings (full subagent-driven-development: implementer → spec review → quality review).
- Defers Polish-only findings to a tracked TODO (don't block merge on cosmetic items).

**Stopping rule:** If audit produces zero Critical findings → skip Task 3, go straight to Task 4. Polish-only findings get a follow-up issue, not a blocker.

---

## Task 4: Merge `feat/loop-5a-post-browse` → `main`

**Pre-merge gates (must all pass):**
- `pnpm --filter @after5/web typecheck` → green
- `pnpm --filter @after5/web lint` → green
- `pnpm --filter @after5/web test` → all 65+ tests green
- `pnpm --filter @after5/web build` → green (remember: kill dev server first, `rm -rf apps/web/.next`)
- Task 2 audit: zero Critical findings (Important findings tracked in follow-up)
- No uncommitted changes

**Merge:**
- Squash-or-rebase preference: confirm with user.
- After merge: do NOT auto-push (user controls remote operations).

**Post-merge:** Update memory `project_schema-drift-prod-triggers.md` — mark UI loop 5a as merged-to-main (currently says "merged but not Vercel-deployed"; bump the SHA).

---

## What this plan explicitly does NOT do

- **Phase 5b (Match & Lock)** — separate brainstorm + spec + plan. Don't start.
- **Vercel deployment** — separate launch-readiness track. Don't deploy.
- **Edge function deploy / secrets / migration reconciliation** — separate launch-readiness track.
- **Add `tagBg` / sage / blush to `tailwind.config.ts`** — documentation only in Task 1.
- **Implement `expectations[]` schema column** — documentation only in Task 1.
- **Re-run the `better-animation` skill** — already applied 4 fixes earlier this session.

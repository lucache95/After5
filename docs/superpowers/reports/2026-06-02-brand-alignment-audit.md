# Brand-Alignment Audit — legacy planner vs new Barbiecore dating app (2026-06-02)

**Trigger:** `/plan` still renders the LEGACY brand (serif "After5" wordmark, cream/black/rust, Sentence Case) — screenshot from a tester. Goal: every reachable route must be the NEW Barbiecore dating-app brand (Caprasimo/Fredoka, `shell-*` hot-pink/wine tokens, lowercase, rounded-pill, shadow-fun), and all functionality must work.

**Detection:** NEW = `font-heading`/`font-body` + `shell-*` tokens + lowercase. LEGACY = `font-display`/Fraunces serif + legacy tokens (`bg-background`/`text-text`/`border-border`/`bg-primary`/`bg-surface`/`accent`) + Title/Sentence Case + serif "After5" wordmark.

## Verdict by route

### ✅ NEW (Barbiecore) — no change (the dating app)
`/` , `/home`, `/feed`, `/matches`, `/matches/[lockId]`, `/matches/[lockId]/rate`, `/messages`, `/messages/[threadId]`, `/offers/[offerId]`, `/reciprocal/[pairId]`, `/nights/new`, `/my-nights`, `/create`, `/plans/[id]/edit`, `/login`, `/account`, `/account/profile`, `/account/notifications`, `/account/saved`, `/onboarding` (+ welcome/basics/preferences/photo/phone/verify/done).

### 🔴 LEGACY — reachable + user-facing → must rebrand OR redirect/retire
- **`/dates`, `/dates/[slug]`, `/dates/[slug]/interested`** — CRITICAL: core dating catalog page shell/header is legacy (`font-display`, `border-border`/`bg-primary`/`text-text`, Title Case "Every Kelowna date plan", serif After5). NOTE: the InterestedList *component* is Barbiecore (M-work) but the PAGE WRAPPER/header around it is legacy — verify per-page (header/footer vs inner content).
- **`/plan`, `/plan/i/[id]`** — the legacy date planner (the screenshot). New equivalent = `/create`. Linked from footer "plan a night" on every legacy page.
- **`/places`, `/places/[slug]`, `/neighborhoods`, `/neighborhoods/[slug]`, `/types`, `/types/[slug]`, `/vibes`, `/vibes/[vibe]`** — legacy catalog/SEO pages, linked from a LEGACY NAVBAR (still rendered on planner pages).
- **`/join`, `/insiders`** — legacy (`font-display` serif wordmark, `bg-background`/`text-text`, Title Case).
- **`/about`, `/roadmap`, `/tell-us`** — legacy marketing (warm-cream, polaroid motifs, Title Case).
- **`/unsubscribe`** — mixed (legacy tokens + Title Case).

### 🟚 LEGACY but ORPHANED (only reachable from planner flows) → retire or rebrand-if-kept
`/templates/[id]`, `/wow/[id]`, `/vote/[id]` (vote uses modern-ish tokens but is a planner-voting flow).

### ⚪ UTILITY — leave as-is (intentionally neutral / internal)
`/privacy`, `/terms` (neutral legal), `/offline` (already uses #FAF4EC/#E0218A), `/admin` + children (internal curator tool, `font-display`, no user brand exposure).

## The strategic question (NEEDS OWNER DECISION)
The legacy pages are the **old standalone date-planner product's** surface (catalog/SEO/marketing). The new product is the **dating app**. For each legacy cluster, choose:
1. **`/plan` + `/plan/i/[id]`** → **redirect to `/create`** (recommended — `/create` is the Barbiecore replacement; the rich 5-step questionnaire is the main thing lost, so alternatively rebrand `/plan` if that questionnaire is wanted) — DECISION NEEDED.
2. **Catalog pages (`/places`,`/types`,`/vibes`,`/neighborhoods`, `/templates`,`/wow`)** → these are planner-era SEO/browse. Options: (a) rebrand to Barbiecore if kept for SEO, (b) retire (410/redirect to `/feed` or `/create`). Recommend **retire/redirect** unless SEO traffic matters.
3. **Legacy NAVBAR** linking to catalog pages — find + remove/replace (it's the thing surfacing legacy IA). Likely a legacy `<Nav>`/`<Header>`/`<Footer>` component used by the planner layout.
4. **`/join`, `/insiders`, `/about`, `/roadmap`, `/tell-us`, `/unsubscribe`** → rebrand to Barbiecore (these are real reachable pages).

## Functional verification (the second ask)
Beyond brand, every route must WORK. Current automated coverage: Chromium e2e (13 specs) covers the core dating loop (5b swipe→offer→accept→reveal, chat, m2 create, m3 edit, m5 detail). NOT covered: the legacy catalog/marketing routes + a full click-through of every nav path. Plan: after the brand decision, do a route-by-route functional traversal (load each route authed + anon, assert 200/no-crash/no-React-error, key CTA works) — scriptable as a Playwright smoke over the full route list.

## Recommended execution (after decision)
Subagent-driven, batched: (1) kill the legacy navbar/footer + decide redirects; (2) rebrand or redirect each legacy cluster; (3) per-route functional smoke. Each batch: implement → typecheck/lint → e2e → commit. Gate prod redirects (they're outward-facing).

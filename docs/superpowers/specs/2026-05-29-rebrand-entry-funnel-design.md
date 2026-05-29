# Design spec — rebrand the dating entry funnel

Date: 2026-05-29
Status: spec (no app code yet)
Strategic decision (LOCKED): **dating is the front door; the planner is the wedge/moat** — kept functional, not deleted, reachable as a secondary "plan a night" path.
Source audit: `docs/superpowers/reports/2026-05-29-launch-branding-audit.md`
Brand law: `docs/superpowers/DESIGN-SYSTEM.md`

## 0. Goal + scope

Rebrand the five P0 surfaces a tester hits before they ever reach the on-brand dating screens (`/onboarding`, `/home`, `/feed`, `/offers`, `/matches`), so the first impression leads with dating, not the date-planner. Fix the dual-dashboard split by routing fresh sign-ins to dating `/home`.

In scope (P0):
1. Landing `apps/web/app/page.tsx` — full rebuild to a dating landing.
2. Login `apps/web/app/login/LoginForm.tsx` — restyle to shell + Caprasimo + dating copy. Mechanics unchanged.
3. Auth callback `apps/web/app/auth/callback/route.ts` — default post-login destination `/account` → `/home`. Preserve explicit `next`.
4. Metadata/OG `apps/web/app/layout.tsx` — title/description/OG copy to dating. Copy-only.
5. Auth emails `supabase/email-templates/{magic-link,confirm-signup,reset-password}.html` — rebrand to Barbiecore dating + wire delivery so the branded versions actually ship.

Out of scope (stays planner, by design): `/plan`, `/vote`, `/wow`, `/vibes`, `/neighborhoods`, `/places`, `/dates`, `/dates/[slug]`, `/account`, `/about`, `/roadmap`, `/join`, `/insiders`. Transactional offer/match emails (roadmap task #22). The `/home` teaser gallery's planner data source.

## 1. Brand tokens (all already loaded — verified)

`tailwind.config.ts` already ships the dating tokens, so this is a class swap + copy rewrite, not a foundation build:
- Color: `bg-shell-base` #FAF4EC, `text-shell-accent` #E0218A (logo/primary CTA/active only), `text-shell-ink` #3D0F2E, `bg-shell-pink` #FFE5F1 (soft washes only). Pink is punctuation, not wallpaper.
- Type: `font-heading` (Caprasimo, lowercase), `font-body` (Fredoka). Both `.variable`s are on `<html>` in `layout.tsx`.
- Shadow: `shadow-fun` (pink-tinted). Radius: `rounded-3xl` primary surfaces.
- Motion: `framer-motion` + `useReducedMotion()`, spring physics (`type: 'spring', stiffness: 360, damping: 30`), `motion-reduce:` Tailwind variants on CSS transitions. Pattern proven in `apps/web/app/onboarding/steps/WelcomeAgeGate.tsx`.
- Polaroid: `@/components/Polaroid` with `tone="dating"`. Real gallery assets live in `apps/web/public/gallery/` (62 ship-safe images — `dinner-laughing.jpg`, `couple-dance-sunset.jpg`, `bar-couple-cozy.jpg`, `rooftop-pizza-sunset.jpg`, `pottery-wheel.jpg`, `bouldering-kiss.jpg`, etc.). No empty `src` — every Polaroid/Image gets a real asset path.

Voice (DESIGN-SYSTEM §3 + stop-slop): lowercase headlines + CTAs, dry, anti-earnest, no Kelowna hardcoding, no "Welcome/Get Started/Continue", no em-dashes. Canonical lines: "swipe on the date, not the guy", "the dating app that's actually fun (we hope)", CTA "let's go", "real people. real nights. zero small talk."

## 2. The dating value prop + copy direction (chosen)

**Lead value prop:** you match around a real night out, not a grid of faces. The plan is the icebreaker; everyone's verified, so who shows up is who's in the photos.

Hero H1 (chosen): **"match on the night, not the guy."** — a sharper variant of the canonical splash line, fitted to a landing headline. Subhead: "after5 builds your match around an actual plan for the evening. everyone's verified. less small talk, more showing up."

Primary CTA: **"let's go"** → `/onboarding`. Secondary (planner wedge, see §4): **"or just plan a night"** → `/plan`.

This register stays consistent across landing, login, OG, and emails so the brand seam never flickers planner.

## 3. Per-surface before/after

### 3.1 Landing `apps/web/app/page.tsx` (full rebuild)

| | Before (planner) | After (dating) |
|---|---|---|
| Structure | Marketing funnel: image hero → quick-start themes → vibe gallery → sample itineraries → ExploreDatesStrip → WowFactorStrip → benefits → testimonials → insiders → planner CTA band → footer | Tight dating landing: photo-led hero → "how it works" 3-step → polaroid scrapbook of real nights → verified/safety reassurance → planner-wedge strip → footer |
| Wordmark/nav | `font-display` "After5" white over hero, `UserMenu`, "Plan my date — free" pill | `font-heading` lowercase "after5" in `shell-accent`; keep `UserMenu` (signed-in users still get their menu); primary nav CTA "let's go" → `/onboarding` |
| H1 | "A Kelowna date worth talking about — in 30 seconds" (Fraunces, amber italic) | "match on the night, not the guy." (`font-heading` lowercase, `shell-ink`) |
| Tokens | `bg-background`/`bg-surface`, `text-text/secondary/muted/accent`, `font-display`, amber/rose ambient blobs | `bg-shell-base`, `text-shell-ink`, `shell-accent` CTA, `shadow-fun`, `font-heading`/`font-body`, soft `shell-pink` wash only |
| Imagery | `/vibes/*`, `/sample/*`, `/pins/*` planner photos | `apps/web/public/gallery/*` via `Polaroid tone="dating"` + `next/image`; tilted/overlapping clusters |
| Data fetch | Server-fetches `itineraries` (live sample plans), `places.local_insight`, count | **Drop all server fetches.** Landing becomes static/presentational (set `export const revalidate` away or make it a plain component). No DB columns referenced → removes the "columns-that-exist" risk class entirely |
| CTAs | "Plan my date", "Surprise me" → `/plan` everywhere | "let's go" → `/onboarding` (primary); "or just plan a night" → `/plan` (secondary, see §4) |
| Footer | "Built in Kelowna … Coming soon to more Okanagan cities" | drop Kelowna; keep legal links (terms/privacy/about) + `hello@tryafter5.app`; lowercase Fredoka |
| Components retired from landing | `ExploreDatesStrip`, `WowFactorStrip`, `HonestTestimonials` (planner), `RecentBuildsToast`, `SafeCoverImage`, `coverImageFor`, `getSeason`, `PLAN_THEMES` | Replaced by inline dating sections + `Polaroid tone="dating"`. These components stay in the repo (planner still uses them); the landing just stops importing them |

**"how it works" 3-step** (lowercase, dry, present-tense — anxiety-reducer per DESIGN-SYSTEM §3):
1. "pick a night, not a face" — browse real plans people posted for the week.
2. "match on the plan" — like a night, they like you back, you're locked in.
3. "show up" — everyone's verified, so the date is the date.

**Verified/safety reassurance** strip: "everyone's id-verified. the person who shows up is the person from the photos." Use `bg-shell-pink/60` wash, `shell-ink` text — the only place a pink wash is allowed.

Motion: hero polaroid cluster + section reveals use the WelcomeAgeGate spring pattern, all gated on `useReducedMotion()`. `page.tsx` is a server component today; the rebuilt landing is mostly static markup, so motion lives in a thin `'use client'` child (e.g. `LandingHero.tsx`) — keeps the server/client boundary clean and pure helpers (none needed) out of client files.

### 3.2 Login `apps/web/app/login/LoginForm.tsx` (restyle, mechanics frozen)

Keep exactly: `Suspense` wrapper, `useSearchParams`, Google OAuth `signInWithOAuth`, magic-link `signInWithOtp`, 60s cooldown, rate-limit error translation, `phase` state machine, `callbackError`/`callbackReason` handling, the `/api/stats` fetch, `GoogleIcon`.

| | Before | After |
|---|---|---|
| `next` default | `searchParams.get('next') ?? '/account'` | `?? '/home'` (matches the callback change in §3.3) |
| Canvas | `bg-background` + amber/rose ambient blobs | `bg-shell-base`; drop the blobs or replace with one faint `shell-pink` radial behind the card |
| Wordmark | "After5" `font-display` `text-text` | "after5" `font-heading` lowercase `text-shell-accent` |
| H1 | "Good to see you." (Fraunces, amber italic "see") | "let's get you in." (`font-heading` lowercase `shell-ink`) |
| Subhead | "Save plans, vote with friends, and skip the email gate next time you build a date." | "sign in to match on real nights near you. no passwords, just a link." |
| Early-access chip | "First 100 Kelowna users", amber gradient ring | Keep the live `remaining`/`claimed` mechanic; restyle to `bg-shell-pink` + `text-shell-ink` ring `shell-accent/15`; copy "first 100 in your city" (no Kelowna) |
| Card | `bg-white/85` amber ring, terracotta shadow | `bg-white/80` `rounded-3xl` `shadow-fun` ring `shell-accent/10` |
| Polaroid accent | inline planner polaroid "KELOWNA · 26" | `<Polaroid tone="dating" />` with a gallery shot, no city label or a neutral "tonight" label |
| Buttons | `bg-text text-background` pills, `focus:ring-accent` | primary `bg-shell-accent text-white shadow-fun` + `focus-visible:ring-shell-accent/40`; Google button `border-shell-ink/15`; copy "email me a link", sent-state "check your inbox" stays |
| Tokens throughout | `text-text/secondary/muted`, `border-text/15`, `focus:ring-accent` | `text-shell-ink`, `text-shell-ink/65`, `border-shell-ink/15`, `font-body` |

No `/signup` route exists — do not add one. Logged-in redirect to `/home` (already correct in `login/page.tsx`).

### 3.3 Auth callback `apps/web/app/auth/callback/route.ts` (routing fix + test)

Two lines change, both `/account` → `/home`:
- L19: `const next = searchParams.get('next') ?? '/home';`
- L76: `const safeNext = next.startsWith('/') ? next : '/home';`

Preserve everything else: `code` exchange, error redirects, `mirrorToSubscribers`, `ensureWelcomeSent`, `claimItineraries` (the itinerary-claim side effect stays — a planner user who signed in still gets their plans claimed; they just land on `/home` now). The L70 comment "lands on /account" gets corrected to "/home".

**Test** (`apps/web/app/auth/callback/__tests__/route.test.ts`, vitest + jsdom, mirroring `app/offers/[offerId]/__tests__` style): mock `@/lib/supabase/server`, `@/lib/supabase/admin`, `@/lib/email/welcome`. Assert:
- no `next` param → redirect Location ends `/home` (not `/account`).
- explicit `?next=/feed` → redirect ends `/feed`.
- open-redirect guard: `?next=https://evil.com` → falls back to `/home`.
- no `code` → redirect to `/login?error=no_code`.

### 3.4 Metadata/OG `apps/web/app/layout.tsx` (copy-only)

| field | before | after |
|---|---|---|
| `title.default` | "After5 — Plan the perfect Kelowna date in 30 seconds" | "after5 — match on the night, not the guy" |
| `description` | "Curated date itineraries … who actually live in Kelowna." | "the dating app where you match around a real night out. everyone's verified. less small talk, more showing up." |
| `openGraph.title`/`description` | planner | mirror the above |
| `openGraph.images[0].alt` | "After5 — Kelowna date planner" | "after5 — match on the night, not the guy" |
| `twitter.title`/`description` | "After5" / "Plan the perfect Kelowna date in 30 seconds." | "after5" / "match on the night, not the guy." |

`og.jpg` swap is a separate asset task — note it but do not block on it (keep the existing path so OG never points at a missing image). Fonts/`metadataBase` untouched.

### 3.5 Auth emails + delivery wiring

**The wiring reality (verified):** `supabase/config.toml` does NOT reference any `[auth.email.template.*]` `content_path` — only commented examples (L249-258) and the SMS `template`. The `supabase/email-templates/README.md` documents that these HTML files are installed by **pasting into the Supabase dashboard** (Authentication → Email Templates), and prod uses dashboard templates. So today prod sends either the dashboard-pasted planner HTML or Supabase defaults — the repo files are reference copies, not the delivery path.

**Rebrand (all three HTML files):** swap planner brand → dating:
- canvas `#FDF9F3` cream → `#FAF4EC` shell-base
- accent `#C2552B` terracotta → `#E0218A` shell-accent; ink `#1A1A1A` → `#3D0F2E` shell-ink
- font stack Inter → a web-safe approximation of Fredoka/Caprasimo (email clients can't load Google fonts reliably): headline uses a rounded-friendly stack `'Trebuchet MS', 'Segoe UI', sans-serif` with a `@font-face`/Google `<link>` for `Fredoka`+`Caprasimo` as progressive enhancement, lowercase; body Fredoka-or-fallback. All critical colors stay inlined (email-client rule).
- copy: wordmark "after5" lowercase; magic-link headline "let's get you in." body "tap below to sign in and match on real nights near you. the link's good for an hour."; footer drops "Kelowna couples" → "the dating app that's actually fun." `{{ .ConfirmationURL }}` token unchanged.
- Polaroid motif: a small CSS-bordered "polaroid" photo block is optional; keep it simple and inline-safe, or skip the photo and keep the typographic rebrand (emails don't need the full scrapbook).

**Wiring decision (chosen):** do BOTH, in two layers:
1. **Authoritative for prod:** update `supabase/email-templates/README.md` so the install steps point at the rebranded files and the dating subject lines, since prod delivery is dashboard-pasted. This is the path that actually changes what a tester receives. The dashboard paste is a manual deploy step listed in the plan's verify section.
2. **Repo-config wiring (additive, low-risk):** add commented-and-then-enabled `[auth.email.template.magic_link]` / `.confirmation` / `.recovery` blocks in `config.toml` with `content_path = "./email-templates/<file>.html"` and the dating subjects. **Risk + mitigation:** wiring `content_path` only affects `supabase start` / local `supabase` auth email rendering and a `supabase config push`; it does NOT override dashboard templates unless pushed. Local auth has `enable_confirmations = false` and uses Inbucket, so a malformed path could break local magic-link rendering. Mitigation: verify each path resolves (the paths are relative to the `supabase/` dir), run `supabase start` (or a config lint) and send one local magic link via `/login` → Inbucket to confirm it renders before considering the task done. Do NOT `supabase config push` as part of this task (prod stays dashboard-driven until the user opts in).

## 4. The planner-wedge secondary path (how it's kept)

The planner is the moat, so every dating entry surface keeps one low-emphasis door to it:
- **Landing:** a single "plan a night" strip near the footer — outlined `shell-ink` (not pink), copy "just want to plan a date? we still do that." → `/plan`. Secondary nav CTA "or just plan a night" is the same link. The planner pages themselves keep their warm-cream brand untouched (DESIGN-SYSTEM §scope: planner tokens stay).
- **Login/callback:** the `next` param is the seam — a user arriving from a planner page (`/plan` → gate → `/login?next=/account`) still returns to `/account`. Only the *default* (no `next`) flips to `/home`. So organic planner traffic is preserved; only the bare dating front-door defaults to dating.
- **No planner pages are restyled or deleted.** They drop out of the dating IA (landing stops linking to `/dates`, `/vibes`, `/wow`, `/join`) but remain reachable by URL and via the one "plan a night" door.

## 5. What stays planner (unchanged)

`/plan`, `/vote`, `/wow`, `/vibes`, `/neighborhoods`, `/places`, `/dates`, `/dates/[slug]`, `/account` (+ `ProfileForm`, `saved/`), `/about`, `/roadmap`, `/join`, `/insiders`, and all planner components (`ExploreDatesStrip`, `WowFactorStrip`, `HonestTestimonials`, `RecentBuildsToast`, themes/season libs). The `/account`-vs-`/home` split is resolved by routing default sign-ins to `/home`; `/account` survives as the planner-user dashboard reachable via `?next=/account`.

## 6. Bug-class guardrails (from this session's costs)

- **Columns-that-exist:** landing rebuild *removes* all DB fetches → no risk. Callback change touches no columns. Login change touches no columns.
- **Server/client boundary:** landing stays a server component; motion goes in a thin `'use client'` child. No `createClient`/server-only imports in client files. Login is already `'use client'`. No pure helpers needed; if any appear, they go in a plain `.ts`.
- **Empty `next/image` src:** every image uses a real `apps/web/public/gallery/*` path; `Polaroid` already guards load failure with a gradient fallback. No nullable `src`.
- **Route consistency:** primary CTA `/onboarding`, planner door `/plan`, login default + callback default both `/home`. Cross-checked.
- **Email config:** `content_path` is relative to `supabase/`; verify resolution + local Inbucket render before done; do not `config push`.

## 7. Self-review (done inline)

- Headline "match on the night, not the guy" — lowercase, dry, no em-dash, no Kelowna, on-voice. PASS.
- No "Welcome/Get Started/Continue/Submit" in any new copy. PASS.
- Pink reserved for logo + primary CTA + one reassurance wash; not a background flood. PASS.
- Planner kept functional + reachable, not deleted; default-only routing flip. PASS (matches LOCKED decision).
- Callback fix is 2 lines + a corrected comment + a 4-case test; explicit `next` preserved. PASS.
- Email task changes what prod actually sends (README/dashboard path) AND wires config additively with a stated local-auth risk + mitigation. PASS.
- Divergence to flag: the audit suggested the landing CTA could go to `/feed`; spec routes primary to `/onboarding` because a fresh tester has no profile and `/feed` redirects/empties without onboarding — `/onboarding` is the correct cold-start door. Noted in plan.
```

## 8. Surfaces needing browser verification
Landing + login (visual/motion/a11y/reduced-motion) and the email render (Inbucket) need a browser. Callback + metadata are unit/inspection-verifiable.

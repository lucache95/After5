# After5 Design System — Gen-Z, Crafted, Mobile-First (canonical)

**This governs ALL frontend work** for the **dating vertical**. Every UI spec, plan, and implementer must follow it; the final UI review runs the §Before-shipping check. It internalizes a senior-product-designer + Gen-Z posture so we build crafted, culturally-sharp mobile experiences natively (no external design tool as a dependency). If a screen would feel at home as a scaled-down desktop SaaS page, or as earnest startup copy, it's wrong.

> **Scope decision (CONFIRMED 2026-05-27):** this Barbiecore/Gen-Z system is the brand for the **dating vertical** (`/onboarding`, `/home`, `/feed`, `/nights/new`, profiles, match/lock). The **legacy date-planner** (`/`, `/plan`, `/account`, `/dates`) keeps its existing warm-cream brand. Implementation is **additive**: new Barbiecore color + font tokens live alongside the existing warm-cream tokens; dating surfaces opt into them; the planner's tokens are untouched (it uses 492 live prod itineraries — don't break it). A future whole-app rebrand is a token flip, not a rewrite.
>
> **Audience (CONFIRMED 2026-05-27):** target is **younger** users, and the product is **no longer geo-limited to Kelowna** — copy must not hardcode Kelowna; use generic/local-agnostic phrasing.

## Brand voice (one sentence)
**The dating app that's actually fun — experiences are the heroes, people are personal.** Anti-Tinder, low-pressure, self-aware. Lowercase, dry, a little chaotic. Never earnest, never corporate.

## 0. Anti-slop / anti-cringe — never ship
No purple→blue gradients on white. No Space Grotesk / generic system fonts as display. No hover on static cards/text. No "Welcome!" / "Get Started" / "Continue your journey" / motivational or startup-speak copy. No sentence-case headlines. No corporate stock photography. No generic Material/Bootstrap shapes. No "lorem ipsum" — believable real-sounding names + real cover imagery (no Kelowna hardcoding; product is multi-city). If you reach for a default, stop and choose with intent.

## 1. Palette — warm-filmic base + hot-pink ACCENT, three-tier, re-themable tokens only
**Photography is the hero; pink is the energy, not the wallpaper** (CONFIRMED 2026-05-27 from the reference mood-board — see §Imagery). The app is NOT one global theme. Three tiers reinforce "experiences are heroes, people are personal." Use semantic Tailwind tokens; never hardcode hex or `gray-*`/`blue-*` in components.
- **Tier 1 — App shell** (splash, bottom nav, dashboards, settings): **warm filmic base** `shell.base` `#FAF4EC` (a warm cream — NOT a pink flood; this also shares a foundation with the legacy planner so the brand seam stays soft); **hot-pink accent** `shell.accent` `#E0218A` reserved for the LOGO, primary CTAs, sticker chips, active/selected states, key highlights; **deep-plum ink** `shell.ink` `#3D0F2E`. `shell.pink` `#FFE5F1` is a soft-pink tint for occasional washes only. Pink should read as punchy punctuation against warm + photography, never as the dominant background.
- **Tier 2 — Experience surfaces** (swipe cards, experience detail, match screen): the **photograph leads** (warm film-grain, often polaroid-framed — see §Imagery). Each date also carries its **own micro-palette** by vibe (jazz bar = midnight blue + amber; beach picnic = peachy; pottery = warm craft) for chrome/accents around the photo. Cards/detail/match inherit the experience's bg/accent/text dynamically via `vibePalette`.
- **Tier 3 — Person/profile surfaces**: **strip all branding** — neutral off-white `#FAFAF8`, near-black `#141414`, subtle gray tags. Humans read un-branded.

## 2. Typography
- **Display/headlines:** **Caprasimo** (chunky, retro, playful serif). Tailwind token `font-heading` (CSS var `--font-display`). *Additive:* Fraunces (`font-display`, `--font-inter-display`) stays for the planner — don't remove it.
- **Body:** **Fredoka** (round, friendly sans). Tailwind token `font-body` (CSS var `--font-body`). Dating surfaces use `font-body`; the planner keeps Inter (`font-sans`).
- Load Caprasimo + Fredoka via `next/font/google` alongside the existing Inter + Fraunces; add their `.variable` classes to `<html>` and the two new `fontFamily` tokens to `tailwind.config.ts`.
- **Lowercase** all headlines, subheads, CTAs. Mix sizes aggressively (one huge word, rest tiny). Optional 3rd accent face later (handwritten Caveat for "★ host's pick", monospace for metadata).

## 3. Voice & copy (lowercase, dry, Gen-Z)
- Lowercase headlines + CTAs; body copy can use sentence case where readability matters. Short. Acknowledge the trope you're in; don't be earnest.
- **Verbs:** "lock in", "slide in", "send it", "you cooked", "touch grass", "later", "skip", "fine, do it".
- **Canonical copy:** splash "swipe on the date, not the guy" / "the dating app that's actually fun (we hope)" / CTA "let's go". Experience CTA "lock in". Match "you cooked." / "now actually plan it with [name]" / CTA "slide in". Empty feed "that's everyone for now. touch grass and come back later."
- Empty states should be **funny, not helpful.** Avoid: "Welcome", "Submit", "Continue", any motivational line.

## 4. Mobile-first = crafted mobile
- Design at 375px first; on desktop, center in a phone-style container (~`max-w-[420px]`), never a stretched desktop layout. Bottom sheets (`vaul`) + full-screen modals, not desktop dialogs. Tap targets ≥44px, generous padding, `rounded-3xl` primary surfaces, soft **warm** shadows (`shadow-warm`), never hard grey. Bottom-tab shell: Discover / Dates / Messages / Profile.

## 5. Imagery & photography — warm-filmic + polaroid (the emotional core)
Imagery does the emotional work; pink + type are the energy around it. Driven by the reference mood-board (2026-05-27).
- **Look:** warm **35mm film-grain / flash** candid photography — golden-hour, candlelit, slightly blown-out, grainy, *imperfect on purpose*. Real people mid-moment (never posed/stocky): dinners + wine, pasta/ramen/pizza, pottery, bouldering, arcades, board games, beach, road trips, rooftops, stargazing. **The experience is the hero, the people are real.** Composition: through-windows, over-the-shoulder, hands/rings details, silhouettes, POV.
- **Polaroid framing (brand motif — KEEP):** present hero/date photos as **polaroids** — thick white border (heavier at the bottom), slight tilt (deterministic **-3°..+3°**), soft drop shadow, optional tape corner; optional **handwritten caption** (Caveat) in the bottom margin. Tape / tilt / overlap collages over clean grids where it fits. Ties to the existing "welcome polaroid" email motif.
- **Sourcing (legal):** the Pinterest references are DIRECTION ONLY — never ship them (copyright). Ship-safe assets only: Unsplash (`images.unsplash.com` is allowlisted), licensed, or AI-generated, chosen to match this warm-filmic vibe. Real itinerary covers (Supabase storage) are the production source for date photos.
- **Treatment in code:** a warm grain/contrast overlay + the polaroid frame are reusable components; `next/image` for all photos with proper `alt`.

## 5b. Decoration — stickers, sparkles, Y2K (intentional imperfection)
- **Sticker chips:** vibe/tag chips look slapped-on — deterministic rotation **-3° to +3°** (`stickerRotation` in `apps/web/lib/sticker.ts`) + `shadow-md`. Not flat, not aligned.
- **Background flourishes:** floating SVG stars/sparkles/hearts/blobs, gentle looping y-float (framer-motion), staggered delays, low opacity 30–60%, behind content (e.g., splash). Use sparingly so they don't fight the photography.

## 6. Motion (framer-motion — everything that moves)
- **Swipe stack:** drag rotates + tints the card by distance (green right / black-red left); spring physics on release; snap-back on cancel. (Buttons are a fallback, not the primary interaction.)
- **Match confetti:** burst of 20–30 framer-motion divs (random x/y/rotation, fade-out) on match — no extra lib.
- **Interested list:** `Reorder.Group` for tactile drag-to-rank (5b).
- Page transitions slide/scale/fade with intent; staggered list entrances. Spring physics over ease. Hover/active/focus ONLY on actionable elements.

## 7. States & polish
Every screen: loading / empty / error / success / retry / cancel. Every interactive element: hover/active/focus/disabled. Skeletons over spinners. Toasts via `sonner`. Realistic data.

## 8. Identity / profile (Gen-Z group-chat energy)
Opt-in prompts: "the ick i'd die on", "green flag energy", "i'll know we vibe when", "my roman empire", "most chronically online thing about me", "i'm a 10 but". Opt-in MBTI / star sign / attachment-style pills. Voice notes > written bios where possible; Spotify top-track if relevant. (Profile UI stays Tier-3 neutral.)

## 9. Accessibility is taste
Semantic HTML, heading hierarchy, ARIA labels on icon buttons, alt text, keyboard nav, contrast that passes (mind pink-on-pink). Edgy-but-broken is just broken.

## 10. Stack
Tailwind (semantic tokens) · `framer-motion` (all motion/gestures) ✅ · `vaul` (bottom sheets) ✅ · `sonner` (toasts) ✅ · `lucide-react` ✅. One component/file, named exports, no `any`, files <500 lines. RSC fetch → thin client component; `@/lib/cn`.

## Before shipping — iterate until all "yes"
1. Would a 22-year-old send this to the group chat as "this app is so me"?
2. Does the motion make me smile, or is it just there?
3. Is the copy actually funny, or just lowercase?
4. Removed every AI/cringe tell (§0)? All six states? Tap ≥44px? Contrast passes?
If any "no" → iterate before shipping.

## Workflow integration
Brainstorm/spec: declare the register + which tier a surface lives in. Plan: first UI plan adds foundation setup (fonts/tokens); each UI task references this file. Execute: every UI implementer gets these rules; final UI review runs the §Before-shipping check.

## Open foundation tasks (from this revision)
- **Additively** add **Caprasimo** (`font-heading`) + **Fredoka** (`font-body`) in `apps/web/app/layout.tsx` + `tailwind.config.ts` — keep Inter + Fraunces for the planner.
- Add **Barbiecore pink** Tier-1 tokens (`shell.base/accent/ink`) + Tier-3 neutral (`profile.base/ink/tag`) + a Tier-2 per-experience convention (inline CSS vars `--exp-bg/--exp-accent/--exp-ink` consumed via `bg-[var(--exp-bg)]`, with a `vibePalette()` helper mapping vibe → mood colors). Keep all existing warm-cream tokens.
- ✅ Scope confirmed (2026-05-27): dating-vertical-only, additive, planner unchanged.

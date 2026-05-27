# After5 Design System — Gen-Z, Crafted, Mobile-First (canonical)

**This governs ALL frontend work** for the **dating vertical**. Every UI spec, plan, and implementer must follow it; the final UI review runs the §Before-shipping check. It internalizes a senior-product-designer + Gen-Z posture so we build crafted, culturally-sharp mobile experiences natively (no external design tool as a dependency). If a screen would feel at home as a scaled-down desktop SaaS page, or as earnest startup copy, it's wrong.

> **Scope decision (confirm with the user):** this Barbiecore/Gen-Z system is the brand for the **dating vertical** (`/onboarding`, `/home`, `/feed`, `/nights/new`, profiles, match/lock). The **legacy date-planner** (`/`, `/plan`, `/account`, `/dates`) keeps its existing warm-cream brand unless we decide to rebrand the whole app. Default assumption: dating = Barbiecore, planner = unchanged.

## Brand voice (one sentence)
**The dating app that's actually fun — experiences are the heroes, people are personal.** Anti-Tinder, low-pressure, self-aware. Lowercase, dry, a little chaotic. Never earnest, never corporate.

## 0. Anti-slop / anti-cringe — never ship
No purple→blue gradients on white. No Space Grotesk / generic system fonts as display. No hover on static cards/text. No "Welcome!" / "Get Started" / "Continue your journey" / motivational or startup-speak copy. No sentence-case headlines. No corporate stock photography. No generic Material/Bootstrap shapes. No "lorem ipsum" — believable Kelowna names + real cover imagery. If you reach for a default, stop and choose with intent.

## 1. Palette — three-tier (Barbiecore), re-themable tokens only
The app is NOT one global theme. Three tiers reinforce "experiences are heroes, people are personal." Use semantic Tailwind tokens; never hardcode hex or `gray-*`/`blue-*` in components.
- **Tier 1 — App shell** (splash, bottom nav, dashboards, settings): **Barbiecore pink.** base `#FFE5F1`, accent `#E0218A`, ink `#3D0F2E`.
- **Tier 2 — Experience surfaces** (swipe cards, experience detail, match screen): each date carries its **own micro-palette** by vibe (jazz bar = midnight blue bg + amber; beach picnic = peachy; pottery = warm craft). Cards/detail/match inherit the experience's bg/accent/text dynamically.
- **Tier 3 — Person/profile surfaces**: **strip all branding** — neutral off-white `#FAFAF8`, near-black `#141414`, subtle gray tags. Humans read un-branded.

## 2. Typography
- **Display/headlines:** **Caprasimo** (chunky, retro, playful serif). *(Foundation note: Step 1 installed Fraunces — swap it to Caprasimo.)*
- **Body:** **Fredoka** (round, friendly sans). *(Replaces Inter for dating surfaces.)*
- Load both via `next/font/google`, wire to the `--font-inter-display` (display) + body slots in `tailwind.config.ts`.
- **Lowercase** all headlines, subheads, CTAs. Mix sizes aggressively (one huge word, rest tiny). Optional 3rd accent face later (handwritten Caveat for "★ host's pick", monospace for metadata).

## 3. Voice & copy (lowercase, dry, Gen-Z)
- Lowercase headlines + CTAs; body copy can use sentence case where readability matters. Short. Acknowledge the trope you're in; don't be earnest.
- **Verbs:** "lock in", "slide in", "send it", "you cooked", "touch grass", "later", "skip", "fine, do it".
- **Canonical copy:** splash "swipe on the date, not the guy" / "the dating app that's actually fun (we hope)" / CTA "let's go". Experience CTA "lock in". Match "you cooked." / "now actually plan it with [name]" / CTA "slide in". Empty feed "that's everyone for now. touch grass and come back later."
- Empty states should be **funny, not helpful.** Avoid: "Welcome", "Submit", "Continue", any motivational line.

## 4. Mobile-first = crafted mobile
- Design at 375px first; on desktop, center in a phone-style container (~`max-w-[420px]`), never a stretched desktop layout. Bottom sheets (`vaul`) + full-screen modals, not desktop dialogs. Tap targets ≥44px, generous padding, `rounded-3xl` primary surfaces, soft **warm** shadows (`shadow-warm`), never hard grey. Bottom-tab shell: Discover / Dates / Messages / Profile.

## 5. Decoration — stickers, sparkles, Y2K (intentional imperfection)
- **Sticker chips:** vibe/tag chips look slapped-on — deterministic rotation **-3° to +3°** (hash from label) + `shadow-md`. Not flat, not aligned.
- **Background flourishes:** floating SVG stars/sparkles/hearts/blobs, gentle looping y-float (framer-motion), staggered delays, low opacity 30–60%, behind content (e.g., splash).
- **Photo treatments:** tape / tilt / overlap collages, not clean grids, where it fits.

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
- Swap **Fraunces → Caprasimo** (display) and add **Fredoka** (body) in `apps/web/app/layout.tsx` + `tailwind.config.ts`.
- Add **Barbiecore pink** Tier-1 tokens + a mechanism for Tier-2 per-experience mood palettes + Tier-3 neutral.
- Confirm the **scope** (dating-vertical-only vs whole-app rebrand) with the user.

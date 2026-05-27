# After5 Design System — Crafted Mobile-First (canonical)

**This governs ALL frontend work.** Every UI spec, plan, and implementer must follow it. It internalizes a senior-product-designer posture so we build crafted, not generic, mobile experiences — natively, without an external design tool. If a screen would feel at home as a scaled-down desktop SaaS page, it's wrong.

## Brand voice (one sentence)
**Warm, editorial, a little playful — experiences are the heroes, people are personal.** After5 is intimate and local (Kelowna nights), the opposite of swipe-fatigue dating. Commit to that register on every screen; hedging produces AI slop.

## 0. Anti-slop hard rules (never ship these)
No purple→blue gradients on white. No Space Grotesk / Inter-as-display. No hover effects on static cards/containers/text. No random emoji decoration. No identical generic card grids. No "lorem ipsum" — use believable Kelowna names/copy and real cover imagery. If you reach for a default, stop and choose with intention.

## 1. Palette (our real tokens — already in `tailwind.config.ts`)
Warm cream system; re-theme by editing tokens, never hardcode hex or `gray-*`/`blue-*`:
- `background #FDF9F3` (page canvas) · `border #E8DFCB` · `muted #8B8884` · `secondary #6B6864` · `text #1A1A1A` (ink) · `accent` (terracotta/amber — the single bold accent).
- **Always use semantic classes** (`bg-background`, `text-text`, `text-secondary`, `border-border`, `bg-accent`), never `bg-gray-50` etc.

### Three-tier color (gives the product soul)
1. **Brand shell** — nav, splash, home: warm cream + the terracotta accent (the "pink shell" idea, our version).
2. **Content surfaces** — experience/date cards + detail pages **may carry their own contextual mood color** (a creative pottery night = warm/craft; a jazz bar = midnight/amber; a beach picnic = peachy). Content variety earns color.
3. **Person/profile surfaces stay NEUTRAL** — humans read as people, not branded surfaces. Profiles use ink-on-cream, no mood tint.

## 2. Typography
- **Body:** Inter (keep — `--font-inter`).
- **Display:** ADD a real display font (the current `font-display` falling back to Inter is the #1 slop tell). Match the register: **editorial-warm → Fraunces** (recommended default; distinctive, not trendy) or **playful-chunky → Caprasimo / Lilita One** (closer to the swipe-marketplace mockups). Load via `next/font/google`, wire to `--font-inter-display`'s slot. Display font choice IS the product's voice — decide deliberately.
- Headlines large and confident; body generous line-height; tabular-nums for counts.

## 3. Mobile-first = crafted mobile (not responsive desktop)
- Design at 375px first. On desktop, frame prototypes in a phone-style container (max-w ~`max-w-[420px]` centered) — never a stretched desktop layout.
- **Bottom sheets** (`vaul`) and **full-screen modals**, not desktop dialogs scaled down.
- **Tap targets ≥ 44px.** Generous padding (`px-6 py-4`+). Primary surfaces `rounded-3xl` (add a `rounded-3xl`/`rounded-2xl` step — our `card: 8px` is too tight for hero surfaces). Soft **warm** shadows (amber-tinted), never hard grey.
- Bottom tab nav for the app shell (Discover / Dates / Messages / Profile), thumb-reachable primary actions.

## 4. Motion is design (add `framer-motion`)
- **Gesture-driven swipe stack** for the feed: drag rotates + tints the card as it moves; spring physics on release (snap/fling). Not Pass/Interested buttons as the primary interaction (buttons are a fallback/secondary).
- Page transitions slide/fade with intent; staggered list entrances on first paint.
- **Hover/active/focus ONLY on actionable elements** — never static cards/text. Spring physics over ease curves for anything tactile.

## 5. States & polish (where "fine" becomes "wow")
Every screen ships all of: **loading, empty, error, success, retry, cancel.** Every interactive element has hover/active/focus/disabled. Realistic placeholder data. Skeletons over spinners where possible. Toasts via `sonner`.

## 6. Accessibility is taste
Semantic HTML, proper heading hierarchy, ARIA labels on icon buttons, alt text, keyboard nav, contrast that passes. Edgy-but-broken is just broken.

## 7. Stack (additions needed — currently missing)
- Tailwind for all styling (semantic tokens). `lucide-react` icons ✅.
- **ADD:** `framer-motion` (all animation/gestures), `vaul` (bottom sheets), `sonner` (toasts). `recharts`/`@xyflow/react` only if a chart/canvas surface appears.
- One component per file, **named exports**, no `any`, files < 500 lines. Follow existing repo patterns (`@/lib/cn`, server RSC fetch → thin client component).

## Before delivering — self-check (iterate until all "yes")
1. Would this embarrass me on Dribbble? → must be **no**.
2. Does the motion feel intentional, not random?
3. Can I state the brand voice in one sentence? (It's at the top of this doc.)
4. Have I removed every generic AI tell (§0)?
5. All six states present? Tap targets ≥44px? Contrast passes?

## How this plugs into the superpowers workflow
- **Brainstorm/spec (UI phases):** the design register + three-tier color decision are part of the spec.
- **Plan:** UI tasks reference this file; the first UI plan of a surface includes the token/font/stack setup tasks (add the display font + framer-motion before building screens).
- **Execute:** every UI implementer subagent is given these rules (or this file) in its prompt; the final UI review checks against the §Before-delivering self-check.

# Design Brief — After5
Generated: 2026-04-19 by using-design

## Aesthetic Direction
**Refined Minimal** — A premium brand with nothing to prove. Off-white on off-black, a single warm accent that nods to Kelowna sunsets, generous negative space, large restrained typography. The product reads as luxury without ornament.

## Why This Direction
After5 is a *taste signal* — users open it because they want to plan something thoughtful without doing the work. The brand has to read as "someone with taste designed this" the moment a user lands. Refined Minimal achieves that with restraint: no decoration, no noise, no visual gimmicks. The risk for an emotional category like dating is that pure minimalism can feel clinical, so we soften it with one warm accent (burnt sienna, drawn from Okanagan sunset light) and slightly-warm off-white neutrals (paper, not snow). This keeps the warmth without breaking the discipline.

The competition (Wonderplan, ChatGPT outputs, generic date-idea apps) all default to busy gradients, stock-photo grids, and listicle layouts. Refined Minimal differentiates by *removing* — same way Apple, Linear, and the best editorial brands signal premium without trying.

## Palette
See `palette.json`. Primary is **#1A1A1A** (off-black), used for buttons, headlines, and primary actions. Accent is **#C2552B** (burnt sienna), reserved exclusively for emphasis: hover states, pricing highlights, "loved" feedback, and the active itinerary card. Background: **#FAFAF7** (warm off-white). Text: **#1A1A1A**.

The palette uses **5 hues total** (background, surface, text, muted, accent). No gradients. The accent appears on no more than one element per viewport.

## Typography
See `typography.json`. Display: **Inter Display** / Body: **Inter** / Base size **16**px, scale ratio **1.333** (perfect fourth). Single family throughout, weight contrast does the heavy lifting (400 for body, 500 for UI, 600 for subheads, 700 for display). All Google Fonts — free, fast, full unicode coverage.

Headlines run large and tight (line-height 1.05, tracking -0.02em). Body copy runs comfortable (1.5 line-height). No serif fallbacks. No condensed variants.

## Motion Language
**Minimal**. Animation cues: fade-in only, 200ms ease-out. Page transitions are instant. No parallax, no scroll-triggered reveals, no hover-zoom on images, no "playful" micro-interactions. Loading states use a static skeleton, not a pulse animation. The one allowed motion: a 200ms color fade on the accent when an itinerary card is selected.

## Layout Grammar
**Grid-strict, asymmetric, generous whitespace.** Max content width **1200**px. Section rhythm: 96px vertical padding on desktop, 56px on mobile. Hero sections break the grid — a single asymmetric headline that occupies 60% of viewport width, left-aligned, with massive negative space on the right.

Itinerary cards are the centerpiece — full-bleed on mobile, 3-up on desktop with deliberate gaps that let each card breathe. No carousels, no horizontal scroll. Lists use single-column rather than grid where the goal is reading.

Borders are 1px, subtle (#E5E3DD). Corner radius is 8px throughout — neither rounded-soft nor sharp-brutalist. Buttons are pill-shaped (full radius) when standalone, 8px when grouped.

## Reference Artifacts
- Mockups: `mockups/hero.jpg`, `mockups/full-page.jpg`, `mockups/section-close-up.jpg`, `mockups/mobile.jpg` (Nano Banana 2)
- Structure: `structure/layout.html`, `structure/mobile.html` (Google Stitch — reference only, rebuild in Next.js + Tailwind + shadcn/ui)
- Components: `components.json` — 20 picks across 11 roles via 21st.dev (8 strong fits, 6 medium, 6 weak, 2 gaps)

## Constraints & Don'ts
**Hard don'ts (these break the direction):**
- ❌ No gradients of any kind
- ❌ No drop shadows except subtle (max `0 1px 2px rgba(0,0,0,0.04)`)
- ❌ No more than one accent color in a single viewport
- ❌ No serifs anywhere — Inter family only
- ❌ No emoji in product UI (Lucide icons only; emoji OK in marketing copy)
- ❌ No skeuomorphic textures (no paper grain, no noise overlays)
- ❌ No glass/blur/frosted effects
- ❌ No dark mode for v1 (light only — easier to nail one mode than two)
- ❌ No carousels, no auto-rotating sliders, no scroll-jacking
- ❌ No stock photography; only real Kelowna place photos (or geometric placeholders until real photos exist)
- ❌ No "AI sparkle" iconography — we deliberately don't sell the AI angle

**Brand don'ts (from product positioning):**
- ❌ No language that positions us as cheap ("budget date ideas") — see PLAN.md Part 11
- ❌ No "Powered by AI" or "ChatGPT-powered" badges anywhere
- ❌ No language that lectures the user (no "tip:" or "did you know" interruptions)
- ❌ No date-app clichés: hearts, roses, candle icons, soft pinks

**Photography rules (when we add real photos):**
- Natural light only, no flash
- Wide shots that show *place + context*, not just food/drink close-ups
- 3:2 aspect ratio, full-bleed on cards
- Slight warm grade in post (matches the off-white background)

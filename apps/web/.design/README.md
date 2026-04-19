# Design Package for After5
Generated 2026-04-19 by /using-design.

## How to use this folder
1. Read `brief.md` first. It is the source of truth.
2. Look at `mockups/` to understand the visual target.
3. Check `components.json` for pre-picked 21st.dev building blocks.
4. `structure/layout.html` and `structure/mobile.html` are *hints*, not code to copy.
5. `palette.json` and `typography.json` are the design tokens.

## Direction
**Refined Minimal** — off-white #FAFAF7 paper, off-black #1A1A1A text, single warm accent #C2552B (Kelowna sunset), Inter sans only, generous whitespace, 8px radius, fade-only motion, zero ornament.

## Inventory
- `brief.md` — design brief + constraints + don'ts
- `palette.json` — 8-color palette (5 hues actively used)
- `typography.json` — Inter / Inter Display, scale 1.333
- `structure/layout.html` (12.7KB), `structure/mobile.html` (13.1KB) — Stitch reference
- `mockups/hero.jpg` (2.0MB), `mockups/full-page.jpg` (2.1MB), `mockups/section-close-up.jpg` (1.9MB), `mockups/mobile.jpg` (2.2MB) — Nano Banana 2
- `components.json` — 20 picks across 11 roles via 21st.dev (8 strong, 6 medium, 6 weak, 2 gaps)

## Regenerate
- Full regenerate: `/using-design` (will overwrite this folder — commit first)
- Single stage: `/using-design:mockup`, `/using-design:components`, `/using-design:structure`
- Targeted revision: `/using-design:revise <target> "<change>"`

## Handoff
When implementing with `frontend-design`, reference this folder in the skill's context by pointing at `brief.md`. Do not re-decide aesthetic direction — it's locked here.

The 21st.dev picks in `components.json` need re-searching by the implementer (the inspiration tool returns names but no canonical URLs). Each pick has aesthetic-stripping notes — read them before pulling components in (most need: dark mode → light, gradients → flat, indigo → #C2552B accent, framer-motion bounce → fade-only).

## Known gaps (frontend-design will need to build custom)
- **hero-section** — no 21st.dev result matches the asymmetric 60/40 layout the brief calls for
- **vibe-picker** — needs zero-motion variant; all 21st picks have entrance animations

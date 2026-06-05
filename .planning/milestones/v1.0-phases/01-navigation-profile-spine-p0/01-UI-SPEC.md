---
phase: 1
slug: navigation-profile-spine-p0
status: draft
shadcn_initialized: false
preset: none
created: 2026-06-03
design_system: docs/superpowers/DESIGN-SYSTEM.md
brownfield: true
---

# Phase 1 — UI Design Contract: Navigation & Profile Spine (P0)

> Visual and interaction contract for the P0 nav/profile spine. BROWNFIELD — After5 is live; this phase reuses the existing Barbiecore design system and existing components. It introduces NO new visual language. Where a detail is genuinely unspecified, the on-brand default is chosen and flagged `[default]`.
>
> Source of truth: `docs/superpowers/DESIGN-SYSTEM.md` (Barbiecore, three-tier color, Caprasimo/Fredoka, 420px mobile-first). Locked decisions: `01-CONTEXT.md` (D-01..D-09).

---

## Surfaces In Scope

| ID | Surface | Build type | Tier |
|----|---------|-----------|------|
| E3 | `/account` profile hub (enhance) | enhance existing | Tier-1 shell (`shell.*`) + embedded Tier-3 self-view |
| E1 | `<DeepRouteHeader>` (new shared primitive) | new component | Tier-1 shell chrome |
| E2 | Bottom-nav label/target change | edit existing | Tier-1 shell |
| E4 | `/account/preferences` settings page (new route) | new route, reuse form | Tier-1 shell |

This phase touches NAVIGATION + IDENTITY only. No marketing/teaser content, no loop-closure, no computed profile stats (deferred to E17/Phase 6 per CONTEXT `<deferred>`).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (hand-rolled Tailwind token system — no shadcn) |
| Preset | not applicable |
| Component library | none (semantic Tailwind tokens + bespoke components) |
| Icon library | `lucide-react` (already in stack) — `ArrowLeft`, `ArrowRight`, `Pencil`/`SlidersHorizontal`, `Bell`, `UserRound`, `Compass`, `Heart`, `CalendarHeart`, `Eye` |
| Display font | Caprasimo — token `font-heading` (CSS var `--font-display`) |
| Body font | Fredoka — token `font-body` (CSS var `--font-body`) |
| Class merge | `cn()` (`@/lib/cn`, clsx + tailwind-merge) — never concatenate class strings |
| Motion | `framer-motion` available; respect `motion-reduce:` on every transition |

Registry Safety: **not applicable** — no shadcn, no third-party UI registries. No vetting gate required.

---

## Color Contract (Barbiecore Tier-1, three-tier system)

Use semantic Tailwind tokens ONLY. Never hardcode hex or `gray-*`/`blue-*`. Pink is punctuation, not wallpaper.

| Role | Token | Hex | Usage in this phase |
|------|-------|-----|---------------------|
| Dominant (60%) | `shell.base` | `#FAF4EC` | page canvas on hub, header, preferences; warm cream |
| Surface (30%) | `white` / `shell.pink` | `#FFFFFF` / `#FFE5F1` | cards, identity block, section rows, icon wells (`shell.pink`) |
| Ink | `shell.ink` | `#3D0F2E` | all body + heading text (and tints `shell.ink/60`, `/40`, `/10`) |
| Accent (10%) | `shell.accent` | `#E0218A` | RESERVED — see list below |
| Self-view surface | `profile.base` / `profile.ink` | `#FAFAF8` / `#141414` | the `ProfileCard` self-view ONLY (Tier-3 neutral — humans read un-branded; DESIGN-SYSTEM §1 Tier-3 / §8) |

**`shell.accent` (pink) is reserved for, and ONLY for:**
- the `after5` logo wordmark in the masthead
- the primary CTA (`post a night` on the hub; the dating on/off toggle when ON)
- active bottom-nav tab indicator (2px bar + active label/icon weight)
- icon wells on hub link rows (`bg-shell-pink` well + `text-shell-accent` glyph)
- selected sticker chips in the preferences form (existing pattern)
- focus rings (`focus-visible:ring-shell-accent/40`)
- inline text links (`text-shell-accent` with underline)

Never use pink as a section background flood, never pink-on-pink text (fails AA — see Accessibility).

**Destructive / state colors:**
- `sign out` and the "turn dating OFF" confirmation are LOW-destructiveness → use neutral ink outline buttons, NOT a red flood. No `red-*` flood token exists in the dating system.
- `sage` `#5CDBA0` (success, reserved — NOT in tailwind.config yet) may render a small "dating is on" tick `[default — only if a token is promoted; otherwise use ink+copy, no new color]`.
- Inline form errors: existing pattern = `border-shell-accent/30` card + ink text + `role="alert"` (reuse from `PreferencesStep`). Do NOT introduce a red error card on dating surfaces.

---

## Typography Contract

The dating system uses the existing global type scale (`tailwind.config.ts` `fontSize`, all line-heights pre-baked). Two fonts, lowercase chrome, mix sizes aggressively (one big word, the rest small).

| Role | Token | Size / line-height | Font | Weight | Use |
|------|-------|--------------------|------|--------|-----|
| Page display (h1) | `text-4xl` | 50px / 1.05 | `font-heading` Caprasimo | (face weight) | hub greeting `hey {name}`; one per page |
| Section head (h2) | `text-2xl` | 28px / 1.2 | `font-heading` | — | `your dating profile`, `settings`, `your account` |
| Row title / subhead | `text-xl` | 21px / 1.4 | `font-heading` | — | link-row labels, `DeepRouteHeader` title |
| Body | `text-base` | 16px / 1.5 | `font-body` Fredoka | 400 | bio, prompt answers, descriptive copy |
| Small / meta | `text-sm` / `text-xs` | 14 / 12px · 1.5 | `font-body` | 400 / `font-semibold` (600) | helper text, meta, field legends |

- **Weights: exactly two** — Fredoka regular (400) for body; `font-semibold` (600) for legends, CTA labels, active tab, emphasis. No third weight.
- **All chrome lowercase**: headlines, subheads, CTAs, tab labels, nav titles. Body sentences may use sentence case where readability needs it (DESIGN-SYSTEM §3).
- Prompt-card labels stay UPPERCASE micro-label (`text-[12px] uppercase tracking-wide`) — existing `ProfileCard` pattern, kept.

---

## Spacing Scale

Follow the established hub rhythm (Tailwind 4px base). These are the multiples already used across `/account` and editor surfaces — match them; do not invent new gaps.

| Token | Value | Usage |
|-------|-------|-------|
| 1.5 | 6px | tight inline icon gaps |
| 2 / 2.5 | 8 / 10px | chip gaps, compact stacks |
| 3 | 12px | row internal gaps, link-row stack (`space-y-3`) |
| 4 | 16px | card padding (`p-4`), CTA top gap |
| 5 | 20px | page horizontal padding (`px-5`) — phone gutter |
| 7 | 28px | first section after greeting (`mt-7`) |
| 8 | 32px | top padding (`pt-8`), section breaks (`pt-8`) |
| 11 | 44px | min tap target / icon well (`h-11 w-11`) |
| 12 | 48px | major section breaks (`mt-12`) |
| 28 | 112px | bottom padding clearing the nav (`pb-28`) on tab-root pages |

- Container: `mx-auto w-full max-w-[420px] px-5`. Mobile-first 375px design, centered phone column on desktop.
- Primary surfaces `rounded-3xl` (1.5rem); chips/pills `rounded-full`; icon wells `rounded-2xl`.
- Shadow: `shadow-fun` (pink-tinted) for elevated dating cards; never hard grey shadow.
- Exceptions: deep-route pages (E1) use `pb-20` (80px) NOT `pb-28` — they have no bottom nav, only the top header, so no nav clearance is needed.

---

## Surface 1 — `/account` Profile Hub (E3)

**Build:** enhance the existing `apps/web/app/account/page.tsx` in place (D-01). Keep the masthead, `BottomTabShell`, `NotificationToast`, and the saved-plans wedge section. Re-order so IDENTITY leads.

**Strip (F1):** remove any `/home` teaser / marketing / onboarding-teaser association. The hub is the user's dating identity home, not a settings dump and not a landing page.

### New section order (top → bottom)
1. **Masthead** (existing, unchanged) — sticky, `after5` wordmark in `shell.accent`.
2. **Identity block** (NEW): primary photo (reuse `Polaroid`, `tone="dating"`, deterministic tilt) + `font-heading` `{first_name}, {age}` + meta line `{city} · {pronouns?}` + a verification chip. Verification chip: if verified → small ink/`shell.pink` pill `verified` with a check glyph; if not → muted `unverified` pill linking to the verify flow `[default]`. No computed stats (deferred).
3. **Dating-profile summary** (NEW): bio (clamped ~3 lines), prompt preview (1–2 prompt cards reusing the `ProfileCard` prompt-card visual), vibe sticker chips. If empty → empty-state (see copy contract) nudging to fill the profile.
4. **"as others see it" self-view entry** (NEW, D-03): a row/CTA `preview my profile` with an `Eye` icon that opens the `ProfileCard` in preview mode (see Self-View below). Copy frames it as "what people see when you come up."
5. **Secondary links block** (NEW): clear, equal-weight rows to `edit profile` (`/account/profile`), `preferences` (`/account/preferences` — new, D-09), `notifications` (`/account/notifications`). Reuse the existing hub link-row visual (icon well + title + `ArrowRight`).
6. **Surface "your nights"** (D-04): a link to `/my-nights` ("nights you posted") lives here / in the create flow — NOT on the dates tab. Reuse the existing `your nights` loop row.
7. **`post a night` primary CTA** (existing) — `shell.accent` pill, `shadow-fun`.
8. **Saved plans wedge** (existing, unchanged) — the discreet planner wedge stays below identity.
9. **`your account`**: signed-in-as + `sign out` (existing).

### Self-View (D-03 — reuse `ProfileCard`)
- Reuse `apps/web/components/ProfileCard.tsx` verbatim in a "preview" presentation. It already renders Tier-3 neutral (`profile.base`/`profile.ink`), the photo carousel, name+age, vibe chips, prompt cards. Do NOT rebuild it.
- Surface it as a bottom sheet (`vaul`) or full-screen modal `[default: vaul bottom sheet — matches DESIGN-SYSTEM §4 "bottom sheets, not desktop dialogs"]`, titled `as others see it`, dismissible (Escape + drag + close button).
- Feed it the owner's OWN clear photos + fields (owner read passes RLS). Do NOT pass `instagram_handle` (no PII in the self-preview).

### Hub component reuse map
| Need | Reuse | New? |
|------|-------|------|
| Photo render | `Polaroid` (`tone="dating"`) | reuse |
| Self-view card | `ProfileCard` | reuse (preview wrapper is new) |
| Link rows | existing hub row pattern (icon well + `ArrowRight`) | reuse pattern |
| Identity block | — | NEW markup (server-rendered from `profiles` + `profiles_private`) |
| Verification chip | — | NEW (small pill) |
| Self-view sheet wrapper | `vaul` drawer | NEW thin client wrapper |

---

## Surface 2 — `<DeepRouteHeader>` Shared Primitive (E1)

**Build:** NEW component `apps/web/components/DeepRouteHeader.tsx`. No canonical back-header exists today (only scattered `router.back()` / `ArrowLeft`) — this replaces them. Tier-1 shell chrome.

### Anatomy
```
[ ← back ]  contextual title                 [ optional right slot ]
```
- Sticky top bar, `max-w-[420px]`, `bg-shell-base/90 backdrop-blur-md`, `border-b border-shell-ink/10` — mirrors the existing hub masthead so the chrome reads as one system.
- **Left:** back affordance = `ArrowLeft` glyph + optional `back` label. Min 44×44px tap target. `aria-label="back"` on the control.
- **Center/left:** title, `font-heading text-xl lowercase text-shell-ink`, truncated (`line-clamp-1`) — per-route title is the planner's call (D-07-nav / Claude's discretion); e.g. the match counterpart's name, `notifications`, `your interest`.
- **Right slot:** optional `ReactNode` (e.g. a `rate` action, an overflow menu). Omitted on most routes.

### Props (suggested API — planner may refine)
```ts
interface DeepRouteHeaderProps {
  title: string;
  backHref: string;            // deterministic parent — NOT blind history.back() (D-08)
  backLabel?: string;          // default: none (icon only) [default]
  right?: React.ReactNode;     // optional action slot
}
```

### Back semantics (D-08 — deterministic)
- Resolve to a sensible PARENT route via an explicit `backHref` (`Link`), not blind `history.back()` (which can exit the app). Exact target per route is the planner's call; e.g. `/matches/[lockId]/rate` → `/matches/[lockId]`; `/messages/[threadId]` → `/inbox`; guard/error terminals → their nearest valid parent. **No route may be a link-less terminal after this phase.**

### Mount targets (D-07-nav)
`/matches/[lockId]`, `/matches/[lockId]/rate`, `/offers/[offerId]`, `/messages/[threadId]` (+ `/inbox/[threadId]` re-export), `/dates/[slug]/interested`, `/account/notifications`, AND all link-less guard/error states ("not your match/date", "couldn't load", reciprocal errors).

### Do NOT
- Do NOT mount `BottomTabShell` on these deep routes — bottom nav stays on the 5 tab roots only. Deep routes are focused flows; a bottom nav would assert a wrong active-tab state (D-07-nav).

### States
- **Default:** back + title.
- **With action:** back + title + right slot.
- **On guard/error page:** same header (so the user is never trapped) + the error body below it.
- **Focus:** back control is the first focusable element; visible `focus-visible:ring-shell-accent/40` ring.
- Loading/empty/error of the page BODY are owned by each route, not the header.

---

## Surface 3 — Bottom-Nav Label/Target Change (E2)

**Build:** edit existing `apps/web/components/BottomTabShell.tsx` (`TABS`, lines 20–25) + `UserMenu.tsx`. Nav VISUAL is unchanged — only two targets change.

| Tab | Current `href` | New `href` | Label | Rationale |
|-----|----------------|------------|-------|-----------|
| dates | `/my-nights` | `/matches` | `dates` (unchanged) | "dates you're going ON" = matched/locked, not nights you posted (D-04) |
| profile | `/home` | `/account` | `profile` (unchanged) | profile tab lands on the real editable hub (D-05) |

- Keep the existing active-state visual: ink-color label + 2px `shell.accent` bar above icon, `aria-current="page"`, derived from `usePathname`. (The audit confirmed pink-on-cream labels fail AA, so the readable label stays ink — do not change this.)
- `isActive` already matches `pathname.startsWith(href + '/')`, so `/matches/[lockId]` correctly lights the dates tab and `/account/*` lights the profile tab.
- Also update `UserMenu.tsx` profile link target `/home` → `/account` (D-05).
- Labels stay `font-body text-[11px] lowercase`; active label `font-semibold`.

---

## Surface 4 — `/account/preferences` Settings Page (E4)

**Build:** NEW route `apps/web/app/account/preferences/page.tsx` (server component) + extract the preferences FORM out of `PreferencesStep` for reuse without breaking onboarding (D-09; factoring approach is Claude's discretion). Tier-1 shell.

### Layout
- Same shell as `/account/profile`: `bg-shell-base`, `max-w-[420px] px-5`, `pt-8 pb-20`.
- Top: `<DeepRouteHeader title="preferences" backHref="/account" />` (E1) — this is a deep route, so NO bottom nav.
- h1 `settings` (`font-heading text-3xl`) + dry subhead.
- **Reuse the existing preferences form visuals verbatim:** `StickerChip` (sticker rotation + pink-fill selected), `i'm a` / `show me` gender chip groups, `age from` / `age to` number inputs, `within {n} km` range slider (`accent-shell-accent`), `hard nos` dealbreaker chips. Same `numberClass`, same error pattern (`role="alert"` ink card).
- **Relocate the dating on/off toggle here** (D-09): move the `EnableDatingButton` behavior off `/home` into a clearly-labelled `dating is on` / `turn dating on` control at the TOP or BOTTOM of the settings page. When ON, offer a `turn dating off`/pause control. Reuse `EnableDatingButton`'s gate logic + button visual; the OFF/pause is a neutral ink-outline button (low-destructive, with a one-line confirm — see copy).

### Save behavior
- Persist via the existing `savePreferences` path (writes the flat `profiles` columns the S5 pre-filter reads). On the settings page, save returns the user to a `saved` state / toast (`sonner`), NOT `advanceOnboarding` → `/onboarding/phone` (that branch is onboarding-only — the extracted form must make the "next step" behavior injectable so onboarding is untouched).

### Preferences component reuse map
| Need | Reuse | New? |
|------|-------|------|
| Gender/dealbreaker chips | `StickerChip` (extract from `PreferencesStep`) | reuse (lift to shared) |
| Age inputs, distance slider, error card | existing `PreferencesStep` markup | reuse (extracted) |
| Dating on/off toggle | `EnableDatingButton` logic + visual | reuse (relocate) |
| Page header | `DeepRouteHeader` | reuse (new in E1) |
| Save → settings (not onboarding) | — | NEW (injectable submit handler) |

---

## Copywriting Contract (lowercase, dry, Gen-Z — never earnest; DESIGN-SYSTEM §3)

| Element | Copy |
|---------|------|
| Hub h1 | `hey {firstname}` (existing) |
| Hub identity subhead | `your dating home. pick up where you left off.` (existing) — KEEP; drop any marketing line |
| Self-view CTA | `preview my profile` (with `Eye` icon) |
| Self-view sheet title | `as others see it` |
| Self-view sub | `this is you when you come up in someone's feed.` |
| Edit-profile link | `edit profile` (existing) |
| Preferences link | `preferences` |
| Notifications link | `notifications` |
| Your-nights link | `your nights` · sub `nights you posted` (existing) |
| Primary CTA (hub) | `post a night` (existing) |
| Empty profile (no bio/prompts) | heading `your profile's a little bare` · body `add a bio and a couple prompts so people get the vibe.` · CTA `edit profile` |
| Preferences h1 | `settings` |
| Preferences subhead | `who we line up for you. tweak it whenever.` |
| Dating-on label | `dating is on` |
| Dating-off CTA | `turn dating on` (existing) |
| Dating-pause CTA | `pause dating` |
| Pause confirm (low-destructive) | `pause dating? you'll stop showing up in feeds till you flip it back on.` · confirm `pause` · cancel `nah, leave it` |
| DeepRouteHeader back | `back` (aria-label `back`) |
| Guard/terminal — wrong match/date | heading `that's not your match` · body `this one isn't yours to see.` · the header back arrow is the way out |
| Load error (deep route) | heading `couldn't load that` · body `something glitched. head back and try again.` (back arrow resolves to parent) |
| Reciprocal/other RPC error | reuse `messageForCode()` user-facing copy; render in the existing ink `role="alert"` card |
| Sign out | `sign out` (existing) |

Banned (DESIGN-SYSTEM §0/§3): "Welcome", "Get Started", "Continue", "Submit", any motivational/startup line, sentence-case headlines, em-dashes in chrome copy.

---

## Interaction & Motion

- Every transition carries `motion-reduce:` fallback (existing pattern across hub/editor).
- Self-view: `vaul` bottom-sheet open/close (spring), drag-to-dismiss.
- Link rows / CTAs: `hover:` only on `pointer:fine` (config `hoverOnlyWhenSupported`), `active:scale-95` press feedback, `focus-visible:ring-shell-accent/40`.
- `DeepRouteHeader` is static chrome — no entrance animation; the page body owns transitions.
- Save toasts via `sonner`. Skeletons over spinners for any async (none expected — hub + prefs are SSR).

---

## Accessibility (DESIGN-SYSTEM §9 — "accessibility is taste")

- Semantic HTML + heading hierarchy: one `<h1>` per surface; sections use `<h2>`; no skipped levels.
- Icon-only controls (back arrow, self-view, toggle glyphs) carry `aria-label`; decorative glyphs `aria-hidden`.
- All images `alt` text (`Polaroid`/`ProfileCard` already enforce this).
- Keyboard: Tab reaches every control; back arrow is first focusable on deep routes; Escape closes the self-view sheet; chips are real `<button role="radio|checkbox" aria-checked>` (existing).
- Contrast WCAG AA: body/labels are ink-on-cream (passes). **Never** pink-on-cream for text < 18px or pink-on-pink (the audit caught this — active nav label stays ink, pink is the indicator bar only).
- Bottom-nav active state announced via `aria-current="page"`.
- Deep-route guard/error pages are reachable AND escapable (no link-less terminal — D-08).

---

## Component Reuse Summary (reuse vs new)

| Component | Path | This phase |
|-----------|------|-----------|
| `ProfileCard` | `apps/web/components/ProfileCard.tsx` | REUSE (self-view preview) |
| `Polaroid` | `apps/web/components/Polaroid.tsx` | REUSE (identity photo) |
| `BottomTabShell` | `apps/web/components/BottomTabShell.tsx` | EDIT (2 tab targets) |
| `UserMenu` | `apps/web/components/UserMenu.tsx` | EDIT (profile link target) |
| `NotificationToast` | existing | REUSE (hub, unchanged) |
| `StickerChip` | inside `PreferencesStep.tsx` | EXTRACT + REUSE (lift to shared for `/account/preferences`) |
| `PreferencesStep` form | `apps/web/app/onboarding/steps/PreferencesStep.tsx` | EXTRACT form core; keep onboarding submit behavior intact |
| `EnableDatingButton` | `apps/web/app/home/EnableDatingButton.tsx` | RELOCATE into preferences |
| `DeepRouteHeader` | `apps/web/components/DeepRouteHeader.tsx` | **NEW** |
| `/account/preferences` route | `apps/web/app/account/preferences/page.tsx` | **NEW** |
| Self-view sheet wrapper | TBD | **NEW** (thin `vaul` client wrapper around `ProfileCard`) |

---

## 6-Pillar Quality Bars (gsd-ui-checker validates against these)

**1. Copywriting** — PASS when: all chrome is lowercase + dry; zero banned phrases (§0/§3); every empty/error/guard state has authored copy from the contract above; no em-dashes in UI chrome; no Kelowna/geo hardcoding.

**2. Visuals** — PASS when: primary surfaces `rounded-3xl`, `shadow-fun` (never hard grey); photos via `Polaroid`/`next/image` with `alt`; sticker chips keep deterministic tilt + shadow; the hub reads identity-forward (not a settings dump or marketing page); deep routes have the back-header, not the bottom nav.

**3. Color** — PASS when: only semantic tokens (no raw hex / `gray-*` / `blue-*`); `shell.base` dominant, white/`shell.pink` surfaces, `shell.ink` text, `shell.accent` only on the reserved list; self-view stays Tier-3 neutral (`profile.*`); no pink-on-pink text; no red error flood on dating surfaces.

**4. Typography** — PASS when: `font-heading` (Caprasimo) for display/heads, `font-body` (Fredoka) for body; exactly two weights (400 + semibold 600); one `<h1>` per surface; lowercase chrome; uses the existing `fontSize` scale (no ad-hoc sizes outside the established `text-[..]` patterns already in these files).

**5. Spacing** — PASS when: `max-w-[420px] px-5` phone column; tab-root pages clear the nav (`pb-28`), deep routes use `pb-20` (no nav); tap targets ≥44px (`min-h-[44px]` / `h-11`); spacing on the 4px scale matching the existing hub rhythm.

**6. Registry Safety** — PASS by default (no shadcn, no third-party UI registries; nothing to vet).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS (not applicable — no registry)

**Approval:** pending

---

*Phase 1 — Navigation & Profile Spine (P0). Brownfield: conforms to `docs/superpowers/DESIGN-SYSTEM.md`; reuses existing components. UI-SPEC drafted 2026-06-03.*

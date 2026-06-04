---
phase: 3
slug: marketplace-completeness-p1
status: draft
shadcn_initialized: false
preset: none
created: 2026-06-03
---

# Phase 3 — UI Design Contract

> Visual and interaction contract for **Marketplace Completeness (P1)**: E11 creator controls, E12 host triage, E13 plan-on-match/offer, E14 delivery reachability. **BROWNFIELD** — this phase extends a live Barbiecore dating app. Reuse existing components and tokens; do **not** invent a new look. Every surface here already has a sibling shipped in `apps/web`.

**Source of truth:** `docs/superpowers/DESIGN-SYSTEM.md` (Barbiecore, dating vertical, Tier-1 shell). This spec is a faithful application of that system to four new/extended surfaces, with all decisions derived from `03-CONTEXT.md` (D-01..D-08), the date-settings design spec (§2/§2A), and the existing component code read during research. **No questions asked — on-brand defaults chosen and noted.**

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (no shadcn; bespoke Tailwind token system) |
| Preset | not applicable |
| Component library | none — hand-rolled primitives on `vaul` (sheets) + `framer-motion` (motion) + `sonner` (toasts) |
| Icon library | `lucide-react` |
| Font | **Caprasimo** (`font-heading`, display) + **Fredoka** (`font-body`) — dating-vertical Barbiecore. Lowercase everything. |

**Tier:** All Phase-3 surfaces are **Tier-1 shell** chrome (creator/host flows + match/offer screens), with **Tier-3 neutral** treatment for any person data (candidate names/photos via `Polaroid tone="dating"`). The rendered plan (E13) is editorial Tier-1, not Tier-2 vibe-themed — it reuses the existing `StopRow` timeline which already reads against `shell.*`.

---

## Spacing Scale

The codebase uses Tailwind's default 4px scale via utility classes (`gap-2`=8, `gap-3`=12, `px-5`=20, `py-3`=12, `mt-6`=24, etc.). Phase-3 work conforms to the **established rhythm of the existing forms/sheets** rather than inventing new tokens.

| Token | Value | Usage (as seen in shipped code) |
|-------|-------|---------------------------------|
| xs | 4px | icon gaps (`gap-1`), chip inner padding |
| sm | 8px | compact stacks (`space-y-2`, `gap-2`), chip rows |
| md | 12–16px | field spacing (`space-y-4`/`space-y-6`), card padding (`p-3`/`px-4 py-3`) |
| lg | 20–24px | screen gutters (`px-5`), section breaks (`mt-6`/`mt-8`) |
| xl | 32px | header-to-form gap (`mb-7`/`mb-8`) |

**Exceptions (load-bearing, keep):**
- **Tap targets ≥ 44px** on every interactive element (`min-h-[44px]` rows, `min-h-[48px]` primary CTAs, `h-11 w-11` icon buttons). Non-negotiable per DESIGN-SYSTEM §4.
- **Phone container `max-w-[420px]`** centered, with `px-5` gutters. Designed at 375px first.
- Bottom-sheet safe-area: `pb-[calc(1.5rem+env(safe-area-inset-bottom))]`.
- Radii: `rounded-3xl` primary surfaces/cards, `rounded-2xl` inputs/inner tiles, `rounded-full` pills/CTAs/avatars.

---

## Typography

Two declared faces, lowercase, sizes mixed aggressively (one big word, rest tiny). Matches the shipped `PostNightForm` / `OfferDetail` / `InterestedList`.

| Role | Size | Weight | Line Height | Token |
|------|------|--------|-------------|-------|
| Display (screen H1) | 28–34px (`text-3xl`/`text-4xl`) | 400 (Caprasimo) | ~1.05 (`leading-[1.05]`) | `font-heading` |
| Heading (section H2 / card title) | 17–24px (`text-lg`/`text-xl`/`text-2xl`) | 400 (Caprasimo) | tight (`leading-tight`) | `font-heading` |
| Label / CTA | 14–16px (`text-sm`/`text-[15px]`/`text-[16px]`) | 600 (semibold) | normal | `font-body` |
| Body | 13–15px (`text-[13px]`/`text-sm`/`text-[15px]`) | 400 | ~1.5 (relaxed) | `font-body` |
| Micro (eyebrow / meta) | 11px (`text-[11px]`) | 600–700 | normal, `tracking-[0.12em]`+ | `font-body` |

**Weights: exactly two** — regular (400) and semibold (600). Caprasimo ships at one weight; Fredoka uses 400/600 only. No third weight.

**Rules:** All headlines, subheads, CTAs, and chip labels are **lowercase**. Numbers in metadata use `[font-variant-numeric:tabular-nums]` (already in StopCard/timeline).

---

## Color

Semantic tokens only — **never hardcode hex or `gray-*`/`blue-*`** in components (DESIGN-SYSTEM §1, CONVENTIONS line 184).

| Role | Value | Token | Usage |
|------|-------|-------|-------|
| Dominant (60%) | `#FAF4EC` | `shell.base` | warm-cream screen background, sheet background, input fill base |
| Secondary (30%) | `#FFFFFF` (`bg-white`/`bg-white/80`) + `#FFE5F1` `shell.pink` washes | `white` / `shell.pink` | cards, input surfaces, soft tint panels, "the why" callout, "offer out" badge |
| Accent (10%) | `#E0218A` | `shell.accent` | see reserved list below |
| Ink | `#3D0F2E` | `shell.ink` | all primary text; `/70`, `/65`, `/55` opacities for secondary/tertiary text |
| Person data (Tier-3) | `#FAFAF8` / `#141414` / `#E5E5E0` | `profile.*` | inside `Polaroid` frames + neutral candidate tags only |
| Destructive | reuse `shell.accent` on a soft `shell.pink/60` ground (no separate red) | — | cancel/take-down confirmations (matches shipped `NightCardActions`) |
| Success (optional) | `#5CDBA0` `sage` (NOT yet a token) | — | "accepted" outcome tick ONLY if promoted; default to `shell.ink` text + check icon to avoid an un-tokenized hex |

**Accent (`shell.accent` pink) reserved for:** primary CTAs ("post it", "publish", "send it", "accept"), the selected/active ring on radio cards and pickers (`ring-shell-accent`), rank/step number badges, sticker/vibe chips, the `$pp` cost figure in the timeline, focus rings (`focus-visible:ring-shell-accent/40`), and the eyebrow accent line ("the night", "the why"). **Pink is punctuation, never the wallpaper** — backgrounds stay `shell.base`. Do not pink-flood the new creator form.

**Contrast:** white/semibold-pink text passes on `shell.accent`; mind `shell.pink`-on-`shell.base` for text (use `shell.ink` for any text on pink washes) per WCAG AA.

---

## Surface-by-Surface Interaction Contract

Reuse-vs-new is called out for every element. **Default posture: extend the existing component, do not fork it.**

### E11 — Creator controls (extend `PostNightForm` + add Door-2 canvas publish CTA)

**File:** `apps/web/app/nights/new/PostNightForm.tsx` (extend) + the Door-2 canvas at `apps/web/app/plans/[id]/edit/` (add publish bar). Reconcile-don't-double-edit with the parallel `apps/web/app/create/CreateFlow.tsx` open-city scaffold (D-03 — treat as a known parallel surface; do not touch concurrently).

**Layout:** keep the single-column `max-w-[420px]` form. **Group the new fields into labelled `fieldset` sections so the form never overwhelms** — reuse the existing `<legend className="mb-3 font-body text-sm font-semibold lowercase text-shell-ink">` pattern. Section order:

1. **which plan?** — REUSE existing `PlanCard` radiogroup (unchanged).
2. **the cover** — NEW. A real storage-backed **uploader** (D-01). The current `CoverPicker` only picks from existing stop photos; extend it with an "upload your own" affordance that follows the **photo-upload pipeline pattern** (`apps/web/lib/after5/photos.ts`: RLS-scoped `client.storage.from(bucket).upload('<uid>/<id>.jpg', blob, {upsert:true, contentType})` + a `date_instance` cover column mirror). Cover bucket + signing: reuse the profile-photo pipeline shape (Claude's discretion per CONTEXT). Show the chosen cover as a tappable thumbnail; tap re-opens the file picker. Empty: "no cover yet. add a photo that sells the night."
3. **who's this for?** — NEW grouped card (date-settings §2). Fields, **pre-filled from profile defaults, overridable, framed inclusively ("open to everyone" default — never reads as exclusion)**:
   - **who pays** (`pay_setting`): 3 **sticker chips** (`i pay` / `they pay` / `split`) using the established chip + `stickerRotation` treatment, single-select radiogroup. (Chips, not a select — DESIGN-SYSTEM, CONTEXT discretion.)
   - **target gender(s)** (`target_genders`): multi-select sticker chips (`women` / `men` / `nonbinary` / `everyone`), default `everyone` highlighted. Roving-tabindex like the existing ambient radiogroup.
   - **target age** (`target_age_range`): a min/max pair — two `<input type="number">` styled exactly like the shipped duration field (`rounded-2xl border-shell-ink/15 bg-white/80`), labelled "ages". Default unbounded (placeholder `18` / `100`).
   - **how far** (`search_radius_km`): a labelled `<input type="range">` or stepped number, "within ~N km", default = city default.
4. **the why** (`why_note`) — NEW. A short `<textarea>` (`rounded-2xl` like inputs), label "the why?", helper "one line on why this night's worth it." Renders later as the italic hook in the detail sheet (already wired in `NightDetailSheet`). Stop-slop: no sales copy.
5. **when's the night?** — REUSE existing `datetime-local` field (exact scheduling, unchanged).
6. **soundtrack?** — REUSE existing ambient radiogroup (unchanged).
7. **reach preview** — OPTIONAL element (D-01). If the `reach_preview` RPC is cheap enough to ship this phase, render a quiet inline line above the CTA: "~{N} people match this in {city}" + a soft nudge chip "loosen to reach more" when N is low. **If deferred to Phase 4, omit entirely — do not render an empty/loading placeholder.** Spec it as conditionally-present.

**Submit / publish CTA:** REUSE the existing full-width `min-h-[48px] rounded-full bg-shell-accent` button. Label `post it` from `PostNightForm`. On the **Door-2 canvas** (`/plans/[id]/edit`), add a **sticky bottom publish bar** mirroring the `NightDetailSheet` sticky-CTA pattern (`border-t border-shell-ink/10 bg-shell-base/95 backdrop-blur`), label **`publish this night`**. `create_blank_itinerary` already exists on prod (D-03) — this only adds the publish affordance on top.

**States:** loading (`posting…`, `aria-busy`), error (existing `role="alert"` pink-bordered card with dry copy), disabled CTA when invalid (`bg-shell-ink/10 text-shell-ink/35`), success toast `"posted. it's live."`. Uploader needs its own progress (`uploading…`) + failure (`couldn't upload that. try a different photo?`) states.

### E12 — Host triage (extend `InterestedList`)

**File:** `apps/web/app/dates/[slug]/interested/InterestedList.tsx` (note: the actual shipped path is `[slug]`, not `[instanceId]` — CONTEXT's path is stale). Reuse its existing row layout, `Polaroid tone="dating"`, `stickerRotation`, `Reorder.Group`, and `MakeOfferModal`.

- **Decline / reject affordance** (D-04): on each **new-interest** row, add a quiet secondary control — a small `lucide` `X`/`UserMinus` icon button (`h-11 w-11 rounded-full`, `text-shell-ink/40`, accent on focus) to the right of the shortlist action. Tapping opens a **`vaul` confirm sheet** (reuse `NightCardActions`' confirm-sheet pattern exactly):
  - Title: `pass on {name}?`
  - Body (host-facing, honest): `they drop off your list. they won't be told — no awkwardness.`
  - Confirm button: `pass`
  - Cancel: `keep them`
  - **SILENT to the candidate** — no notification, no candidate-facing "rejected" copy anywhere (D-04). On success: optimistic remove from the active list + toast `"passed. off your list."`.
- **Withdraw an outstanding offer** (D-05): when a shortlist row is in `offer_active` (the frozen rank-1 with "offer out" badge), surface a **`withdraw`** control — a text button (`font-body text-sm lowercase text-shell-ink/55`) under the badge, → `vaul` confirm (`pull this offer back?` / `they lose the offer. you can send a new one.` / `pull it` / `leave it`). Toast `"offer pulled."`.
- **Offer-outcome badges** (D-05): the `status` union already carries `offer_passed` / `offer_expired` (+ `offer_active`, `locked`). Render a small **outcome pill** on the relevant row, lowercase, no harsh language:
  - `offer_active` → existing `offer out` pink pill (keep).
  - `locked`/accepted → `accepted` pill on a soft success ground (`bg-shell-pink` with `shell.accent` text, or `sage` tick only if promoted) + a check icon.
  - `offer_passed` → `they passed` neutral pill (`bg-shell-ink/5 text-shell-ink/55`).
  - `offer_expired` → `expired` neutral pill (`bg-shell-ink/5 text-shell-ink/55`).

**States:** every new control gets loading/disabled (`disabled:opacity-50`), confirm/cancel, and a `sonner` toast on success/failure. Realtime append behavior (seam 5) unchanged.

### E13 — Plan on match + offer (render the full itinerary)

**The payoff: "every match has a real plan attached."** This is the highest-value fix — `OfferDetail`'s "the night" section is currently labelled-but-empty (only date/time).

**Reusable component — EXTRACT, don't re-implement:** the blind-safe stop timeline already exists as the private `StopRow` function inside `apps/web/app/feed/NightDetailSheet.tsx` (numbered photo thumb + dashed connector + name + `neighborhood · type · time` + one-line desc w/ "more" + `$pp` + map link). **Extract `StopRow` + the `StopTime` helper into a shared component** (e.g. `apps/web/components/PlanTimeline.tsx`) so the feed sheet, `OfferDetail`, and `LockDetail` all render identical timelines. The richer `components/itinerary/StopCard.tsx` is the planner-surface variant (links to `/places/[slug]`, identity-bearing) — **do NOT use it on offer/match** (it leaks venue slugs; the blind/post-lock contract differs). Use the `NightDetailSheet` timeline shape.

- **`OfferDetail.tsx`** (`apps/web/app/offers/[offerId]/`): replace the single date/time `<p>` under the `the night` eyebrow with the extracted **`<PlanTimeline>`** rendering all stops (name + per-stop time + cost + map). Keep the existing eyebrow `the night` (`text-shell-accent`), the date/time line above it, and the `ExpiryCountdown`. **Respect the reveal tier (D-07):** Phase 3 does NOT change photo-led reveal ordering — render the plan, keep the existing host-reveal placement. Fetch stops via the blind-safe `get_night_detail` RPC the sheet already uses (or the offer's attached itinerary), so the offer screen stays blind-safe pre-accept.
- **`LockDetail.tsx`** (`apps/web/app/matches/[lockId]/`): add a **`the night`** section (same eyebrow + `<PlanTimeline>`) below the header/profile-reveal CTA and above cancel. Post-lock the full itinerary is fair game. Add the section between the `message {name}` block and the cancel/rate actions.

**States:** if stops fail to load or are empty, show a quiet degrade line (`the full plan unlocks here.` on the offer pre-accept; `plan's being put together.` on a lock missing stops) — never a blank labelled section. Reuse `NightDetailSheet`'s fallback-to-summary pattern (log the failure, render graceful copy).

### E14 — Delivery reachability (minimal UI)

**No major UI** (backend-led, D-08). Only confirm/spec:
- The in-app notification for a received offer **deep-links to `/offers/[offerId]`** and that route is reachable from the inbox/notification list (the reliability guarantee — in-app is the floor regardless of email/push). No new component; verify the existing inbox notification row for `new_offer` routes correctly and renders dry copy (e.g. `someone sent you an offer →`).
- Server-runtime email + push are non-visual (resend.ts / push/send.ts moved to a server caller). No UI surface.

---

## Copywriting Contract

All lowercase, dry, Gen-Z, stop-slop (no filler/adverbs/passive/em-dashes; specific). No "welcome"/"submit"/"continue"/motivational lines. Silent-but-clear on declines.

| Element | Copy |
|---------|------|
| **E11** primary CTA (post form) | `post it` |
| **E11** publish CTA (Door-2 canvas) | `publish this night` |
| **E11** cover empty | `no cover yet. add a photo that sells the night.` |
| **E11** cover uploading / fail | `uploading…` / `couldn't upload that. try a different photo?` |
| **E11** "who's this for?" framing | default chip `everyone` selected; helper `open to everyone unless you narrow it.` |
| **E11** "the why" field | label `the why?` · helper `one line on why this night's worth it.` |
| **E11** reach preview (optional) | `~{N} people match this in {city}.` · low-N nudge `loosen to reach more` |
| **E11** post success | `posted. it's live.` (existing) |
| **E12** decline confirm | title `pass on {name}?` · body `they drop off your list. they won't be told — no awkwardness.` · confirm `pass` · cancel `keep them` |
| **E12** decline success | `passed. off your list.` |
| **E12** withdraw confirm | title `pull this offer back?` · body `they lose the offer. you can send a new one.` · confirm `pull it` · cancel `leave it` |
| **E12** withdraw success | `offer pulled.` |
| **E12** outcome pills | `accepted` · `they passed` · `expired` · `offer out` (existing) |
| **E12** empty (new interest) | `no new right-swipes yet.` (existing) |
| **E12** empty (shortlist) | `nobody shortlisted yet. drag people up from below.` (existing) |
| **E13** offer plan eyebrow | `the night` (existing) |
| **E13** lock plan eyebrow | `the night` |
| **E13** offer plan pre-accept degrade | `the full plan unlocks here.` |
| **E13** lock plan missing-stops degrade | `plan's being put together.` |
| **E14** inbox offer row | `someone sent you an offer →` |
| **Error (generic action)** | `that didn't go through. try again?` (existing convention) |

---

## Reuse Inventory (brownfield — build on these)

| Need | Reuse | New work |
|------|-------|----------|
| Post form shell, radiogroups, datetime, ambient | `PostNightForm.tsx` | extend with cover/targeting/why fieldsets |
| Cover selection | `CoverPicker.tsx` | add storage-backed upload (photos.ts pipeline) |
| Storage upload pattern | `lib/after5/photos.ts` (`addPhoto`) | cover bucket + `date_instance` cover column |
| Confirm/edit bottom sheets | `NightCardActions.tsx` (`vaul` confirm + edit) | decline + withdraw confirm sheets |
| Host list rows, drag, polaroid | `InterestedList.tsx` | decline button, withdraw control, outcome pills |
| Blind-safe stop timeline | `StopRow`/`StopTime` in `feed/NightDetailSheet.tsx` | **extract to `components/PlanTimeline.tsx`** |
| Offer screen | `OfferDetail.tsx` | swap empty "the night" → `<PlanTimeline>` |
| Match screen | `LockDetail.tsx` | add "the night" → `<PlanTimeline>` |
| Person rendering (Tier-3) | `components/Polaroid.tsx` (`tone="dating"`) | none |
| Sticker chips + rotation | `lib/sticker.ts` (`stickerRotation`) | pay/target chips |
| Toasts / motion / sheets | `sonner` · `framer-motion` · `vaul` | none |
| Sticky bottom CTA bar | `NightDetailSheet` sticky footer | Door-2 publish bar |

---

## Six-Pillar Quality Bars (run before "done")

1. **Copywriting** — every string lowercase, dry, specific; decline copy is silent-to-candidate but honest host-side; no "welcome/submit/continue"; stop-slop applied. Empty + degrade states authored (not blank labelled sections).
2. **Visuals** — `rounded-3xl` cards, `shadow-fun`/`shadow-warm` (never hard grey), polaroid for people, sticker chips with `-3°..+3°` rotation, no AI-slop gradients, no hover on static elements. The plan reads as a real route (numbered thumbs + dashed connectors).
3. **Color** — semantic tokens only; pink reserved (CTAs / active rings / cost figure / step badges / focus); `shell.base` stays the dominant ground; no pink flood on the creator form; Tier-3 neutral inside polaroids.
4. **Typography** — `font-heading`/`font-body`, lowercase, two weights, sizes mixed (big screen H1 vs tiny eyebrows), tabular-nums on metadata.
5. **Spacing** — `max-w-[420px]` phone container, `px-5` gutters, ≥44px tap targets (48px primary CTAs), safe-area padding on sheets, the established `space-y-4`/`space-y-6` form rhythm; grouped fieldsets so E11 doesn't overwhelm.
6. **Accessibility** — semantic `fieldset/legend`, roving-tabindex radiogroups (match shipped ambient/plan pattern), `aria-label` on every icon button, `role="alert"` on errors, keyboard nav (Tab/Enter/Esc), alt text, `motion-reduce:*` honored, WCAG AA contrast (mind pink-on-cream text).

**DESIGN-SYSTEM §Before-shipping check** also applies: would a 22-year-old send it to the group chat? Does the motion make you smile? Is the copy actually funny? All six states present? If any "no" → iterate.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none (no shadcn / no third-party registry) | n/a | not applicable |

No third-party registry declared. No vetting gate required.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending

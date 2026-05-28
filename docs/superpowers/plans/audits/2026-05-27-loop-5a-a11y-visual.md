# Loop 5a A11y + Visual Audit — 2026-05-27

**Scope:** `/login`, `/home`, `/feed`, `/nights/new`
**Viewport:** 390×844 (iPhone 15)
**Tools:** Playwright MCP + axe-core 4.10.0 (via CDN) + manual contrast math
**Auth:** `lucache95@gmail.com` (QA · `5f387641-2ee9-443a-abb8-bb7f8e48a1a0`) via real PKCE flow → `/auth/callback` → `/account`
**Branch:** `feat/loop-5a-post-browse`

## Summary
- **Critical:** 5
- **Important:** 7
- **Polish:** 4

axe-core ran cleanly on all four routes. CDN injection succeeded; no CSP block. The single console error caught on `/feed` is a real SSR hydration mismatch (see I7).

---

## Critical findings

### C1 — Focus-visible ring fails WCAG 1.4.11 Non-Text Contrast
- **Route:** `/feed`, `/home`, `/nights/new` (global pattern)
- **Element:** Every interactive control using `focus-visible:ring-shell-ink/30` (nope/yes buttons, NightCard, tab links, post-it submit, radios)
- **Issue:** Ring color is `rgba(61,15,46,0.3)` which composites to `#c1afb3` on cream and `#c5b7c0` on white — both measure ~1.91:1 against their adjacent surface. WCAG 2.1 SC 1.4.11 requires 3:1 for UI components and graphical objects (including focus indicators).
- **Fix:** Raise to `focus-visible:ring-shell-ink/60` (or `ring-shell-accent/60`) site-wide. Likely a Tailwind preset / `BottomTabShell`, `SwipeDeck`, `PostNightForm` token swap.
- **Severity:** Critical
- **Evidence:** Measured 1.91:1 (on cream) / 1.93:1 (on white). Source rule: `.focus-visible\:ring-shell-ink\/30:focus-visible { --tw-ring-color: rgba(61,15,46,.3); }`

### C2 — Swipe-deck footer copy fails AA on body text
- **Route:** `/feed`
- **Element:** `<p class="mt-3 text-center font-body text-xs text-shell-ink/45">swipe right if you're in · left to skip</p>` (`apps/web/app/feed/SwipeDeck.tsx`)
- **Issue:** Computed foreground `#a58d97` on cream `#faf4ec` measures **2.80:1**. WCAG AA requires 4.5:1 for normal text.
- **Fix:** Bump opacity from `/45` to `/70` (or use `text-shell-ink/75` which lands ≥4.5:1) in `apps/web/app/feed/SwipeDeck.tsx`.
- **Severity:** Critical
- **Evidence:** axe-core `color-contrast` (serious); ratio 2.8.

### C3 — Email input has no programmatic label
- **Route:** `/login`
- **Element:** `<input type="email" placeholder="you@example.com" ...>` in `apps/web/app/login/page.tsx`
- **Issue:** No `<label for>`, no `aria-label`, no `aria-labelledby`, no `name`, no `id`. Only a placeholder. WCAG 1.3.1 / 3.3.2 / 4.1.2: form controls must have a programmatic name; placeholders disappear on focus and are not a substitute. (axe missed this because the placeholder satisfies its accname fallback, but it still fails WCAG 3.3.2.)
- **Fix:** Add a visible `<label for="login-email">email</label>` above the field, give the input `id="login-email"`, and `name="email"` in `apps/web/app/login/page.tsx`.
- **Severity:** Critical
- **Evidence:** `outerHTML`: `<input type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required ...>` — no `id`, no `aria-label`, no `<label for>`.

### C4 — Roving-tabindex broken on `/nights/new` radiogroup
- **Route:** `/nights/new`
- **Element:** `<div role="radiogroup">` with four `<div role="radio">` children — all have `tabIndex=0` in DOM (`apps/web/app/nights/new/PostNightForm.tsx`)
- **Issue:** WAI-ARIA radiogroup pattern requires exactly one radio in the tab order at a time (the checked one, or the first if none checked) and arrow-key roving navigation between them. With all four at `tabindex=0`, screen-reader / keyboard users tab through every option separately and arrow keys probably don't move selection. This violates SC 2.1.1 keyboard pattern and WAI-ARIA Authoring Practices.
- **Fix:** In `PostNightForm.tsx`, set `tabIndex={i === selectedIndex ? 0 : -1}` per radio and wire `onKeyDown` for ArrowDown/ArrowUp/ArrowRight/ArrowLeft + Home/End to move selection. Or replace the custom radios with native `<input type="radio" name="plan">`.
- **Severity:** Critical
- **Evidence:** Snapshot dump `radioTabIndexes: [0,0,0,0]`, `radioChecked: ["false","false","false","false"]`.

### C5 — `/login` not redirected when already authenticated (auth bug, not a11y but caught in audit)
- **Route:** `/login`
- **Element:** Whole page
- **Issue:** Visiting `/login` while session-cookied at `lucache95@gmail.com` still renders the login form ("Good to see you. Save plans, vote with friends..."). After magic-link verification we landed at `/account` correctly, but `browser_navigate("/login")` re-shows the form, allowing duplicate magic-link requests. This is also a UX confusion: the H1 "Good to see you." suggests recognition but the form is shown.
- **Fix:** Add a server-side redirect in `apps/web/app/login/page.tsx` (or its server wrapper) — `if (session) redirect('/home')`.
- **Severity:** Critical (auth/login UX safety)
- **Evidence:** Reproduced — navigated to `/login` post-auth, snapshot showed full form.

---

## Important findings

### I1 — Bottom-tab inactive labels fail AA contrast
- **Route:** `/feed`, `/home`, `/nights/new` (all routes via `components/BottomTabShell.tsx`)
- **Element:** `<a>discover</a>`, `<button>messages</button>` etc. — computed color `rgba(61,15,46,0.55)` on `rgba(250,244,236,0.95)`
- **Issue:** Effective color `#927684` on cream measures **3.73:1** at 11px/12px font (small UI text). Fails AA 4.5:1 for normal text; passes 3:1 for ≥18.7px (large) but these labels are 11px.
- **Fix:** Raise inactive opacity from `/55` to `/70+` in `BottomTabShell.tsx`, or set explicit `text-shell-ink/75`.
- **Severity:** Important
- **Evidence:** Computed-style probe; ratio 3.73; font 11px.

### I2 — "soon" disabled tabs fall below large-text AA (2.46:1)
- **Route:** all (via `BottomTabShell.tsx`)
- **Element:** Disabled `<button>dates — coming soon</button>` and `messages` — computed color `rgba(61,15,46,0.4)` on cream
- **Issue:** Effective `#ae98a0` on cream measures **2.46:1**. While disabled-control text is technically exempt from 1.4.3, the tabs are also conveying state (locked) using color alone with a 6×6px "soon" badge that is also low-contrast (see I4). With reduced motion / screen mag, these are essentially invisible.
- **Fix:** Either bump disabled opacity to `/55+` (still distinct from active) or restyle the locked tabs as a single muted token with a visible "soon" sticker chip whose contrast passes.
- **Severity:** Important
- **Evidence:** Computed style; ratio 2.46.

### I3 — Active tab "discover" pink-on-cream just fails AA at 11px
- **Route:** `/feed` (active state), `/home` etc.
- **Element:** `<span class="font-body text-[11px] lowercase">discover</span>` inside `a[aria-current="page"]` — `#e0218a` on `#faf4ec`
- **Issue:** Measures **4.04:1** — fails AA 4.5:1 for normal text (11px counts as small). Passes large-text 3:1, but the rule's threshold is 18.7px / 24px+.
- **Fix:** Either bump the active label to `text-[12px]` and `font-bold` (closes some gap but still might miss) OR change the active label to `text-shell-ink` and rely on an underline / dot indicator to signal active. Cleanest: keep ink-color labels universally; signal active with a 2px pink bar above the icon.
- **Severity:** Important
- **Evidence:** axe-core `color-contrast`; ratio 4.04.

### I4 — `/feed` "soon" badge: 6px font and 3.72:1 contrast
- **Route:** `/feed`, `/home` (anywhere `BottomTabShell` shows locked tabs)
- **Element:** `<span class="text-[8px] ...bg-shell-pink text-shell-accent">soon</span>`
- **Issue:** 6pt / 8px is below WCAG-readable for any user; combined with 3.72:1 contrast it is effectively unreadable. The tab's tooltip ("dates — coming soon") in aria-label does carry the info, but visually the badge is decorative-only at this size.
- **Fix:** Either remove the badge (rely on muted state + aria-label) or grow to ≥11px and switch fg to `text-white` on `bg-shell-accent` (white-on-pink only passes large-text 3:1, so keep ≥18px there — or use `bg-shell-ink text-white` for the badge).
- **Severity:** Important
- **Evidence:** axe-core; ratio 3.72; font 8px.

### I5 — `/home` "verified · new here" chip fails AA (3.72:1)
- **Route:** `/home`
- **Element:** `<div class="bg-shell-pink ... text-shell-accent ring-shell-accent/15">verified · new here</div>` (12px font)
- **Issue:** Pink-on-pink-tint (`#e0218a` on `#ffe5f1`) measures **3.72:1** at 12px. Fails AA 4.5:1.
- **Fix:** Switch chip palette to `text-shell-ink` on `bg-shell-pink` for body chips (the brand should reserve pink-text-on-pink-tint for accent-only large headings, not 12px body chips). Touch `apps/web/app/home/page.tsx`.
- **Severity:** Important
- **Evidence:** axe-core; ratio 3.72.

### I6 — `/feed` "4 left" counter fails AA (3.73:1)
- **Route:** `/feed`
- **Element:** `<p class="font-body text-sm text-shell-ink/55" aria-live="polite">4 left</p>` in `SwipeDeck.tsx`
- **Issue:** 14px text at `#927684` on cream = **3.73:1**. Fails AA. Aria-live works, but the visible text is hard to read.
- **Fix:** Change to `text-shell-ink/75` in `SwipeDeck.tsx`.
- **Severity:** Important
- **Evidence:** axe-core; ratio 3.73.

### I7 — SSR/CSR hydration mismatch on date formatting (`/feed`)
- **Route:** `/feed`
- **Element:** `<dd>` for "when" in `apps/web/app/feed/NightCard.tsx` lines 16-17
- **Issue:** `d.toLocaleTimeString([], { hour: 'numeric' })` resolves to `"8 a.m."` on the server's default locale (en-CA?) and `"8am"` on the client after the lowercase+strip-whitespace. Console error: `Hydration failed because the server rendered text didn't match the client. ... + thursday · 8am - thursday · 8a.m.` This triggers a full client re-render of every card, costing perf and creating a visible flash.
- **Fix:** In `NightCard.tsx`, pin the locale: `d.toLocaleTimeString('en-US', { hour: 'numeric' })` and same for `toLocaleDateString`. Or precompute the formatted string on the server and pass it in as a prop.
- **Severity:** Important (a11y indirectly: AT users get re-announce on hydration; perf is real)
- **Evidence:** `browser_console_messages level=error` — full stack capturing `+thursday · 8am / -thursday · 8a.m.`.

---

## Polish findings

### P1 — Top-of-page banner not contained in a landmark
- **Route:** all four
- **Element:** `<div class="relative z-[60] bg-gradient-to-r from-amber-100 ...">...Forever free for the first 100 members...</div>` in `components/EarlyAccessBanner.tsx`
- **Issue:** Sits above `<main>` with no landmark role, so axe flags every route with `region` violations. Screen reader users skipping landmarks miss the banner entirely; users using "skip to main" land below it (fine), but those exploring landmarks don't find it.
- **Fix:** Wrap the banner in `<aside role="region" aria-label="Early access announcement">` (or use the native `<aside>` with an `aria-label`). One edit in `EarlyAccessBanner.tsx` clears 3 axe nodes × 4 routes.
- **Severity:** Polish (moderate axe rule; not a blocker but easy win)
- **Evidence:** axe-core `region` rule, 3 nodes per route.

### P2 — White-on-pink CTA buttons measure 4.41:1 (just under AA at 15px)
- **Route:** `/home` ("browse tonight's nights", "post a night"), `/feed` (yes button bg), `/nights/new` (post-it active)
- **Element:** `bg-shell-accent text-white text-[15px]` (`<a href="/feed">browse tonight's nights</a>` etc.)
- **Issue:** `#ffffff` on `#e0218a` = **4.41:1**. 15px is below AA's 18.7px large-text threshold, so technically fails AA 4.5:1 by 0.1.
- **Fix:** Two options — (a) bump CTA font to 16px `font-bold` (16px bold qualifies as large-text under WCAG, passes 3:1) or (b) darken the accent token to `#cc1e7c` which gets ~5.0:1 with white. Option (a) is lower-risk to brand.
- **Severity:** Polish (borderline; AA failure but very close)
- **Evidence:** axe-core `color-contrast`; ratio 4.41.

### P3 — `/nights/new` plan-card "vibe tag" pills: white on pink, 11px (4.41:1)
- **Route:** `/nights/new`
- **Element:** `<li class="rounded-full bg-shell-accent ... text-white text-[11px]">jazz</li>` (PostNightForm radio card)
- **Issue:** Same 4.41:1 ratio but at 11px font — definitely small text — fails AA 4.5:1 outright. axe flagged 8 nodes (all the vibe pills).
- **Fix:** Switch pill palette to `bg-shell-ink text-white` (ink-on-white = 14.7:1) or `bg-shell-accent text-shell-ink` (would need check; ink on hot pink is also low). Cleanest: ink chip with cream text.
- **Severity:** Polish (small repeated decorative chip, but adds up)
- **Evidence:** axe-core; ratio 4.41, 8 nodes.

### P4 — Disabled "post it" submit at 2.09:1
- **Route:** `/nights/new`
- **Element:** `<button type="submit" disabled>post it</button>` — fg `rgba(61,15,46,0.35)` on bg `rgba(61,15,46,0.1)` over cream
- **Issue:** Effective `#ac959d` on `#e7ddd9` = **2.09:1**. WCAG exempts disabled controls from 1.4.3, so this is not a hard fail — but the disabled affordance is also conveyed by `cursor: not-allowed` only (which mobile users never see) and an unchanged shape. Sighted users on mobile may not perceive the disabled state.
- **Fix:** Add a visible disabled treatment: keep the bg but use a stripe / dashed border / "select a plan first →" helper text below the button. Source: `apps/web/app/nights/new/PostNightForm.tsx`.
- **Severity:** Polish
- **Evidence:** Computed style; ratio 2.09.

---

## Methodology notes

- **axe-core injection:** Loaded cleanly from `https://cdn.jsdelivr.net/npm/axe-core@4.10.0/axe.min.js` on all four routes (no CSP block). Ran with `{ resultTypes: ['violations'] }`.
- **Contrast math:** Implemented WCAG 2.x relative luminance formula (sRGB gamma) in `browser_evaluate`; for `rgba(...)` colors, alpha-blended over the resolved opaque parent before computing ratio. Cross-checked against axe's own computed ratios where available — match within 0.02.
- **Hydration error captured:** Via `browser_console_messages level=error` after a 3s wait on `/feed`. The error stack pointed at `NightCard` rendering `<dd>thursday · 8am</dd>` (client) vs `<dd>thursday · 8a.m.</dd>` (server).
- **/feed swipe-deck keyboard probe:** Confirmed both nope (64×64) and interested (64×64) buttons are tab-reachable with `tabIndex=0`. Buttons meet 44×44 minimum target size (SC 2.5.5). Live region `aria-live="polite"` exists on "4 left" counter (decrements as you swipe). No keyboard-trap detected.
- **/nights/new radiogroup probe:** All 4 radios have `tabIndex=0` — should be 1 (selected/first) + 3 (`-1`) per WAI-ARIA pattern. Did not interactively probe arrow keys yet; assumed-broken given tabindex state. Datetime field has correct `<label for="starts-at">` association.
- **No routes skipped beyond `/onboarding/*` (out of scope).** No 500s. Auth flow worked first try via Mailpit magic-link extraction.

## Screenshots

- `/login`: `/Users/lucas/Projects/audit-2026-05-27-login.png`
- `/home`: `/Users/lucas/Projects/audit-2026-05-27-home.png`
- `/feed`: `/Users/lucas/Projects/audit-2026-05-27-feed.png`
- `/nights/new`: `/Users/lucas/Projects/audit-2026-05-27-nights-new.png`

(Saved by Playwright MCP to its output dir `/Users/lucas/Projects/`; not committed.)

---

## Deferred (post-merge follow-up TODO)

The following audit items were intentionally **NOT** fixed in the Loop 5a finalization pass — they're tracked here for a follow-up:

- **P2** — White-on-pink CTAs at 4.41:1 (`/home`, `/feed`, `/nights/new`). Either bump CTA font to 16px bold (qualifies as large text) or darken `shell.accent` slightly.
- **P3** — `/nights/new` vibe-tag pills (`bg-shell-accent text-white text-[11px]`) at 4.41:1, 8 nodes. Switch to `bg-shell-ink text-white` for chips ≤12px.
- **P4** — Disabled "post it" submit at 2.09:1. Add a visible disabled treatment (stripe/dashed border or helper text).

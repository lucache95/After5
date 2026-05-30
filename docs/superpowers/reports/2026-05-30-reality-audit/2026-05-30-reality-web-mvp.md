# Reality Audit — Phase 8: Web MVP Readiness (web-only, no native)

Date: 2026-05-30
Scope: READ-ONLY. Can the WEB app (`apps/web`, Next.js App Router) deliver the full After5 dating loop on desktop + mobile-responsive browser + PWA, without native apps? Authority order: implementation > tests > types > routes.

## Verdict: CONDITIONAL YES

The full loop renders and functions acceptably in a mobile browser. It is **not** PWA-installable today, and the **time-boxed offer notification mechanic does not reach a user who isn't actively looking at the app** — that is the one true blocker for an unattended tester cohort. With a small, well-scoped PWA + push slice it becomes tester-acceptable web-only. Native is not required for the MVP.

## Responsive / mobile-web: GOOD

Screens are built mobile-first as a centered single column: `max-w-[480px]` (landing `app/page.tsx`) / `max-w-[420px]` (`app/home/page.tsx`, `app/dates/[slug]/interested/page.tsx`, `app/offers/[offerId]/page.tsx`) with `mx-auto` + `px-` padding. These are caps, not fixed widths — they narrow fluidly below the cap on a 390px phone and center as a column on desktop. 390px screenshots (`/tmp/d-shot-*.png`) confirm clean rendering of landing, offer, interested, matches, home/bell, notification center/prefs, login, signup. No desktop-broken or mobile-broken screens found. Onboarding photo upload uses a standard `<input type="file" accept="image/...">` (`app/onboarding/steps/PhotoStep.tsx`) — on mobile the OS picker offers camera capture, so web file-input suffices. ID + selfie verification runs entirely in-browser via the Persona embedded SDK (`PersonaEmbed.tsx` / `IdentityVerifyStep.tsx`) — no native capability needed.

## PWA state: ESSENTIALLY ABSENT

Missing, all confirmed:
- **No manifest** (no `app/manifest.ts`, no `*.webmanifest`).
- **No service worker / no `next-pwa`/`serwist`/`workbox`** in deps.
- **No viewport export** anywhere in `app/` and none in `app/layout.tsx` — relies on Next's default viewport; no explicit `theme-color`, no `apple-mobile-web-app-*` meta.
- **No app icons** (no `app/icon.*`, `apple-icon.*`; only `public/og.jpg`). Favicon not found.
- **No offline handling.**

Net: not installable, no home-screen presence, no offline shell, no app-store-style trust signal.

## Weakest web capabilities (ranked)

1. **Push for the time-boxed offer (the critical gap).** Notifications are delivered ONLY via Supabase Realtime `postgres_changes` (`lib/after5/realtime.ts`, `components/NotificationToast.tsx`, `NotificationBadge.tsx`) — in-app, requires an open tab. There is **no web-push, no service worker, and no SMS fallback** (no Twilio in `supabase/functions`). The offer UI is hard time-boxed ("23h 56m left to decide", `app/offers/[offerId]/ExpiryCountdown.tsx`); a closed-tab user simply never learns an offer arrived until they reopen. This silently breaks the match loop's urgency.
2. **iOS web-push reliability.** Even once web-push is added, iOS Safari only delivers push to an **installed** PWA (so the manifest is a prerequisite), and delivery is less reliable/slower than native APNs — risky for a sub-24h deadline.
3. **Background/realtime delivery.** Realtime only fires while the tab is open and foregrounded; there is no background channel to wake the app.

Lesser: camera/photo and ID-verify are fine on web (file-input + Persona). App-store trust is a marketing/perception gap, not a functional one.

## Degraded-but-acceptable vs blocked-without-native

- **Acceptable on web today:** signup, onboard (photos + Persona verify), create/browse nights, the interested list, match/reveal, rate — all render and work mobile-first. Chat is not yet built (out of scope here).
- **Genuinely degraded without push:** the offer/accept urgency loop for any user not staring at an open tab. This is the only experience that is functionally compromised, and it is fixable on web — it does NOT require native.

## Minimal web-PWA work to reach tester-cohort-acceptable

1. Add `app/manifest.ts` + app icons (192/512 + maskable) + `apple-touch-icon`, and an explicit `viewport` export with `theme-color`. (Unlocks install + iOS push prerequisite.)
2. Add a service worker (serwist/next-pwa) for web-push receipt + a minimal offline shell.
3. Add a **web-push subscription** for offer/match events (server VAPID + an Edge Function fan-out alongside the existing realtime insert), with an **email fallback** for the offer notification so iOS/declined-permission testers still get the time-boxed prompt. Email infra already exists (`public/email`).
4. Prompt for notification permission post-onboarding (not on load).

Items 1–3 are the load-bearing slice; without push-or-email fallback the time-boxed mechanic is not demonstrable to an unattended cohort.

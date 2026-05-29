# Plan — rebrand the dating entry funnel

Date: 2026-05-29
Spec: `docs/superpowers/specs/2026-05-29-rebrand-entry-funnel-design.md`
Order (quick win → outward): callback routing → metadata/OG → login restyle → landing rebuild → auth emails + wiring → verify.
Commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
Branch first (repo currently has 5b work on main, unpushed). All paths absolute-from-repo-root under `/Users/lucas/Projects/After5/`.

---

## Task 1 — Callback default `/account` → `/home` (+ test)

File: `apps/web/app/auth/callback/route.ts`

Edit 1 (L19):
```ts
const next = searchParams.get('next') ?? '/home';
```
Edit 2 (L76):
```ts
const safeNext = next.startsWith('/') ? next : '/home';
```
Edit 3 — fix the stale comment on L70 (the `claimItineraries` block): change "So the user lands on /account and immediately sees" → "So a returning planner user still has their plans claimed (they now land on /home by default)."

New test file: `apps/web/app/auth/callback/__tests__/route.test.ts` (vitest + jsdom; mirror `apps/web/app/offers/[offerId]/__tests__/*.test.ts`). Mock the side-effect modules so only redirect logic is exercised:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({
        data: { session: { user: { id: 'u1', email: 'a@b.com', user_metadata: {} } } },
        error: null,
      })),
    },
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ is: async () => ({ error: null, count: 0 }) }) }),
    }),
  })),
}));
vi.mock('@/lib/email/welcome', () => ({ ensureWelcomeSent: vi.fn(async () => {}) }));

import { GET } from '../route';

function req(url: string) {
  return new Request(url) as unknown as import('next/server').NextRequest;
}

describe('auth callback redirect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to /home when no next param', async () => {
    const res = await GET(req('https://app.test/auth/callback?code=abc'));
    expect(res.headers.get('location')).toBe('https://app.test/home');
  });

  it('preserves an explicit relative next', async () => {
    const res = await GET(req('https://app.test/auth/callback?code=abc&next=/feed'));
    expect(res.headers.get('location')).toBe('https://app.test/feed');
  });

  it('rejects an absolute (open-redirect) next and falls back to /home', async () => {
    const res = await GET(req('https://app.test/auth/callback?code=abc&next=https://evil.com'));
    expect(res.headers.get('location')).toBe('https://app.test/home');
  });

  it('redirects to /login on missing code', async () => {
    const res = await GET(req('https://app.test/auth/callback'));
    expect(res.headers.get('location')).toBe('https://app.test/login?error=no_code');
  });
});
```
Verify: `pnpm --filter web vitest run app/auth/callback` (or repo's vitest invocation). No browser needed.
Commit: `fix(auth): default post-login to /home (dating), preserve explicit next`.

---

## Task 2 — Metadata/OG to dating (copy-only)

File: `apps/web/app/layout.tsx`, the `metadata` object (L42-66). Replace with:
```ts
export const metadata: Metadata = {
  title: {
    default: 'after5 — match on the night, not the guy',
    template: '%s · after5',
  },
  description:
    "the dating app where you match around a real night out. everyone's verified. less small talk, more showing up.",
  metadataBase: new URL('https://tryafter5.app'),
  openGraph: {
    title: 'after5 — match on the night, not the guy',
    description:
      "the dating app where you match around a real night out. everyone's verified. less small talk, more showing up.",
    url: 'https://tryafter5.app',
    siteName: 'after5',
    locale: 'en_CA',
    type: 'website',
    images: [{ url: '/og.jpg', width: 1920, height: 1080, alt: 'after5 — match on the night, not the guy' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'after5',
    description: 'match on the night, not the guy.',
    images: ['/og.jpg'],
  },
};
```
Leave fonts, `metadataBase`, `/og.jpg` path untouched. (New dating `og.jpg` asset = separate task; keep path so OG never 404s.)
Verify: `pnpm --filter web build` type-checks; visual check of tab title. No DB.
Commit: `chore(meta): rebrand title/OG to dating front door`.

---

## Task 3 — Login restyle (mechanics frozen)

File: `apps/web/app/login/LoginForm.tsx`. Do NOT touch handler logic, state, `/api/stats`, cooldown, `GoogleIcon`, `Suspense`. Add `import { Polaroid } from '@/components/Polaroid';`.

Changes:
1. `next` default (L25): `const next = searchParams.get('next') ?? '/home';`
2. Canvas `<main>` (L117): `className="relative min-h-screen overflow-hidden bg-shell-base"`.
3. Ambient blobs (L120-124): replace the amber/rose block with a single soft wash:
```tsx
<div aria-hidden className="pointer-events-none absolute inset-0">
  <div className="absolute left-1/2 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-shell-pink/50 blur-3xl" />
</div>
```
4. Wordmark (L128): `className="font-heading text-xl lowercase tracking-tight text-shell-accent"` text `after5`. "← Home" link → `text-shell-ink/60 hover:text-shell-ink`.
5. Polaroid accent (L144-157): replace the inline planner polaroid with:
```tsx
<div className="pointer-events-none absolute -right-3 -top-10 z-20 hidden md:block">
  <Polaroid tone="dating" src="/gallery/couple-dance-sunset.jpg" alt="" label="tonight" size="md" rotation={6} />
</div>
```
6. Card (L159): `className="animate-card-in relative rounded-3xl border border-shell-accent/10 bg-white/80 px-7 pb-9 pt-9 shadow-fun backdrop-blur-md md:px-10 md:pb-11 md:pt-11"`.
7. Early-access chip (L161-175): keep the `remaining`/`claimed`/waitlist mechanic; restyle wrapper to `rounded-full bg-shell-pink px-3 py-1.5 text-[11px] font-semibold lowercase text-shell-ink ring-1 ring-shell-accent/20` and copy `first 100 in your city`; the divider border → `border-shell-ink/15`, dot → `bg-shell-accent`.
8. H1 (L187-191):
```tsx
<h1 className="mt-7 font-heading text-[40px] lowercase leading-[1.02] text-shell-ink md:text-[48px]">
  let&apos;s get you in.
</h1>
```
9. Subhead (L192-194): `className="mt-4 max-w-[400px] font-body text-[15px] leading-relaxed text-shell-ink/65"` text: `sign in to match on real nights near you. no passwords, just a link.`
10. Sent-state block (L196-212): wrapper `rounded-3xl border border-shell-accent/20 bg-shell-pink/40 p-5`, heading `font-heading text-base lowercase text-shell-ink` "check your inbox.", body `font-body text-shell-ink/70`, "Use a different email" → "use a different email".
11. Google button (L215-222): `border-shell-ink/15 bg-white text-shell-ink ... focus-visible:ring-shell-accent/40`, label "continue with google".
12. Divider (L224-228): text `or email` stays; `text-shell-ink/40`, hairlines `to-shell-ink/15`.
13. Email field (L230-261): label "email" `text-shell-ink/60`; input `border-shell-ink/15 bg-white/80 text-shell-ink placeholder:text-shell-ink/35 focus:border-shell-accent focus:ring-shell-accent/15`; submit button idle state `bg-shell-accent text-white shadow-fun hover:scale-[1.02] active:scale-95 focus-visible:ring-shell-accent/40 motion-reduce:hover:scale-100`, sending state `bg-shell-ink/15 text-shell-ink/50`; labels "sending…" / "email me a link".
14. Social-proof strip (L271-298): border `border-shell-ink/10`, names `text-shell-ink`, body `text-shell-ink/65 font-body`.
15. Terms footnote (L301-317): `text-shell-ink/45 font-body`, underline `decoration-shell-ink/30`.
16. `font-body` on body copy; remove every `text-text`/`text-secondary`/`text-muted`/`border-text`/`focus:ring-accent`/`font-display`/`bg-background` in the file. Keep the `animate-card-in` keyframe `<style jsx global>` block (motion already respects taste; it's a one-shot entrance).

Verify: `pnpm --filter web build`; browser at `/login` — magic-link send still works, Google button renders, reduced-motion OK. **Browser verification required.**
Commit: `feat(login): restyle to Barbiecore dating, default next=/home`.

---

## Task 4 — Landing rebuild (full)

This is the big one. Two files.

### 4a. New client child: `apps/web/components/LandingHero.tsx`
Holds all framer-motion so `page.tsx` stays a server component. `'use client'`, `useReducedMotion`, `Polaroid tone="dating"`. Skeleton:
```tsx
'use client';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import { Polaroid } from '@/components/Polaroid';

export function LandingHero() {
  const reduce = useReducedMotion();
  const spring = { type: 'spring' as const, stiffness: 360, damping: 30 };
  return (
    <section className="mx-auto w-full max-w-[480px] px-6 pt-16 pb-10 text-center md:pt-24">
      <motion.div
        className="mb-9 flex items-end justify-center gap-2"
        initial={reduce ? false : { opacity: 0, y: 14 }}
        animate={reduce ? false : { opacity: 1, y: 0 }}
        transition={spring}
      >
        <Polaroid tone="dating" src="/gallery/pottery-wheel.jpg" alt="two people laughing at a pottery wheel" size="sm" rotation={-7} className="-mr-2 translate-y-3" />
        <Polaroid tone="dating" src="/gallery/couple-dance-sunset.jpg" alt="a couple dancing against an orange sunset" label="real nights" size="md" rotation={2} />
        <Polaroid tone="dating" src="/gallery/rooftop-pizza-sunset.jpg" alt="friends sharing pizza on a rooftop at golden hour" size="sm" rotation={7} className="-ml-2 translate-y-4" />
      </motion.div>
      <motion.h1
        className="font-heading text-4xl lowercase leading-[1.02] text-shell-ink md:text-5xl"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={reduce ? false : { opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.05 }}
      >
        match on the night, not the guy.
      </motion.h1>
      <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70 md:text-base">
        after5 builds your match around an actual plan for the evening. everyone&apos;s verified. less small talk, more showing up.
      </p>
      <div className="mt-8 flex flex-col items-center gap-3">
        <Link href="/onboarding" className="rounded-full bg-shell-accent px-8 py-3.5 font-body text-[15px] font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100">
          let&apos;s go
        </Link>
        <Link href="/plan" className="font-body text-sm lowercase text-shell-ink/55 underline decoration-shell-ink/25 underline-offset-4 transition hover:text-shell-ink">
          or just plan a night
        </Link>
      </div>
    </section>
  );
}
```
(Confirm framer-motion `'use client'` usage matches `WelcomeAgeGate.tsx`; `Polaroid` is already a client component so importing it here is fine.)

### 4b. Rewrite `apps/web/app/page.tsx`
Make it a plain server component (mobile-first phone-width container, `bg-shell-base`). REMOVE all imports/fetches for `ExploreDatesStrip`, `WowFactorStrip`, `HonestTestimonials`, `RecentBuildsToast`, `SafeCoverImage`, `coverImageFor`, `getSeason`, `SEASON_LABELS`, `PLAN_THEMES`, `createClient`, `fetchLandingData`, `Sparkles`, `ArrowRight`, the `revalidate` export, and the `VIBES`/`SAMPLE_PLANS`/`BENEFITS`/`ItineraryRow`/`StopShape`/`LocalInsightRow` consts and types. Keep `Link`, add `LandingHero`, `Polaroid`, `UserMenu`.

Structure (real markup, lowercase, dry):
```tsx
import Link from 'next/link';
import { LandingHero } from '@/components/LandingHero';
import { Polaroid } from '@/components/Polaroid';
import { UserMenu } from '@/components/UserMenu';

const STEPS = [
  { n: '01', head: 'pick a night, not a face', body: 'browse real plans people posted for the week.' },
  { n: '02', head: 'match on the plan', body: 'you like a night, they like you back, you’re locked in.' },
  { n: '03', head: 'show up', body: 'everyone’s verified, so the date is the date.' },
] as const;

export default function HomePage() {
  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="absolute inset-x-0 top-0 z-50">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-5">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">after5</Link>
          <div className="flex items-center gap-3">
            <UserMenu variant="on-dark" />
            <Link href="/onboarding" className="rounded-full bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun">let&apos;s go</Link>
          </div>
        </nav>
      </header>

      <LandingHero />

      {/* how it works */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <h2 className="font-heading text-2xl lowercase text-shell-ink">how it works</h2>
        <div className="mt-6 space-y-5">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-4">
              <span className="font-heading text-2xl lowercase text-shell-accent [font-variant-numeric:tabular-nums]">{s.n}</span>
              <div>
                <h3 className="font-body text-base font-semibold lowercase text-shell-ink">{s.head}</h3>
                <p className="mt-1 font-body text-sm leading-relaxed text-shell-ink/65">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* scrapbook of real nights */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Polaroid tone="dating" src="/gallery/bouldering-kiss.jpg" alt="two climbers kissing at a bouldering gym" label="active" size="sm" rotation={-5} />
          <Polaroid tone="dating" src="/gallery/ramen-couple.jpg" alt="a couple sharing ramen at a counter" label="foodie" size="sm" rotation={4} />
          <Polaroid tone="dating" src="/gallery/vinyl-records-filmic.jpg" alt="two people flipping through vinyl records" label="chill" size="sm" rotation={-3} />
          <Polaroid tone="dating" src="/gallery/beach-cards-sunset.jpg" alt="a couple playing cards on a beach at sunset" label="evening" size="sm" rotation={6} />
        </div>
      </section>

      {/* verified reassurance — only allowed pink wash */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <div className="rounded-3xl bg-shell-pink/60 p-6 text-center ring-1 ring-shell-accent/10">
          <p className="font-body text-sm leading-relaxed text-shell-ink/75">
            everyone&apos;s id-verified. the person who shows up is the person from the photos.
          </p>
        </div>
      </section>

      {/* planner wedge */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-shell-ink/10 p-6 text-center">
          <p className="font-body text-sm text-shell-ink/70">just want to plan a date? we still do that.</p>
          <Link href="/plan" className="rounded-full border-2 border-shell-ink/15 px-6 py-2.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-ink/30 active:scale-95">plan a night</Link>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-6">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-body text-xs lowercase text-shell-ink/45">
          <Link href="/about" className="hover:text-shell-ink">about</Link>
          <Link href="/privacy" className="hover:text-shell-ink">privacy</Link>
          <Link href="/terms" className="hover:text-shell-ink">terms</Link>
          <a href="mailto:hello@tryafter5.app" className="hover:text-shell-ink">hello@tryafter5.app</a>
        </div>
      </footer>
    </main>
  );
}
```
Notes: confirm `UserMenu` accepts `variant="on-dark"` (it did on the old landing); if its variant clashes on a light shell, pass a light-appropriate variant or drop the prop. No DB, no nullable image src (all `/gallery/*` are real files — verified present). Drop `Sparkles`/`ArrowRight`.

Verify: `pnpm --filter web build`; browser at `/` — hero motion, reduced-motion, "let's go" → `/onboarding`, "plan a night" → `/plan`, polaroids load, a11y heading order, tap targets ≥44px. **Browser verification required.**
Commit: `feat(landing): rebuild / as dating front door, planner kept as wedge`.

---

## Task 5 — Auth emails rebrand + delivery wiring

### 5a. Rebrand the three HTML files
Files: `supabase/email-templates/magic-link.html`, `confirm-signup.html`, `reset-password.html`. Apply per spec §3.5. For `magic-link.html` the key swaps (mirror across all three with their own headlines/subjects):
- `<body>` + outer table bg `#FDF9F3` → `#FAF4EC`; `class="bg-cream"` + its `@media` value → `#FAF4EC`.
- Add a progressive-enhancement font link in `<head>` (clients that support it; everything stays inline-safe):
  `<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600&family=Caprasimo&display=swap" rel="stylesheet">`
  and set the `<style>` body font stack to `'Fredoka','Trebuchet MS','Segoe UI',sans-serif`; headline inline `font-family:'Caprasimo','Trebuchet MS',Georgia,serif;` lowercase.
- Card: bg `#FFFFFF` stays; border `#E8DFCB` → `#F3C7DE`; `border-radius:18px` → `24px`.
- Eyebrow color `#8B8884` stays (neutral). Accent `#C2552B` → `#E0218A` (the italic word + the paste-link `<a>`). Ink `#1A1A1A` → `#3D0F2E` (wordmark, headline, CTA bg).
- Wordmark anchor text "After5" → "after5" lowercase, color `#3D0F2E`.
- magic-link headline: `let&rsquo;s get you <em style="font-style:italic;font-weight:600;color:#E0218A;">in</em>.` (lowercase).
- body: "tap below to sign in and match on real nights near you. the link&rsquo;s good for one hour."
- CTA pill bg `#1A1A1A` → `#3D0F2E`, hover `a.btn:hover` `#2a2a2a` → `#560f3f`; label "sign in to after5 &rarr;".
- footer: drop "Curated date plans for Kelowna couples…" → "the dating app that&rsquo;s actually fun. <a ...>tryafter5.app</a>".
- `{{ .ConfirmationURL }}` token UNCHANGED in all three.
- `confirm-signup.html`: headline "confirm your email", body adjusted, CTA "confirm my email". `reset-password.html`: headline "reset your password", CTA "reset password". Keep each file's existing structure; only swap tokens/copy.

### 5b. Update README (the path prod actually uses)
File: `supabase/email-templates/README.md`. Update the subject-line table to lowercase dating subjects:
- magic-link → `your after5 sign-in link`
- confirm-signup → `confirm your after5 email`
- reset-password → `reset your after5 password`
And update the description paragraph (L3) from the warm-cream/terracotta language to the dating brand description. Keep the dashboard install steps + Resend SMTP section (those mechanics are unchanged).

### 5c. Wire config.toml (additive, do NOT push)
File: `supabase/config.toml`, after L237 (`otp_expiry`) and before the SMTP comment block. Add (paths are relative to the `supabase/` dir):
```toml
[auth.email.template.magic_link]
subject = "your after5 sign-in link"
content_path = "./email-templates/magic-link.html"

[auth.email.template.confirmation]
subject = "confirm your after5 email"
content_path = "./email-templates/confirm-signup.html"

[auth.email.template.recovery]
subject = "reset your after5 password"
content_path = "./email-templates/reset-password.html"
```
Risk: this only changes LOCAL auth rendering (and a future explicit `supabase config push`); it does not touch dashboard/prod. Mitigation in verify.

Verify (5):
- HTML lint / open each file in a browser — renders, no broken markup, accent is pink.
- `supabase start` (or `supabase stop && supabase start`) succeeds with the new `content_path` blocks (proves paths resolve, doesn't break local auth). If `supabase` CLI/Docker unavailable in this env, at minimum assert each `content_path` file exists from repo root: `supabase/email-templates/<file>.html`.
- Send one magic link from local `/login`, open Inbucket (`http://localhost:54324`) → confirm the dating template renders.
- Prod delivery is the dashboard paste (manual, listed here, NOT automated): paste rebranded HTML + subjects into Authentication → Email Templates. Do NOT `supabase config push`.
**Browser/Inbucket verification required; prod paste is a manual follow-up the user runs.**
Commit: `feat(emails): rebrand auth templates to dating + wire config (local only)`.

---

## Task 6 — Final verify pass
- `pnpm --filter web build` clean (types + lint).
- `pnpm --filter web vitest run` green (incl. new callback test).
- Browser sweep: `/` (motion + reduced-motion + CTAs + tap targets), `/login` (send link + Google + reduced-motion), Inbucket email render.
- Grep guard: no `text-text|text-secondary|text-muted|font-display|bg-background|Kelowna|Plan my date` reintroduced in `app/page.tsx`, `app/login/LoginForm.tsx`, `app/layout.tsx`. Planner files keep theirs — scope the grep to the three changed surfaces.
- DESIGN-SYSTEM §Before-shipping checklist on landing + login.
Do NOT commit beyond per-task commits; do NOT push or `config push`; user reviews.

## Browser-verification summary
Needs a browser: Task 3 (login), Task 4 (landing), Task 5 (email render via Inbucket). Inspection/unit only: Task 1 (callback test), Task 2 (metadata).

## Divergence flagged
Primary landing/nav CTA routes to `/onboarding`, not `/feed` (audit floated `/feed`): a cold tester has no profile, and `/feed`/`/home` redirect to `/onboarding` or render empty without it, so `/onboarding` is the correct cold-start door. Returning signed-in users still reach `/home` via the callback default + their `UserMenu`.

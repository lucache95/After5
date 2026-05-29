// apps/web/app/offers/[offerId]/AccountGate.tsx
// Full-screen fallback shown when the candidate can't act on an offer because
// of their own account state. deriveGateReason is a pure priority resolver
// (dating_disabled > verify > standing/account_state) reused on the server
// (page-level gate) and the client (mid-session account_gated from the edge).
// Copy is lowercase, stop-slop (DESIGN-SYSTEM §4).
'use client';
import Link from 'next/link';

export type GateReason = 'verify' | 'cooldown' | 'suspended' | 'dating_disabled' | 'blocked' | 'generic';

export function deriveGateReason(me: {
  dating_enabled: boolean | null;
  verification: string | null;
  standing: string | null;
  account_state: string | null;
}): GateReason | null {
  if (me.dating_enabled === false) return 'dating_disabled';
  if (me.verification !== 'verified') return 'verify';
  if (me.standing === 'cooldown') return 'cooldown';
  if (me.standing === 'suspended' || me.standing === 'locked_ban') return 'suspended';
  if (me.account_state && me.account_state !== 'active') return 'suspended';
  return null;
}

const COPY: Record<GateReason, { headline: string; body: string; href: string; cta: string }> = {
  verify: {
    headline: 'verify first',
    body: "finish verifying and this offer is yours to take.",
    href: '/onboarding',
    cta: 'verify now',
  },
  cooldown: {
    headline: 'taking a short break',
    body: "you're in a cooldown. it lifts soon — check your account for the details.",
    href: '/settings/account',
    cta: 'see your account',
  },
  suspended: {
    headline: 'your account is on hold',
    body: "we've paused dating on this account. reach out if you think that's wrong.",
    href: 'mailto:support@after5.app',
    cta: 'contact support',
  },
  dating_disabled: {
    headline: 'dating is switched off',
    body: 'turn dating back on and this offer is waiting for you.',
    href: '/settings/dating',
    cta: 'turn it on',
  },
  blocked: {
    headline: "can't take this offer",
    body: "this one isn't available to you. there's more in the feed.",
    href: '/feed',
    cta: 'back to the feed',
  },
  generic: {
    headline: "can't take this offer",
    body: "something's off with this offer right now. there's more in the feed.",
    href: '/feed',
    cta: 'back to the feed',
  },
};

export function AccountGate({ reason }: { reason: GateReason }) {
  const { headline, body, href, cta } = COPY[reason];
  const isMail = href.startsWith('mailto:');
  const linkClass =
    'mt-8 inline-flex min-h-[48px] items-center justify-center rounded-full bg-shell-accent px-8 font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40';

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
      <div className="mx-auto max-w-[420px]">
        <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">{headline}</h1>
        <p className="mt-4 font-body text-lg text-shell-ink/70">{body}</p>
        {isMail ? (
          <a href={href} className={linkClass}>{cta}</a>
        ) : (
          <Link href={href} className={linkClass}>{cta}</Link>
        )}
      </div>
    </main>
  );
}

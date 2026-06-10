// /join — public application page for the after5 insiders program.
// Server component renders the hero + role cards; JoinForm handles interactivity.

import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Star, Megaphone, Compass } from 'lucide-react';
import { UserMenu } from '@/components/UserMenu';
import { JoinForm } from './JoinForm';

export const metadata: Metadata = {
  title: 'become an after5 insider',
  description:
    'help shape the best date experiences near you. join the after5 insiders program as a scout, tester, curator, or ambassador.',
};

const ROLES = [
  {
    name: 'scout',
    icon: Compass,
    description: 'find hidden gems and report back on new spots near you.',
  },
  {
    name: 'tester',
    icon: Star,
    description: 'go on dates from after5 and give honest feedback on the night.',
  },
  {
    name: 'curator',
    icon: MapPin,
    description: 'help write venue descriptions, vibes, and local insight.',
  },
  {
    name: 'ambassador',
    icon: Megaphone,
    description: 'spread the word and rep after5 in your scene.',
  },
] as const;

const PERKS = [
  'your name on every date you help build',
  'insider events and tastings',
  'partner perks from local venues',
  'early access to every new feature',
];

export default function JoinPage() {
  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">
            after5
          </Link>
          <div className="flex items-center gap-3">
            <UserMenu variant="on-light" />
            <Link
              href="/create"
              className="rounded-full bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
            >
              make my date
            </Link>
          </div>
        </nav>
      </header>

      {/* hero */}
      <section className="mx-auto w-full max-w-[480px] px-6 pb-10 pt-14 text-center">
        <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
          now taking applications
        </p>
        <h1 className="font-heading text-4xl lowercase leading-[1.04] text-shell-ink md:text-5xl">
          become an after5 insider
        </h1>
        <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70">
          the best nights come from people who know the area. join the insiders and help build the dates everyone swipes on.
        </p>
      </section>

      {/* role cards */}
      <section className="mx-auto w-full max-w-[480px] px-6 pb-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {ROLES.map((role) => {
            const Icon = role.icon;
            return (
              <div
                key={role.name}
                className="rounded-3xl border-2 border-shell-ink/10 bg-white p-6 shadow-fun"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-shell-pink text-shell-accent">
                    <Icon className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                  <h3 className="font-heading text-lg lowercase text-shell-ink">{role.name}</h3>
                </div>
                <p className="font-body text-sm leading-relaxed text-shell-ink/65">
                  {role.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* what you get */}
      <section className="mx-auto w-full max-w-[480px] px-6 pb-10">
        <div className="rounded-3xl bg-shell-pink/60 p-6 ring-1 ring-shell-accent/10">
          <h2 className="font-heading text-2xl lowercase text-shell-ink">what you get</h2>
          <ul className="mt-5 space-y-3">
            {PERKS.map((perk) => (
              <li
                key={perk}
                className="flex items-start gap-3 font-body text-[15px] leading-relaxed text-shell-ink/80"
              >
                <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-shell-accent" />
                {perk}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* application form */}
      <section className="mx-auto w-full max-w-[480px] px-6 pb-16">
        <h2 className="font-heading text-2xl lowercase text-shell-ink">apply to join</h2>
        <p className="mb-7 mt-1 font-body text-sm text-shell-ink/65">
          takes about 2 minutes. we read every one by hand.
        </p>
        <JoinForm />
      </section>

      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-2">
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

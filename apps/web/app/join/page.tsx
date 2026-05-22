// /join — public application page for the After5 Insiders program.
// Server component renders the hero + role cards; JoinForm handles interactivity.

import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Star, Megaphone, Compass } from 'lucide-react';
import { JoinForm } from './JoinForm';

export const metadata: Metadata = {
  title: 'Become an After5 Insider',
  description:
    'Help shape the best date experiences in Kelowna. Join the After5 Insiders program as a Scout, Tester, Curator, or Ambassador.',
};

const ROLES = [
  {
    name: 'Scout',
    icon: Compass,
    description: 'Discover hidden gems and report back on new spots around Kelowna.',
  },
  {
    name: 'Tester',
    icon: Star,
    description: 'Go on dates from After5 and give honest feedback on the experience.',
  },
  {
    name: 'Curator',
    icon: MapPin,
    description: 'Help write and polish venue descriptions, vibes, and local insights.',
  },
  {
    name: 'Ambassador',
    icon: Megaphone,
    description: 'Spread the word and represent After5 in your community.',
  },
] as const;

const PERKS = [
  'Your name on every date plan you help create',
  'Exclusive insider events and tastings',
  'Partner perks from Kelowna venues',
  'Early access to every new feature',
];

export default function JoinPage() {
  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/90 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-3 md:px-10">
          <Link
            href="/"
            className="font-display text-base font-semibold tracking-tight text-text"
          >
            After5
          </Link>
          <Link
            href="/plan"
            className="rounded-pill bg-text px-4 py-1.5 text-sm font-medium text-background transition-colors hover:bg-text/90"
          >
            Plan a date
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 pb-12 pt-16 text-center md:px-10 md:pt-24">
        <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-accent">
          Now accepting applications
        </p>
        <h1 className="font-display text-4xl font-bold tracking-[-0.02em] text-text md:text-5xl">
          Become an After5{' '}
          <em className="font-semibold italic text-accent">Insider</em>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-secondary">
          After5 is built by one person, but the best dates come from a community
          that knows Kelowna inside out. Join the Insiders and help shape the
          date plans every couple in town relies on.
        </p>
      </section>

      {/* Role cards */}
      <section className="mx-auto max-w-4xl px-6 pb-16 md:px-10">
        <div className="grid gap-4 sm:grid-cols-2">
          {ROLES.map((role) => {
            const Icon = role.icon;
            return (
              <div
                key={role.name}
                className="rounded-card border border-border bg-background p-6 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)]"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
                    <Icon className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                  <h3 className="font-display text-lg font-semibold text-text">
                    {role.name}
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-secondary">
                  {role.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* What you get */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto max-w-3xl px-6 py-14 md:px-10">
          <h2 className="mb-6 font-display text-2xl font-bold tracking-[-0.02em] text-text">
            What you get
          </h2>
          <ul className="space-y-3">
            {PERKS.map((perk) => (
              <li
                key={perk}
                className="flex items-start gap-3 text-[15px] leading-relaxed text-text"
              >
                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent" />
                {perk}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Application form */}
      <section className="mx-auto max-w-2xl px-6 py-16 md:px-10">
        <h2 className="mb-2 font-display text-2xl font-bold tracking-[-0.02em] text-text">
          Apply to join
        </h2>
        <p className="mb-8 text-sm text-secondary">
          Takes about 2 minutes. We review every application by hand.
        </p>
        <JoinForm />
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8 text-center text-xs text-muted">
        <Link
          href="/"
          className="underline decoration-border hover:text-text hover:decoration-text"
        >
          tryafter5.app
        </Link>
        {' '}
        &middot; Curated date plans for Kelowna couples
      </footer>
    </main>
  );
}

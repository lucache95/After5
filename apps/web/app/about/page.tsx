// Stub about page — referenced by CuratorCard's "Meet the team" link.
// Built with the same warm-cream + polaroid language as /login and /account
// so it feels like part of the same conversation. Real content (founder
// story, principles) lives below.

import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Polaroid } from '@/components/Polaroid';
import { UserMenu } from '@/components/UserMenu';

export const metadata: Metadata = {
  title: 'About · After5',
  description:
    'After5 is curated date plans for Kelowna couples — built by people who actually live here.',
};

const PRINCIPLES = [
  {
    title: 'Real places, sequenced honestly.',
    body: 'We list a spot if we\'d send our friends. Hours, drive times, and order matter — nothing closes mid-date on our watch.',
  },
  {
    title: 'The plan comes first.',
    body: 'After5 is for the next 30 seconds: turn "where should we go?" into a real plan. Matching, sharing, swiping someone else\'s plan — that\'s coming. The plan itself stays the centre.',
  },
  {
    title: 'Forever free for the first 1000.',
    body: 'No pricing page. No upsell. Our early Kelownans get every future feature on the house — that\'s the deal.',
  },
];

export default function AboutPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* Ambient warm gradient */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-gradient-to-br from-amber-200/45 via-orange-200/25 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <header className="relative z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">
            After5
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/plan"
              className="hidden items-center gap-2 rounded-pill bg-text px-5 py-2 text-sm font-medium text-background transition-transform hover:-translate-y-0.5 sm:inline-flex"
            >
              Plan a date
            </Link>
            <UserMenu variant="on-light" />
          </div>
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-content px-6 pb-20 pt-12 md:px-10 md:pb-32 md:pt-20">
        {/* HERO */}
        <section className="grid grid-cols-1 gap-12 md:grid-cols-[1.4fr_1fr] md:gap-16">
          <div>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              About
            </p>
            <h1 className="font-display text-[44px] font-bold leading-[1.02] tracking-[-0.03em] text-text md:text-[64px]">
              Date plans by{' '}
              <span className="italic font-semibold text-accent">people who live here</span>
              .
            </h1>
            <p className="mt-6 max-w-prose text-base leading-relaxed text-secondary md:text-lg">
              After5 started with one frustration: the best dates in Kelowna aren&apos;t hidden,
              they&apos;re just buried. Yelp won&apos;t sequence them. ChatGPT will hallucinate
              half the addresses. So we built the thing we wanted: a planner that picks real
              spots, in the right order, for the night you&apos;re actually having.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/plan"
                className="inline-flex items-center gap-2 rounded-pill bg-text px-7 py-3.5 text-base font-medium text-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]"
              >
                Build a plan
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
              </Link>
              <Link
                href="/dates"
                className="text-sm font-medium text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
              >
                See what others built
              </Link>
            </div>
          </div>

          <div className="relative hidden min-h-[320px] md:block">
            <div className="absolute right-16 top-0">
              <Polaroid
                src="/pins/couple-trail.jpg"
                alt="Okanagan trail"
                label="EAST KELOWNA · 26"
                size="lg"
                rotation={-7}
              />
            </div>
            <div className="absolute right-0 top-44">
              <Polaroid
                src="/pins/couple-lake-kiss.jpg"
                alt="Lake Okanagan"
                label="DOWNTOWN"
                size="md"
                rotation={9}
              />
            </div>
          </div>
        </section>

        {/* PRINCIPLES */}
        <section className="mt-24 md:mt-32">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            How we work
          </p>
          <h2 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-4xl">
            Three things we won&apos;t compromise on.
          </h2>

          <div className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-8">
            {PRINCIPLES.map((p, i) => (
              <div key={p.title} className="rounded-[16px] border border-amber-100/80 bg-white/85 p-7 backdrop-blur-md">
                <p className="font-display text-[11px] font-bold tracking-[0.18em] text-accent [font-variant-numeric:tabular-nums]">
                  0{i + 1}
                </p>
                <h3 className="mt-3 font-display text-xl font-semibold leading-tight text-text">
                  {p.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-secondary">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* TEAM */}
        <section className="mt-24 md:mt-32">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            The curator
          </p>
          <h2 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-4xl">
            One Kelownan who&apos;s done every stop.
          </h2>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-secondary">
            After5 is just me right now — built and reality-checked from Lower Mission. Every spot in
            the catalog is one I&apos;d send a friend to. As we grow, the plan is to bring on locals
            who actually know their neighbourhood — but until then, &quot;curated by people who
            actually live here&quot; means me, with a paper notebook, on a Tuesday night.
          </p>

          <div className="mt-10 flex justify-center md:justify-start">
            <TeamCard initial="L" name="Lucas" role="Founder · Lower Mission" color="bg-rose-500" />
          </div>
        </section>

        {/* CONTACT */}
        <section className="mt-24 md:mt-32">
          <div className="rounded-[20px] border border-amber-100 bg-gradient-to-br from-amber-50/90 via-white/80 to-rose-50/70 p-8 backdrop-blur-md md:p-12">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-amber-900/80">
              Questions, ideas, places we&apos;re missing
            </p>
            <h2 className="font-display text-2xl font-bold leading-tight text-text md:text-3xl">
              Email{' '}
              <a
                href="mailto:lucas@lucassenechal.com"
                className="italic font-semibold text-accent underline decoration-accent/30 underline-offset-[6px] transition-colors hover:decoration-accent"
              >
                lucas@lucassenechal.com
              </a>
              .
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-secondary">
              We read everything. Especially: what you wished a plan included, and which spots we should add.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function TeamCard({
  initial,
  name,
  role,
  color,
}: {
  initial: string;
  name: string;
  role: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span
        className={`inline-flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold text-white ring-4 ring-white shadow-[0_8px_20px_-6px_rgba(80,40,20,0.25)] ${color}`}
      >
        {initial}
      </span>
      <p className="mt-4 font-display text-base font-semibold text-text">{name}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-secondary">{role}</p>
    </div>
  );
}

// /roadmap — radical-transparency page. What After5 is today, what's coming
// next, where money fits in, why we're not chasing partnerships, and an open
// invite for stores who want in.
//
// Same warm-cream + polaroid brand language as /about and /login.

import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Check, Clock, Sparkles } from 'lucide-react';
import { Polaroid } from '@/components/Polaroid';
import { UserMenu } from '@/components/UserMenu';

export const metadata: Metadata = {
  title: 'Roadmap · After5',
  description:
    'Where After5 is today, what\'s coming next, and how we\'ll handle pricing + partnerships. Built in the open.',
};

interface Item {
  title: string;
  body: string;
}

const LIVE: Item[] = [
  {
    title: 'AI-built date plans',
    body: '5 questions, 3 plans, 30 seconds. Real Kelowna spots, sequenced honestly — no closed restaurants, no two bars in a row.',
  },
  {
    title: 'Save + share',
    body: 'Heart any plan to keep it. Share to friends so they can see exactly what you\'d do.',
  },
  {
    title: 'Public catalog',
    body: 'Every plan becomes a shareable URL. Browse what other Kelownans built at /dates.',
  },
  {
    title: 'Wow-factor twists',
    body: 'Every plan ships with one optional ritual — phones in a bag, two truths one lie, the secret word — to turn a night out into a memory.',
  },
];

const NEXT: Item[] = [
  {
    title: 'Customize after generation',
    body: 'Swap a stop you don\'t love, rename the plan, drop a note for your partner — without re-rolling the whole night.',
  },
  {
    title: 'Better photos + booking links',
    body: 'Every place gets a quality-rated photo (day vs evening) and a one-tap booking method (OpenTable, phone, walk-in).',
  },
  {
    title: 'Other Okanagan cities',
    body: 'Kamloops, Vernon, Penticton — same engine, local catalog. Tell us which one you want first.',
  },
  {
    title: 'Plan-as-profile (the dating layer)',
    body: 'The big one. Build a plan, mark it shareable, and let other Kelownans swipe on it. They like your plan, you see the match, you can chat. Filters for who pays, vibe, neighbourhood. After5 stays a planner first — the dating part is opt-in.',
  },
];

export default function RoadmapPage() {
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

      <div className="relative z-10 mx-auto max-w-content px-6 pb-24 pt-12 md:px-10 md:pb-32 md:pt-20">
        {/* HERO */}
        <section className="grid grid-cols-1 gap-12 md:grid-cols-[1.4fr_1fr] md:gap-16">
          <div>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Building in the open
            </p>
            <h1 className="font-display text-[44px] font-bold leading-[1.02] tracking-[-0.03em] text-text md:text-[64px]">
              Where After5 is{' '}
              <span className="italic font-semibold text-accent">going</span>
              .
            </h1>
            <p className="mt-6 max-w-prose text-base leading-relaxed text-secondary md:text-lg">
              I&apos;m building this in public. Here&apos;s what works today, what&apos;s
              coming next, where money fits in, and what I&apos;m{' '}
              <span className="text-text">not</span> doing (yet). If you have ideas,{' '}
              <a href="mailto:lucas@lucassenechal.com" className="text-accent underline decoration-accent/40 underline-offset-[6px] transition-colors hover:decoration-accent">
                email me
              </a>{' '}
              — I read everything.
            </p>
          </div>

          <div className="relative hidden min-h-[300px] md:block">
            <div className="absolute right-12 top-2">
              <Polaroid
                src="/pins/couple-trail.jpg"
                alt="Okanagan trail"
                label="ROADMAP · 26"
                size="lg"
                rotation={-7}
              />
            </div>
            <div className="absolute right-0 top-44">
              <Polaroid
                src="/pins/couple-lake-kiss.jpg"
                alt="Lake Okanagan"
                label="WHAT'S NEXT"
                size="md"
                rotation={9}
              />
            </div>
          </div>
        </section>

        {/* LIVE TODAY */}
        <section className="mt-24 md:mt-32">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-900 ring-1 ring-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live now
            </span>
          </div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-4xl">
            What you can do today.
          </h2>
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            {LIVE.map((item, i) => (
              <div
                key={item.title}
                className="rounded-[16px] border border-emerald-100/80 bg-white/85 p-7 backdrop-blur-md"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                  <p className="font-display text-[11px] font-bold tracking-[0.18em] text-emerald-900 [font-variant-numeric:tabular-nums]">
                    Shipped · 0{i + 1}
                  </p>
                </div>
                <h3 className="mt-4 font-display text-xl font-semibold leading-tight text-text">
                  {item.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-secondary">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* WHAT'S NEXT */}
        <section className="mt-24 md:mt-32">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-900 ring-1 ring-amber-200">
              <Clock className="h-3 w-3" strokeWidth={2.5} /> Coming up
            </span>
          </div>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-4xl">
            What I&apos;m building <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>next</em>.
          </h2>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-secondary">
            Order subject to feedback. If you want one of these now,{' '}
            <a href="mailto:lucas@lucassenechal.com" className="text-accent underline decoration-accent/40 underline-offset-[6px] transition-colors hover:decoration-accent">
              say so
            </a>{' '}
            and it moves up.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            {NEXT.map((item, i) => (
              <div
                key={item.title}
                className="rounded-[16px] border border-amber-100/80 bg-white/85 p-7 backdrop-blur-md"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950">
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  <p className="font-display text-[11px] font-bold tracking-[0.18em] text-amber-900 [font-variant-numeric:tabular-nums]">
                    Next · 0{i + 1}
                  </p>
                </div>
                <h3 className="mt-4 font-display text-xl font-semibold leading-tight text-text">
                  {item.title}
                </h3>
                <p className="mt-3 text-[14px] leading-relaxed text-secondary">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* PRICING / MONEY */}
        <section className="mt-24 md:mt-32">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Money
          </p>
          <h2 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-4xl">
            Free now. <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>Probably</em> not forever.
          </h2>
          <div className="mt-8 max-w-prose space-y-5 text-base leading-relaxed text-secondary">
            <p>
              Right now After5 costs you nothing. No credit card, no upsell, no &quot;trial.&quot;
              I&apos;m focused on building something people actually want to use — pricing
              comes after that.
            </p>
            <p>
              Eventually I&apos;ll need to charge for something — probably a small subscription
              for unlimited plans + premium features (dating layer, custom themes, etc.). The
              free tier will always exist.
            </p>
            <p>
              <span className="text-text">The deal for early users:</span> if you sign up
              while we&apos;re under 100 Kelownans, you get every future feature on the
              house, forever. That&apos;s a promise — written here so you can hold me to it.
            </p>
          </div>
        </section>

        {/* PARTNERSHIPS */}
        <section className="mt-24 md:mt-32">
          <div className="rounded-[20px] border border-amber-100 bg-gradient-to-br from-amber-50/90 via-white/80 to-rose-50/70 p-8 backdrop-blur-md md:p-12">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-amber-900/80">
              For business owners
            </p>
            <h2 className="font-display text-2xl font-bold leading-tight text-text md:text-3xl">
              Want your spot in the catalog?
            </h2>
            <div className="mt-6 max-w-prose space-y-5 text-base leading-relaxed text-secondary">
              <p>
                A lot of people have suggested I chase restaurants, wineries, and cafes for
                paid placements. <span className="text-text">I&apos;m not doing that.</span>{' '}
                The whole point is that After5 only recommends spots a real Kelownan would
                actually go to — paid placements would break that.
              </p>
              <p>
                But if you run a place I&apos;d love and we just haven&apos;t added it yet —
                or if you want to be sure we have your hours and booking link right —
                email me. I&apos;ll add it (or fix it) myself, no money involved.
              </p>
            </div>
            <div className="mt-7">
              <a
                href="mailto:lucas@lucassenechal.com?subject=After5%20%E2%80%94%20our%20spot"
                className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-3 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
              >
                Email me about your spot
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
              </a>
            </div>
          </div>
        </section>

        {/* HELP WANTED */}
        <section className="mt-24 md:mt-32">
          <div className="rounded-[20px] border border-rose-100 bg-gradient-to-br from-rose-50/90 via-white/80 to-amber-50/70 p-8 backdrop-blur-md md:p-12">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-rose-900/80">
              Help wanted
            </p>
            <h2 className="font-display text-2xl font-bold leading-tight text-text md:text-3xl">
              Want to help build <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>this</em>?
            </h2>
            <div className="mt-6 max-w-prose space-y-5 text-base leading-relaxed text-secondary">
              <p>
                I&apos;m looking for a few Kelownans who care about this stuff. No formal role,
                no commitment — just people who want to make the catalog better. Specifically:
              </p>
              <ul className="ml-5 list-disc space-y-2 text-secondary marker:text-accent">
                <li>Verifying dates work in real life (you go on one, you tell me what was off)</li>
                <li>Spotting places we&apos;re missing — coffee shops, hikes, hidden patios</li>
                <li>Cute date ideas, conversation games, the kind of small ritual we ship as a &quot;twist&quot;</li>
                <li>Photo runs — better shots of places that currently have weak ones</li>
              </ul>
              <p>
                Open to a coffee. Email me if any of that sounds fun.
              </p>
            </div>
            <div className="mt-7">
              <a
                href="mailto:lucas@lucassenechal.com?subject=After5%20%E2%80%94%20want%20to%20help"
                className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-3 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
              >
                Email me
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
              </a>
            </div>
          </div>
        </section>

        {/* CONTACT */}
        <section className="mt-24 md:mt-32">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Final note
          </p>
          <h2 className="font-display text-2xl font-bold leading-tight text-text md:text-3xl">
            This is built by one person.
          </h2>
          <p className="mt-5 max-w-prose text-base leading-relaxed text-secondary">
            Things will break. Photos will be wrong. A plan will recommend a spot that closed last
            week. When that happens, tell me — I&apos;ll fix it the same day. Email{' '}
            <a
              href="mailto:lucas@lucassenechal.com"
              className="italic font-semibold text-accent underline decoration-accent/30 underline-offset-[6px] transition-colors hover:decoration-accent"
            >
              lucas@lucassenechal.com
            </a>{' '}
            with anything: a bug, a place we&apos;re missing, an idea, a feature you&apos;d
            pay for. The roadmap above is mostly your inbox in disguise.
          </p>
        </section>
      </div>
    </main>
  );
}

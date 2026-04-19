import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

// After5 marketing landing.
// Refined Minimal — see apps/web/.design/brief.md for the locked aesthetic
// contract. All colors and typography come from tailwind.config.ts tokens.

const SAMPLE_PLANS = [
  {
    title: 'The Westside Sunset Classic',
    vibe: ['romantic', 'boujee'],
    cost: '$140',
    time: '4 hr',
    stops: [
      { time: '5:30', name: 'Mission Hill' },
      { time: '7:00', name: "Quails' Gate" },
      { time: '9:00', name: 'Frind' },
    ],
    highlight: false,
  },
  {
    title: 'First Date Downtown',
    vibe: ['chill', 'intimate'],
    cost: '$85',
    time: '3 hr',
    stops: [
      { time: '6:30', name: "Skinny Duke's" },
      { time: '7:45', name: 'Salted Brick' },
      { time: '9:15', name: 'Sandrine' },
    ],
    highlight: true, // single accent appearance per viewport
  },
  {
    title: 'Adventure Date',
    vibe: ['adventurous', 'spontaneous'],
    cost: '$50',
    time: '3.5 hr',
    stops: [
      { time: '5:00', name: 'Knox Mountain' },
      { time: '6:45', name: 'BNA Brewing' },
      { time: '8:15', name: 'Parlour' },
    ],
    highlight: false,
  },
] as const;

const BENEFITS = [
  {
    n: '01',
    head: 'Real Kelowna spots',
    body: 'Not generic AI guesses. We curate every place by hand.',
  },
  {
    n: '02',
    head: 'Full timeline, not lists',
    body: "Drive flow, costs, and pacing — done. No 'here are 10 ideas.'",
  },
  {
    n: '03',
    head: 'Three options every time',
    body: 'Pick the night that fits the energy. Skip the others.',
  },
] as const;

export default function HomePage() {
  return (
    <>
      {/* ─── Nav ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-text"
          >
            After5
          </Link>
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85 md:px-7 md:py-3.5"
          >
            Plan my date — free
          </Link>
        </nav>
      </header>

      <main>
        {/* ─── Hero ────────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-content px-6 pb-24 pt-20 md:px-10 md:pb-40 md:pt-32">
            <div className="max-w-[860px]">
              <p className="mb-8 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                Kelowna · BC
              </p>
              <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl lg:text-6xl">
                Plan the perfect Kelowna date in 30 seconds.
              </h1>
              <p className="mt-8 max-w-[600px] text-lg text-secondary">
                Curated date itineraries built for your vibe, budget, and time —
                by people who actually live here.
              </p>
              <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4">
                <Link
                  href="/plan"
                  className="inline-flex items-center gap-2 rounded-pill bg-primary px-7 py-3.5 text-base font-medium text-background transition-opacity hover:opacity-85"
                >
                  Plan my date — free
                  <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
                </Link>
                <a
                  href="#sample-plans"
                  className="text-base text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
                >
                  See sample plans
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Sample plans ─────────────────────────────────────── */}
        <section
          id="sample-plans"
          className="border-b border-border bg-background"
        >
          <div className="mx-auto max-w-content px-6 py-20 md:px-10 md:py-28">
            <div className="mb-12 flex items-end justify-between md:mb-16">
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Three plans, every time
                </p>
                <h2 className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-text md:text-3xl">
                  Pick the night that fits.
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
              {SAMPLE_PLANS.map((p) => (
                <article
                  key={p.title}
                  className={[
                    'group flex flex-col rounded-card border bg-surface p-7 transition-colors md:p-8',
                    p.highlight
                      ? 'border-accent'
                      : 'border-border hover:border-text/30',
                  ].join(' ')}
                >
                  {/* Vibe pills */}
                  <div className="mb-6 flex flex-wrap gap-2">
                    {p.vibe.map((v) => (
                      <span
                        key={v}
                        className="rounded-pill border border-border px-3 py-1 text-xs text-secondary"
                      >
                        {v}
                      </span>
                    ))}
                  </div>

                  {/* Title */}
                  <h3 className="font-display text-2xl font-semibold leading-tight text-text">
                    {p.title}
                  </h3>

                  {/* Cost · time */}
                  <p className="mt-4 text-sm text-muted [font-variant-numeric:tabular-nums]">
                    <span className={p.highlight ? 'text-accent font-medium' : 'text-text font-medium'}>
                      {p.cost}
                    </span>
                    <span className="mx-1.5 text-border">·</span>
                    {p.time}
                  </p>

                  {/* Stops */}
                  <ul className="mt-6 space-y-2.5 border-t border-border pt-6">
                    {p.stops.map((s) => (
                      <li
                        key={s.name}
                        className="flex items-baseline gap-4 text-sm"
                      >
                        <span className="w-12 shrink-0 text-muted [font-variant-numeric:tabular-nums]">
                          {s.time}
                        </span>
                        <span className="text-text">{s.name}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Footer link */}
                  <div className="mt-8 border-t border-border pt-5">
                    <span
                      className={[
                        'inline-flex items-center gap-1.5 text-xs font-medium transition-opacity',
                        p.highlight
                          ? 'text-accent'
                          : 'text-secondary group-hover:text-text',
                      ].join(' ')}
                    >
                      See full plan
                      <ArrowRight className="h-3 w-3" strokeWidth={2.25} />
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Benefits ─────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-content px-6 py-24 md:px-10 md:py-32">
            <div className="grid grid-cols-1 gap-x-10 gap-y-14 md:grid-cols-3">
              {BENEFITS.map((b) => (
                <div key={b.n}>
                  <p className="font-display text-4xl font-bold leading-none text-text [font-variant-numeric:tabular-nums]">
                    {b.n}
                  </p>
                  <h3 className="mt-7 text-lg font-semibold text-text">
                    {b.head}
                  </h3>
                  <p className="mt-3 max-w-[34ch] text-base text-secondary">
                    {b.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── CTA band ─────────────────────────────────────────── */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-content px-6 py-28 md:px-10 md:py-36">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-4xl">
                Want one for tonight?
              </h2>
              <div className="mt-10 flex justify-center">
                <Link
                  href="/plan"
                  className="inline-flex items-center gap-2 rounded-pill bg-primary px-8 py-4 text-base font-medium text-background transition-opacity hover:opacity-85"
                >
                  Plan my date — free
                  <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Footer ───────────────────────────────────────────── */}
        <footer>
          <div className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-16">
            <p className="text-center text-xs text-muted">
              Built in Kelowna. Coming to Kamloops, Vernon, Penticton.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}

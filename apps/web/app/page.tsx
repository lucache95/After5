import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { ExploreDatesStrip } from '@/components/ExploreDatesStrip';
import { getSeason, SEASON_LABELS } from '@/lib/season';
import { PLAN_THEMES } from '@/lib/themes';
import { RecentBuildsToast } from '@/components/RecentBuildsToast';
import { UserMenu } from '@/components/UserMenu';
import { Polaroid } from '@/components/Polaroid';
import { HonestTestimonials } from '@/components/HonestTestimonials';
import { WowFactorStrip } from '@/components/WowFactorStrip';

// After5 marketing landing.
// Refined Minimal + editorial photography — the vibe gallery does the visual heavy
// lifting while type and spacing stay restrained. See apps/web/.design/brief.md.

const VIBES = [
  { id: 'romantic',     label: 'Romantic',    sub: 'Sunset, wine, slow dinner.',          img: '/vibes/vibe-romantic.jpg'    },
  { id: 'adventurous',  label: 'Adventurous', sub: 'Earn the view. Then the beer.',       img: '/vibes/vibe-adventurous.jpg' },
  { id: 'free',         label: 'Free',        sub: '$0 plans that feel like $100.',       img: '/vibes/vibe-free.jpg',        highlight: true },
  { id: 'chill',        label: 'Chill',       sub: 'Low effort. High signal.',             img: '/vibes/vibe-chill.jpg'       },
  { id: 'boujee',       label: 'Boujee',      sub: 'Worth the organizing.',                img: '/vibes/vibe-boujee.jpg'      },
  { id: 'cozy',         label: 'Cozy',        sub: 'Rain, candlelight, the good bistro.',  img: '/vibes/vibe-cozy.jpg'        },
] as const;

const SAMPLE_PLANS = [
  {
    title: 'The Westside Sunset Classic',
    vibe: ['romantic', 'boujee'],
    cost: '$140',
    time: '4 hr',
    img: '/sample/westside-sunset.jpg',
    imgAlt: 'Sunset over Westside vineyard with picnic table and Okanagan Lake',
    stops: [
      { time: '5:30', name: 'Mission Hill' },
      { time: '7:00', name: "Quails' Gate" },
      { time: '9:00', name: 'Frind' },
    ],
  },
  {
    title: 'First Date Downtown',
    vibe: ['chill', 'intimate'],
    cost: '$85',
    time: '3 hr',
    img: '/sample/first-date-downtown.jpg',
    imgAlt: 'Candlelit downtown bistro table with two glasses of wine',
    stops: [
      { time: '6:30', name: "Skinny Duke's" },
      { time: '7:45', name: 'Salted Brick' },
      { time: '9:15', name: 'Sandrine' },
    ],
  },
  {
    title: 'Adventure Date',
    vibe: ['adventurous', 'spontaneous'],
    cost: '$50',
    time: '3.5 hr',
    img: '/sample/adventure-date.jpg',
    imgAlt: 'Hiking boots and water bottle on Knox Mountain overlooking Kelowna',
    stops: [
      { time: '5:00', name: 'Knox Mountain' },
      { time: '6:45', name: 'BNA Brewing' },
      { time: '8:15', name: 'Parlour' },
    ],
  },
] as const;

const BENEFITS = [
  { n: '01', head: 'Real Kelowna spots',        body: 'Not generic AI guesses. We curate every place by hand.' },
  { n: '02', head: 'Full timeline, not lists',  body: "Drive flow, costs, and pacing — done. No 'here are 10 ideas.'" },
  { n: '03', head: 'Three options every time',  body: 'Pick the night that fits the energy. Skip the others.' },
] as const;

export default async function HomePage() {
  const currentSeason = getSeason();
  return (
    <>
      {/* ─── Nav ── overlays the hero image, no chrome bar ─────
           Top-down scrim sits behind the nav so the logo + button are
           always legible regardless of how bright the hero photo is. */}
      <header className="absolute inset-x-0 top-0 z-50">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-black/85 via-black/45 to-transparent md:h-56"
        />
        <nav className="relative mx-auto flex max-w-content items-center justify-between px-6 py-6 md:px-10 md:py-7">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6),0_2px_16px_rgba(0,0,0,0.55)]"
          >
            After5
          </Link>
          <div className="flex items-center gap-5">
            <div className="hidden sm:block">
              <UserMenu variant="on-dark" />
            </div>
            <Link
              href="/plan"
              className="inline-flex items-center gap-2 rounded-pill bg-white px-5 py-2.5 text-sm font-medium text-text shadow-[0_4px_16px_rgba(0,0,0,0.18)] transition-transform hover:-translate-y-0.5 md:px-6 md:py-3"
            >
              Plan my date — free
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* ─── Image-led hero (text overlay, editorial cover style) ─── */}
        <section className="relative isolate flex min-h-[88vh] w-full items-end overflow-hidden bg-surface md:min-h-[92vh]">
          <Image
            src="/vibes/vibe-hero.jpg"
            alt="Okanagan Lake at sunset"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          {/* Readability scrim — strong at bottom-left where the type sits, fading up */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-black/30 via-transparent to-transparent"
          />

          <div className="relative mx-auto w-full max-w-content px-6 pb-16 pt-32 md:px-10 md:pb-24 md:pt-40">
            <div className="max-w-[860px]">
              <div className="mb-7 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-500/95 px-3 py-1 text-[11px] font-semibold tracking-wide text-white shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
                  {SEASON_LABELS[currentSeason].name}
                </span>
                <span className="text-xs font-medium uppercase tracking-[0.22em] text-white/80">
                  Kelowna · BC
                </span>
              </div>
              <h1 className="font-display text-4xl font-bold leading-[1.02] tracking-[-0.025em] text-white md:text-6xl lg:text-[78px]">
                Plan the{' '}
                <span className="italic font-semibold text-amber-200/95">perfect</span>
                {' '}Kelowna date in 30 seconds.
              </h1>
              <p className="mt-7 max-w-[560px] text-lg text-white/85 md:text-xl">
                Curated itineraries built for your vibe, budget, and time —
                by people who actually live here.
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4">
                <Link
                  href="/plan"
                  className="inline-flex items-center gap-2 rounded-pill bg-white px-7 py-3.5 text-base font-medium text-text transition-transform hover:-translate-y-0.5"
                >
                  Plan my date — free
                  <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
                </Link>
                <a
                  href="#vibes"
                  className="text-base text-white/90 underline decoration-white/40 decoration-1 underline-offset-[6px] transition-colors hover:text-white hover:decoration-white"
                >
                  Browse by vibe
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Quick-start themes ────────────────────────────── */}
        <section id="themes" className="border-t border-border">
          <div className="mx-auto max-w-content px-6 py-20 md:px-10 md:py-24">
            <div className="mb-10 max-w-2xl">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                Quick start
              </p>
              <h2 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
                Or pick a theme.{' '}
                <span className="italic font-semibold text-accent">We&apos;ll handle the rest.</span>
              </h2>
              <p className="mt-3 text-base text-secondary md:text-lg">
                Each one bundles vibe, length, budget and energy. One click — confirm the must-haves and you're done.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {PLAN_THEMES.map((t) => (
                <Link
                  key={t.id}
                  href={`/plan?theme=${t.id}`}
                  className="group flex flex-col gap-2 rounded-card border border-border bg-surface px-5 py-5 transition-colors hover:border-text/40"
                >
                  <span className="font-display text-lg font-semibold leading-tight text-text">
                    {t.label}
                  </span>
                  <span className="text-sm leading-snug text-secondary">{t.desc}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Vibe gallery (Pinterest-style) ────────────────── */}
        <section id="vibes" className="border-t border-border">
          <div className="mx-auto max-w-content px-6 py-20 md:px-10 md:py-28">
            <div className="mb-12 flex items-end justify-between md:mb-16">
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Start with a feeling
                </p>
                <h2 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
                  Pick the vibe.{' '}
                  <span className="italic font-semibold text-accent">We pick the night.</span>
                </h2>
              </div>
              <Link
                href="/plan"
                className="hidden text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text md:inline"
              >
                Or answer 5 questions
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5">
              {VIBES.map((v) => (
                <Link
                  key={v.id}
                  href={{ pathname: '/plan', query: { vibe: v.id } }}
                  className="group block"
                >
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-card bg-surface">
                    <Image
                      src={v.img}
                      alt={`${v.label} date plans in Kelowna`}
                      fill
                      sizes="(max-width: 768px) 50vw, 33vw"
                      className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.02]"
                    />
                  </div>
                  <div className="mt-4 flex items-baseline justify-between">
                    <div>
                      <p className="font-display text-xl font-semibold text-text md:text-2xl">
                        {v.label}
                      </p>
                      <p className="mt-1 text-sm text-secondary">{v.sub}</p>
                    </div>
                    {'highlight' in v && v.highlight && (
                      <span className="hidden rounded-pill bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent md:inline-block">
                        New
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Sample plans ───────────────────────────────────── */}
        <section className="border-t border-border bg-background">
          <div className="mx-auto max-w-content px-6 py-20 md:px-10 md:py-28">
            <div className="mb-12 md:mb-16">
              <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                Three plans, every time
              </p>
              <h2 className="font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-text md:text-3xl">
                A{' '}
                <span className="italic font-semibold text-accent">locals-only</span>
                {' '}sample of what you&apos;d get.
              </h2>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-7">
              {SAMPLE_PLANS.map((p, i) => {
                const highlight = i === 1;
                return (
                  <article
                    key={p.title}
                    className="group flex flex-col"
                  >
                    {/* Image hero — does the emotional lifting */}
                    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-card bg-surface">
                      <Image
                        src={p.img}
                        alt={p.imgAlt}
                        fill
                        sizes="(max-width: 768px) 100vw, 33vw"
                        className="object-cover transition-transform duration-[800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.03]"
                      />
                      {/* Stronger scrim so white text is guaranteed legible
                          regardless of how bright the underlying photo is. */}
                      <div
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/90 via-black/60 to-transparent"
                      />
                      <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
                        {p.vibe.map((v) => (
                          <span
                            key={v}
                            className="rounded-pill bg-white/95 px-2.5 py-1 text-[11px] font-medium tracking-wide text-text backdrop-blur-sm"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                      <div className="absolute bottom-4 left-4 right-4 flex items-baseline justify-between text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.6)] [font-variant-numeric:tabular-nums]">
                        <span className="text-sm font-medium">{p.cost}</span>
                        <span className="text-xs text-white/95">{p.time}</span>
                      </div>
                    </div>

                    {/* Title + timeline below the image */}
                    <div className="mt-5">
                      <h3 className="font-display text-xl font-semibold leading-tight text-text md:text-2xl">
                        {p.title}
                      </h3>
                      <ul className="mt-4 space-y-2 text-sm">
                        {p.stops.map((s) => (
                          <li key={s.name} className="flex items-baseline gap-4">
                            <span className="w-12 shrink-0 text-muted [font-variant-numeric:tabular-nums]">
                              {s.time}
                            </span>
                            <span className="text-secondary">{s.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── Explore real dates (server-fetched from /dates catalog) ─ */}
        <ExploreDatesStrip />

        {/* ─── Wow factor — every plan gets a "twist" modifier baked in ── */}
        <WowFactorStrip />

        {/* ─── Benefits ─────────────────────────────────────────── */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-content px-6 py-24 md:px-10 md:py-32">
            <div className="grid grid-cols-1 gap-x-10 gap-y-14 md:grid-cols-3">
              {BENEFITS.map((b) => (
                <div key={b.n}>
                  <p className="font-display text-4xl font-bold leading-none text-text [font-variant-numeric:tabular-nums]">
                    {b.n}
                  </p>
                  <h3 className="mt-7 text-lg font-semibold text-text">{b.head}</h3>
                  <p className="mt-3 max-w-[34ch] text-base text-secondary">{b.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Honest testimonials (placeholders until real ones land) ─ */}
        <HonestTestimonials />

        {/* ─── CTA band ─────────────────────────────────────────── */}
        <section className="relative border-t border-border overflow-hidden">
          {/* Ambient warm gradient — matches /login + /account so the brand
              language feels continuous from homepage to auth to dashboard. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute -left-32 top-12 h-[420px] w-[420px] rounded-full bg-gradient-to-br from-amber-200/40 via-orange-200/20 to-transparent blur-3xl" />
            <div className="absolute -right-32 bottom-0 h-[420px] w-[420px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
          </div>

          <div className="relative mx-auto max-w-content px-6 py-28 md:px-10 md:py-36">
            <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-[1.4fr_1fr] md:gap-16">
              <div>
                <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                  One last thing
                </p>
                <h2 className="font-display text-4xl font-bold leading-[1.02] tracking-[-0.025em] text-text md:text-[56px]">
                  Want one for{' '}
                  <span className="italic font-semibold text-accent">tonight?</span>
                </h2>
                <p className="mt-5 max-w-prose text-base leading-relaxed text-secondary md:text-lg">
                  30 seconds, three plans, free. No card, no sign-up to view.
                </p>
                <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
                  <Link
                    href="/plan"
                    className="inline-flex items-center gap-2 rounded-pill bg-text px-7 py-3.5 text-base font-medium text-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]"
                  >
                    Plan my date — free
                    <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
                  </Link>
                  <Link
                    href="/about"
                    className="text-sm font-medium text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
                  >
                    Why we built this
                  </Link>
                </div>
              </div>

              {/* Stacked polaroid accent — same family as the dashboard hero. */}
              <div className="relative hidden min-h-[300px] md:block">
                <div className="absolute right-16 top-0">
                  <Polaroid
                    src="/pins/couple-trail.jpg"
                    alt="Okanagan trail"
                    label="WEST KELOWNA · 26"
                    size="lg"
                    rotation={-7}
                  />
                </div>
                <div className="absolute right-0 top-40">
                  <Polaroid
                    src="/pins/couple-lake-kiss.jpg"
                    alt="Lake Okanagan"
                    label="LAKESIDE"
                    size="md"
                    rotation={9}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── Footer ───────────────────────────────────────────── */}
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-content flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between md:px-10 md:py-16">
            <p className="text-xs text-muted">
              Built in Kelowna by{' '}
              <a
                href="https://lucassenechal.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-border decoration-1 underline-offset-[4px] transition-colors hover:text-text hover:decoration-text"
              >
                Lucas Senechal
              </a>
              . Coming to Kamloops, Vernon, Penticton.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
              <Link href="/about" className="transition-colors hover:text-text">
                About
              </Link>
              <Link href="/roadmap" className="transition-colors hover:text-text">
                Roadmap
              </Link>
              <Link href="/tell-us" className="transition-colors hover:text-text">
                Bug or idea?
              </Link>
              <Link href="/privacy" className="transition-colors hover:text-text">
                Privacy
              </Link>
              <Link href="/terms" className="transition-colors hover:text-text">
                Terms
              </Link>
              <a
                href="mailto:lucas@lucassenechal.com"
                className="transition-colors hover:text-text"
              >
                lucas@lucassenechal.com
              </a>
            </div>
          </div>
        </footer>
      </main>

      <RecentBuildsToast />
    </>
  );
}

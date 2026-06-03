// Self-aware "fake testimonials" section — leans into the brand's honest
// voice. Until we have real reviews to show, we make the absence funny
// instead of pretending. Once real plan_feedback rolls in we can swap
// these out for the highest-rated real ones.
//
// Visual treatment: each card looks like a torn page from a journal —
// warm cream paper, faint ruled lines, slight tilt, a strip of washi tape
// at the top, italic quote + handwritten-feel signature, "Entry No." in
// the corner. Reinforces the analog-personal voice the polaroids set up.

import Link from 'next/link';

interface Testimonial {
  name: string;
  role: string;
  quote: string;
  /** Tilt of the page in degrees. -3 to +3. */
  tilt: number;
  /** Color of the washi-tape strip at the top. */
  tapeColor: string;
}

const FAKE_TESTIMONIALS: Testimonial[] = [
  {
    name: 'Your Name Here',
    role: 'Future After5 user',
    quote: 'This is a placeholder testimonial. We\'re hoping yours goes here once you fall in love with a plan we made for you.',
    tilt: -2,
    tapeColor: 'bg-amber-200/70',
  },
  {
    name: 'Definitely Real Couple',
    role: 'Lower Mission · soon',
    quote: 'Best date in years. Honestly. (We\'ll wait — go try it and then come back with a real one.)',
    tilt: 1.5,
    tapeColor: 'bg-rose-200/70',
  },
  {
    name: 'Maya & Sam',
    role: 'Glenmore · TBD',
    quote: 'Saved our anniversary. Or it will, when one of you logs in and gives After5 a real shot. Until then, this quote is on us.',
    tilt: -1,
    tapeColor: 'bg-emerald-200/70',
  },
  {
    name: 'Kelowna\'s Most Honest Critic',
    role: 'Pandosy · in time',
    quote: 'Look — we made this section before we had any reviews. The polite thing was to wait. But waiting felt dishonest, so here we are.',
    tilt: 2.5,
    tapeColor: 'bg-sky-200/70',
  },
];

// Torn-paper edges — irregular polygon clip on top + bottom. Hand-tuned so
// the tear feels organic (no obvious repeats) without too many points.
const TORN_CLIP_PATH = `polygon(
  0% 1.4%,
  4% 0.2%, 8% 1.2%, 13% 0.4%, 18% 1.5%, 24% 0%, 30% 0.8%, 36% 1.6%,
  43% 0.4%, 50% 1.2%, 57% 0%, 63% 1.4%, 70% 0.6%, 77% 1.7%, 84% 0.4%, 91% 1.1%, 96% 0%,
  100% 1.3%,
  100% 98.7%,
  96% 100%, 91% 98.9%, 84% 99.6%, 77% 100%, 70% 98.4%, 63% 99.5%, 57% 98.7%, 50% 100%,
  43% 99%, 36% 99.6%, 30% 99.2%, 24% 98.5%, 18% 100%, 13% 98.9%, 8% 99.6%, 4% 98.9%,
  0% 98.6%
)`.replace(/\s+/g, ' ');

export function HonestTestimonials() {
  return (
    <section className="relative border-t border-border overflow-hidden">
      {/* Subtle ambient warmth — different position from the CTA above so
          the page has a gentle rhythm of warm pools as you scroll. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-32 top-12 h-[400px] w-[400px] rounded-full bg-gradient-to-bl from-rose-200/35 via-amber-100/20 to-transparent blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-content px-6 py-20 md:px-10 md:py-28">
        <div className="mb-12 max-w-2xl md:mb-16">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
            Honest reviews from imaginary couples
          </p>
          <h2 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
            Real testimonials,{' '}
            <span className="italic font-semibold text-accent">eventually.</span>
          </h2>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-secondary md:text-lg">
            We&apos;re too new to have real ones yet. So instead of borrowing
            stock-photo quotes, here&apos;s a placeholder version. The first
            100 Kelownans get to write the real ones — and we&apos;ll show
            them right here.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-16 lg:gap-20">
          {FAKE_TESTIMONIALS.map((t, i) => (
            <article
              key={t.name}
              className="group relative"
              // drop-shadow respects clip-path; box-shadow would be cut off.
              style={{
                transform: `rotate(${t.tilt}deg)`,
                filter: 'drop-shadow(0 18px 36px rgba(80,40,20,0.18)) drop-shadow(0 2px 4px rgba(80,40,20,0.06))',
              }}
            >
              {/* Washi-tape strip at the top — anchors the page to the
                  background like it's been pinned to a corkboard. */}
              <span
                aria-hidden
                className={`pointer-events-none absolute -top-2 left-1/2 z-10 h-6 w-24 -translate-x-1/2 -rotate-[2deg] ${t.tapeColor} opacity-90 shadow-[0_2px_4px_rgba(0,0,0,0.08)]`}
                style={{
                  // Soft tape edges
                  borderRadius: '1px',
                  backgroundImage:
                    'linear-gradient(90deg, transparent 0, rgba(255,255,255,0.25) 50%, transparent 100%)',
                }}
              />

              {/* The "page" — torn top + bottom edges, faint ruled lines,
                  warm cream paper. */}
              <div
                className="relative overflow-hidden bg-[#FBF6E5] px-8 py-10 md:px-11 md:py-12"
                style={{ clipPath: TORN_CLIP_PATH }}
              >
                {/* Faint horizontal ruled lines — subtle, like a Moleskine. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 inset-y-0 opacity-[0.08]"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(0deg, transparent 0, transparent 31px, #5b4233 31px, #5b4233 32px)',
                  }}
                />

                {/* Left margin line — like a school exercise book. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute bottom-6 left-6 top-6 w-px bg-rose-400/30 md:left-8"
                />

                {/* The quote — italic display for the diary feel. */}
                <p className="relative font-display italic text-[17px] leading-[1.55] text-text md:text-[19px] md:leading-[1.5]">
                  &ldquo;{t.quote}&rdquo;
                </p>

                {/* Signature block — em-dash + name in italic, role beneath. */}
                <div className="relative mt-6 border-t border-amber-900/15 pt-4">
                  <p className="font-display text-base italic text-text">
                    — {t.name}
                  </p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.14em] text-muted">
                    {t.role}
                  </p>
                </div>

                {/* Page number / date stamp — bottom-right corner. */}
                <p className="absolute bottom-3 right-5 font-display text-[10px] uppercase tracking-[0.18em] text-muted/70 [font-variant-numeric:tabular-nums] md:bottom-4">
                  Entry no. {String(i + 1).padStart(2, '0')}
                </p>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <p className="text-sm leading-relaxed text-secondary md:max-w-md">
            Want to write a real one? You&apos;d need to actually try a plan first.
          </p>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-3 text-sm font-medium text-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]"
          >
            Build one tonight →
          </Link>
        </div>
      </div>
    </section>
  );
}

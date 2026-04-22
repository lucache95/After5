// Self-aware "fake testimonials" section — leans into the brand's honest
// voice. Until we have real reviews to show, we make the absence funny
// instead of pretending. Once real plan_feedback rolls in we can swap
// these out for the highest-rated real ones.

import Link from 'next/link';
import { Avatar } from '@/components/Avatar';

interface Testimonial {
  name: string;
  role: string;
  quote: string;
  /** Tilt of the polaroid-style card. -3 to +3. */
  tilt: number;
}

const FAKE_TESTIMONIALS: Testimonial[] = [
  {
    name: 'Your Name Here',
    role: 'Future After5 user',
    quote: 'This is a placeholder testimonial. We\'re hoping yours goes here once you fall in love with a plan we made for you.',
    tilt: -2,
  },
  {
    name: 'Definitely Real Couple',
    role: 'Lower Mission · soon',
    quote: 'Best date in years. Honestly. (We\'ll wait — go try it and then come back with a real one.)',
    tilt: 1.5,
  },
  {
    name: 'Maya & Sam',
    role: 'Glenmore · TBD',
    quote: 'Saved our anniversary. Or it will, when one of you logs in and gives After5 a real shot. Until then, this quote is on us.',
    tilt: -1,
  },
  {
    name: 'Kelowna\'s Most Honest Critic',
    role: 'Pandosy · in time',
    quote: 'Look — we made this section before we had any reviews. The polite thing was to wait. But waiting felt dishonest, so here we are.',
    tilt: 2.5,
  },
];

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

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:gap-8">
          {FAKE_TESTIMONIALS.map((t) => (
            <article
              key={t.name}
              style={{ transform: `rotate(${t.tilt}deg)` }}
              className="group relative rounded-[16px] border border-border bg-white/85 p-7 backdrop-blur-md transition-all duration-500 hover:rotate-0 hover:shadow-[0_18px_42px_-16px_rgba(80,40,20,0.22)] md:p-9"
            >
              {/* Decorative quote glyph — tucked into the upper-left corner. */}
              <span
                aria-hidden
                className="absolute left-5 top-3 font-display text-[88px] leading-none text-accent/15 select-none"
              >
                &ldquo;
              </span>

              <p className="relative font-display text-lg leading-snug text-text md:text-xl">
                {t.quote}
              </p>

              <div className="mt-6 flex items-center gap-3 border-t border-border/70 pt-5">
                <Avatar name={t.name} size="md" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text">{t.name}</p>
                  <p className="text-[12px] text-muted">{t.role}</p>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-14 flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
          <p className="text-sm leading-relaxed text-secondary md:max-w-md">
            Want to write a real one? You&apos;d need to actually try a plan first.
          </p>
          <Link
            href="/plan"
            className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-3 text-sm font-medium text-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]"
          >
            Build one tonight →
          </Link>
        </div>
      </div>
    </section>
  );
}

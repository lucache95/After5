// "More plans like this" carousel — sits below the timeline on plan detail.
// Horizontally scrolls on mobile, fits 3-up on desktop. Each card mirrors the
// /plan results chooser-card vibe but trimmed: cover image, title, hook,
// cost · duration · stops.

import Image from 'next/image';
import Link from 'next/link';
import { imageForStop } from '@/lib/place-image';
import type { SimilarPlanCard } from '@/lib/itinerary-similar';

export function SimilarPlans({ plans }: { plans: SimilarPlanCard[] }) {
  if (plans.length === 0) return null;

  return (
    <section id="more" className="scroll-mt-24">
      <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        More plans like this
      </p>
      <h2 className="font-display text-2xl font-bold tracking-[-0.01em] text-text md:text-3xl">
        Same vibe, <em className="font-display font-semibold not-italic text-accent" style={{ fontStyle: 'italic' }}>different night.</em>
      </h2>

      {/* Mobile: horizontal scroll snap. Desktop: 3-col grid. */}
      <div className="mt-6 -mx-6 flex snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-4 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
      </div>
    </section>
  );
}

function PlanCard({ plan }: { plan: SimilarPlanCard }) {
  const cover =
    plan.cover_photo ?? imageForStop({ place_type: plan.cover_type });
  const totalHr = Math.round((plan.total_duration_min / 60) * 10) / 10;

  return (
    <Link
      href={`/dates/${plan.slug}`}
      className="group block w-[78vw] shrink-0 snap-start overflow-hidden rounded-card border border-border bg-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.18)] sm:w-[60vw] md:w-auto"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface">
        <Image
          src={cover}
          alt={plan.title}
          fill
          sizes="(max-width: 768px) 78vw, 33vw"
          className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.04]"
        />
        {plan.loved_count > 0 && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-pill bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm backdrop-blur-sm [font-variant-numeric:tabular-nums]">
            ♥ {plan.loved_count}
          </span>
        )}
      </div>
      <div className="p-4 md:p-5">
        <h3 className="line-clamp-2 font-display text-lg font-bold leading-tight text-text">
          {plan.title}
        </h3>
        {plan.hook && (
          <p className="mt-1.5 line-clamp-2 text-sm leading-snug text-secondary">
            {plan.hook}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted [font-variant-numeric:tabular-nums]">
          <span className="font-medium text-text">${Math.round(plan.total_cost_pp)}</span>
          <span aria-hidden>·</span>
          <span>{totalHr} hr</span>
          <span aria-hidden>·</span>
          <span>{plan.stop_count} stops</span>
        </div>
      </div>
    </Link>
  );
}

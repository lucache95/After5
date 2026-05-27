// Read-only gallery of curated Kelowna nights (reuses existing itineraries content).
// The desire engine while the live match loop (S5/S6) is not built. Server component.
import Image from 'next/image';
import Link from 'next/link';
import type { TeaserCard } from '@/lib/onboarding/teaser';

export function TeaserGallery({ cards }: { cards: TeaserCard[] }) {
  if (cards.length === 0) {
    return (
      <section className="mt-14">
        <p className="text-sm text-secondary">We&apos;re curating Kelowna nights. Check back soon.</p>
      </section>
    );
  }
  return (
    <section className="mt-14">
      <p className="mb-5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">The kinds of nights you&apos;ll be matched around</p>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {cards.map((c) => (
          <Link key={c.id} href={c.href}
            className="group flex gap-5 rounded-card border border-border bg-white/70 p-3 transition-all hover:-translate-y-0.5 hover:shadow-subtle">
            <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[10px] bg-surface md:h-32 md:w-32">
              {c.cover && <Image src={c.cover} alt="" fill sizes="128px" className="object-cover transition-transform duration-500 group-hover:scale-105" />}
            </div>
            <div className="min-w-0 flex-1 py-1">
              <h3 className="line-clamp-2 font-display text-base font-semibold text-text">{c.title}</h3>
              {c.hook && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-secondary">{c.hook}</p>}
              {(c.costPp != null || c.durationMin != null) && (
                <p className="mt-3 text-[11px] text-muted [font-variant-numeric:tabular-nums]">
                  {c.costPp != null ? `$${Math.round(c.costPp)}` : ''}{c.costPp != null && c.durationMin != null ? ' · ' : ''}{c.durationMin != null ? `${Math.round((c.durationMin / 60) * 10) / 10} hr` : ''}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

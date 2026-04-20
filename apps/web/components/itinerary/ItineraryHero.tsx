import Image from 'next/image';
import { imageForStop } from '@/lib/place-image';
import type { Itinerary } from '@/lib/itinerary-types';

// Editorial hero band — uses the first stop's photo as the cover image
// (or its type fallback). Title + hook + 3 stat tiles overlaid.

export function ItineraryHero({ itinerary }: { itinerary: Itinerary }) {
  const cover = itinerary.stops[0]
    ? imageForStop({
        photo_url: itinerary.stops[0].photo_url,
        place_type: itinerary.stops[0].place_type,
      })
    : '/places/place-walk.jpg';

  const totalHr = Math.round((itinerary.total_duration_min / 60) * 10) / 10;

  return (
    <section className="relative isolate min-h-[70vh] w-full overflow-hidden bg-surface md:min-h-[78vh]">
      <Image
        src={cover}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20"
      />

      <div className="relative mx-auto flex h-full min-h-[70vh] w-full max-w-content flex-col justify-end px-6 pb-12 pt-32 md:min-h-[78vh] md:px-10 md:pb-16 md:pt-40">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.22em] text-white/85">
          {itinerary.template_name} · Kelowna
        </p>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-white md:text-5xl lg:text-6xl">
          {itinerary.title}
        </h1>
        {itinerary.hook && (
          <p className="mt-5 max-w-2xl text-lg text-white/90 md:text-xl">{itinerary.hook}</p>
        )}

        <dl className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-5 text-white">
          <Stat label="Total" value={`$${Math.round(itinerary.total_cost_pp)}`} sub="/ pp" />
          <Stat label="Duration" value={`${totalHr}`} sub="hr" />
          <Stat label="Stops" value={`${itinerary.stops.length}`} />
        </dl>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/70">
        {label}
      </dt>
      <dd className="mt-1.5 font-display text-3xl font-semibold leading-none text-white [font-variant-numeric:tabular-nums] md:text-4xl">
        {value}
        {sub && <span className="ml-1.5 text-base font-normal text-white/70">{sub}</span>}
      </dd>
    </div>
  );
}

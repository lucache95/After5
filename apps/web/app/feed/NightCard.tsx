import Image from 'next/image';
import type { FeedNight } from '@after5/api-client';

export function NightCard({ night }: { night: FeedNight }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-border bg-white shadow">
      {night.cover_image_url
        ? <Image src={night.cover_image_url} alt="" width={500} height={300} className="h-56 w-full object-cover" />
        : <div className="h-56 w-full bg-gradient-to-br from-amber-100 to-rose-100" />}
      <div className="p-5">
        <h2 className="font-display text-xl font-bold text-text">{night.title ?? 'A Kelowna night'}</h2>
        {night.why_note && <p className="mt-2 text-[14px] leading-relaxed text-secondary">{night.why_note}</p>}
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
          {night.venue_neighborhood && <span>{night.venue_neighborhood}</span>}
          <span>{new Date(night.time_window_start).toLocaleString([], { weekday: 'short', hour: 'numeric' })}</span>
          {night.is_seed && <span className="rounded bg-amber-100 px-1.5 text-amber-900">curated</span>}
        </div>
      </div>
    </div>
  );
}

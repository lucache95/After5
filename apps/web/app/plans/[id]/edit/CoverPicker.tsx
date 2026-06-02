'use client';
// M3 cover picker. A grid of the itinerary's stop photos; tapping one promotes
// it to the cover. No upload bucket — the cover is always one of the existing
// stop photos. Tier-1 shell chrome, lowercase.
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export function CoverPicker({
  photos,
  current,
  onPick,
}: {
  photos: string[];
  current?: string | null;
  onPick: (url: string) => void;
}) {
  if (photos.length === 0) {
    return (
      <p className="font-body text-sm text-shell-ink/55">
        no stop photos to pick from yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {photos.map((photo, i) => {
        const selected = photo === current;
        return (
          <button
            key={`${photo}-${i}`}
            type="button"
            onClick={() => onPick(photo)}
            aria-label="use this cover"
            aria-pressed={selected}
            className={cn(
              'relative aspect-square overflow-hidden rounded-2xl border-2 transition',
              selected ? 'border-shell-accent' : 'border-transparent hover:border-shell-accent/40',
            )}
          >
            {/* Plain img: thumbnails are arbitrary remote stop URLs (Places /
                Supabase storage) not covered by next/image remotePatterns. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="" className="h-full w-full object-cover" />
            {selected && (
              <span className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-shell-accent text-white">
                <Check className="h-3.5 w-3.5" aria-hidden />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

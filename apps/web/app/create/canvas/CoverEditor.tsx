'use client';
import { useState } from 'react';
import Image from 'next/image';
import { toast } from 'sonner';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';
import { Sheet } from './Sheet';

// generate-cover response shape: { processed: number; results: Array<{ id: string; cover?: string } | { id: string; error: string }> }
type CoverResult = { id: string; cover?: string; error?: string };
type GenerateCoverResponse = { processed: number; results: CoverResult[] };

export function CoverEditor({
  itineraryId,
  stops,
  current,
  onApply,
  onClose,
}: {
  itineraryId: string;
  stops: Stop[];
  current: string | null;
  onApply: (url: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const photos = stops.map((s) => s.photo_url).filter((u): u is string => !!u);

  async function freshCover() {
    setBusy(true);
    try {
      const { data, error } = await browserAfter5Client().functions.invoke<GenerateCoverResponse>(
        'generate-cover',
        { body: { itinerary_id: itineraryId } },
      );
      const cover = data?.results?.[0]?.cover;
      if (error || !cover) {
        toast.error('that one slipped away. try again?');
        return;
      }
      onApply(cover);
      toast.success('fresh cover.');
    } finally {
      setBusy(false);
    }
  }

  const btn =
    'min-h-[44px] rounded-pill px-4 font-body text-sm lowercase ring-1 ring-shell-ink/15 bg-white/80 text-shell-ink active:scale-95 disabled:opacity-40';

  return (
    <Sheet title="the cover" onClose={onClose}>
      <button className={btn} disabled={busy} onClick={freshCover}>
        fresh cover
      </button>
      {photos.length > 0 && (
        <>
          <p className="mt-4 font-body text-xs lowercase text-shell-ink/55">or use a venue photo</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((url, i) => (
              <button
                key={i}
                aria-label={`use ${url}`}
                onClick={() => {
                  onApply(url);
                  toast.success('cover set.');
                }}
                className="relative aspect-square overflow-hidden rounded-2xl ring-1 ring-shell-ink/10"
              >
                <Image src={url} alt="" fill sizes="120px" className="object-cover" />
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

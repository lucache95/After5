'use client';
import Image from 'next/image';
import { toast } from 'sonner';
import type { Stop } from '@/lib/itinerary-types';
import { Sheet } from './Sheet';

// The date already ships with an AI-generated cover from generation time. This
// sheet lets the user make it theirs by choosing one of the venue photos as the
// cover. In-editor AI "fresh cover" is deferred to v1.1 — generate-cover is
// service-role/admin-only (it spends on Replicate) and would need an authed,
// rate-limited server route to be safe to expose to users.
export function CoverEditor({
  stops,
  onApply,
  onClose,
}: {
  stops: Stop[];
  onApply: (url: string) => void;
  onClose: () => void;
}) {
  const photos = stops.map((s) => s.photo_url).filter((u): u is string => !!u);

  return (
    <Sheet title="the cover" onClose={onClose}>
      {photos.length > 0 ? (
        <>
          <p className="font-body text-xs lowercase text-shell-ink/55">use a venue photo</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((url, i) => (
              <button
                key={i}
                aria-label={`use ${url}`}
                onClick={() => {
                  onApply(url);
                  toast.success('cover set.');
                }}
                className="relative aspect-square overflow-hidden rounded-2xl ring-1 ring-shell-ink/10 active:scale-95"
              >
                <Image src={url} alt="" fill sizes="120px" className="object-cover" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="font-body text-sm lowercase text-shell-ink/55">
          no venue photos to choose from on this night yet.
        </p>
      )}
    </Sheet>
  );
}

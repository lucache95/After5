'use client';
// E11 (REQ-E11 / D-01): storage-backed cover uploader for the Door-2 canvas.
// Reuses the photos.ts storage shape — RLS-scoped `<uid>/<id>.jpg` upload to the
// owner-folder-scoped `profile-photos` bucket (no new bucket/migration this wave;
// D-01 grants bucket discretion) — then persists the public URL onto the itinerary
// via update_itinerary_stops(p_cover_image_url). The old CoverPicker only re-picks
// an existing stop photo; this lets the host upload a real cover that sells the night.
import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { updateItineraryStops } from '@after5/api-client';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';
import { cn } from '@/lib/cn';

const BUCKET = 'profile-photos';

type Phase = 'idle' | 'uploading' | 'error';

export function CoverUploader({
  itineraryId,
  current,
  stops,
}: {
  itineraryId: string;
  current: string | null;
  stops: Stop[];
}) {
  const [cover, setCover] = useState<string | null>(current);
  const [phase, setPhase] = useState<Phase>('idle');
  const inputRef = useRef<HTMLInputElement | null>(null);

  function pick() {
    inputRef.current?.click();
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setPhase('uploading');
    try {
      const client = browserAfter5Client();
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error('not signed in');
      const id = crypto.randomUUID();
      const path = `${user.id}/${id}.jpg`;
      const { error: upErr } = await client.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = client.storage.from(BUCKET).getPublicUrl(path);
      const url = pub.publicUrl;
      await updateItineraryStops(client, {
        itinerary_id: itineraryId,
        stops: stops as never,
        cover_image_url: url,
      });
      setCover(url);
      setPhase('idle');
      toast.success('cover set.');
    } catch (err) {
      console.error('[CoverUploader] upload failed', err);
      setPhase('error');
      toast.error("couldn't upload that. try a different photo?");
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label="upload a cover"
        onChange={onFile}
        className="sr-only"
      />

      {cover ? (
        <button
          type="button"
          onClick={pick}
          aria-label="change the cover"
          className={cn(
            'relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border-2 border-shell-accent transition',
            'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" className="h-full w-full object-cover" />
          <span className="absolute inset-x-0 bottom-0 bg-shell-ink/45 px-3 py-1.5 text-center font-body text-[12px] lowercase text-white backdrop-blur-sm">
            {phase === 'uploading' ? 'uploading…' : 'tap to change'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={pick}
          disabled={phase === 'uploading'}
          aria-busy={phase === 'uploading'}
          className={cn(
            'flex min-h-[44px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-shell-ink/20 bg-white/60 px-4 py-8 text-center transition',
            'hover:border-shell-accent/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
            'disabled:opacity-60',
          )}
        >
          <ImagePlus className="h-6 w-6 text-shell-accent" aria-hidden />
          <span className="font-body text-sm lowercase text-shell-ink/65">
            {phase === 'uploading' ? 'uploading…' : 'no cover yet. add a photo that sells the night.'}
          </span>
        </button>
      )}

      {phase === 'error' && (
        <p role="alert" className="mt-2 font-body text-[13px] lowercase text-shell-accent">
          couldn&apos;t upload that. try a different photo?
        </p>
      )}
    </div>
  );
}

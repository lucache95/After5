'use client';
// Per-stop photo affordance. Mirrors the CoverUploader storage path exactly:
// owner-scoped `profile-photos` bucket, but nested under a per-itinerary
// folder (`<uid>/<itineraryId>/<uuid>.jpg` — RLS keys on the first folder, so
// the subfolder is free). Writes the public URL into the stop's photo_url via
// onChange; persistence rides the normal stops-jsonb save. Keeps the original
// (catalog) photo_url in state so "reset" can restore it after an override.
import { useRef, useState } from 'react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { browserAfter5Client } from '@/lib/after5/client';
import { PendingButtonContent } from '@/components/PendingButtonContent';

const BUCKET = 'profile-photos';

export function StopPhotoPicker({
  itineraryId,
  index,
  photoUrl,
  onChange,
}: {
  itineraryId: string;
  index: number;
  photoUrl: string | null | undefined;
  onChange: (url: string | null) => void;
}) {
  // Captured once on mount: the catalog/original photo this stop came with.
  const [original] = useState<string | null>(photoUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const overridden = (photoUrl ?? null) !== original;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setUploading(true);
    try {
      const client = browserAfter5Client();
      const { data: { user } } = await client.auth.getUser();
      if (!user) throw new Error('not signed in');
      const id = crypto.randomUUID();
      const path = `${user.id}/${itineraryId}/${id}.jpg`;
      const { error: upErr } = await client.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = client.storage.from(BUCKET).getPublicUrl(path);
      onChange(pub.publicUrl);
      toast.success('stop photo set. save to keep it.');
    } catch (err) {
      console.error('[StopPhotoPicker] upload failed', err);
      toast.error("couldn't upload that. try a different photo?");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <span className="mb-1 block font-body text-[12px] lowercase tracking-[0.04em] text-shell-ink/55">
        photo
      </span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-label={`set a photo for stop ${index + 1}`}
        onChange={onFile}
        className="sr-only"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-busy={uploading}
          className="relative inline-flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-shell-ink/20 bg-white/60 text-shell-ink/55 transition hover:border-shell-accent/50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-60"
        >
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImagePlus className="h-5 w-5 text-shell-accent" aria-hidden />
          )}
        </button>
        <div className="flex flex-col items-start gap-1">
          <span className="font-body text-[13px] lowercase text-shell-ink/60">
            <PendingButtonContent pending={uploading} pendingLabel="uploading…" accessibilityLabel="uploading stop photo">
              {photoUrl ? 'tap to change' : 'set a photo'}
            </PendingButtonContent>
          </span>
          {overridden && original && (
            <button
              type="button"
              onClick={() => onChange(original)}
              className="inline-flex items-center gap-1 font-body text-[12px] lowercase text-shell-accent transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
            >
              <RotateCcw className="h-3 w-3" aria-hidden />
              reset to original photo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

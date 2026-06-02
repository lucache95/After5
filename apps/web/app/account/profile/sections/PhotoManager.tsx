'use client';
// M6 editor section: ordered multi-photo gallery manager. Reuses the
// Reorder.Group/Reorder.Item + optimistic-persist pattern from
// app/dates/[slug]/interested/InterestedList.tsx (drag handle, useReducedMotion).
// Each tile shows a signed clear thumbnail, a drag handle, "set main", and remove.
// "add a photo" mounts PhotoCropper; on confirm the parent's onAdd(blob) runs
// (which calls addPhoto). Caps at MAX_PHOTOS. Tier-1 shell chrome.
import { useEffect, useRef, useState } from 'react';
import { Reorder, useReducedMotion } from 'framer-motion';
import Image from 'next/image';
import { GripVertical, ImageUp, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_PHOTOS } from '@after5/validators';
import { cn } from '@/lib/cn';
import { PhotoCropper } from '@/app/onboarding/steps/PhotoCropper';

export interface ManagedPhoto {
  id: string;
  clear_path: string;
  url: string | null;
  is_primary: boolean;
  sort_order: number;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png'];

export function PhotoManager({
  photos,
  onRemove,
  onReorder,
  onSetPrimary,
  onAdd,
}: {
  photos: ManagedPhoto[];
  onRemove: (id: string) => void;
  onReorder: (ordered: ManagedPhoto[]) => void;
  onSetPrimary: (id: string) => void;
  onAdd: (blob: Blob) => void | Promise<void>;
}) {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<ManagedPhoto[]>(photos);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [cropping, setCropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep local order in sync when the parent re-hydrates (e.g. after add/remove).
  useEffect(() => { setRows(photos); }, [photos]);

  const atCap = rows.length >= MAX_PHOTOS;

  function handleReorder(next: ManagedPhoto[]) {
    setRows(next); // optimistic
    onReorder(next);
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    const name = f.name.toLowerCase();
    const looksHeic = /image\/hei[cf]/.test(f.type) || name.endsWith('.heic') || name.endsWith('.heif');
    const ok = !looksHeic && (ACCEPTED_TYPES.includes(f.type) || f.type === '');
    if (!ok) {
      toast.error('that format is a no. jpeg or png.');
      e.target.value = '';
      return;
    }
    setPickedFile(f);
    setCropping(true);
  }

  if (cropping && pickedFile) {
    return (
      <PhotoCropper
        file={pickedFile}
        onConfirm={async (blob) => {
          setCropping(false);
          setPickedFile(null);
          await onAdd(blob);
        }}
        onCancel={() => { setCropping(false); setPickedFile(null); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-body text-[13px] leading-relaxed text-shell-ink/60">
        drag to reorder. the first one shows up front once you both lock in a night.
      </p>

      {rows.length === 0 ? (
        <p className="font-body text-sm text-shell-ink/55">no photos yet. add one to get started.</p>
      ) : (
        <Reorder.Group axis="y" values={rows} onReorder={handleReorder} className="space-y-2">
          {rows.map((photo) => (
            <Reorder.Item
              key={photo.id}
              value={photo}
              drag={reduce ? false : 'y'}
              dragListener={!reduce}
              className="list-none"
            >
              <div className="flex items-center gap-3 rounded-2xl border border-shell-ink/15 bg-white/70 p-2">
                <span className="cursor-grab text-shell-ink/40 active:cursor-grabbing" aria-hidden>
                  <GripVertical className="h-5 w-5" />
                </span>
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-shell-pink/40">
                  {photo.url ? (
                    <Image src={photo.url} alt="your photo" fill sizes="64px" className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-shell-ink/30">
                      <ImageUp className="h-5 w-5" aria-hidden />
                    </div>
                  )}
                  {photo.is_primary && (
                    <span className="absolute bottom-0 left-0 right-0 bg-shell-accent/90 py-0.5 text-center font-body text-[10px] font-semibold lowercase text-white">
                      main
                    </span>
                  )}
                </div>
                <div className="flex flex-1 items-center justify-end gap-1.5">
                  {!photo.is_primary && (
                    <button
                      type="button"
                      onClick={() => onSetPrimary(photo.id)}
                      aria-label="set as main"
                      className="inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 font-body text-[13px] lowercase text-shell-ink/70 transition hover:bg-shell-ink/10"
                    >
                      <Star className="h-4 w-4" aria-hidden />
                      set main
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(photo.id)}
                    aria-label="remove photo"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-full text-shell-ink/50 transition hover:bg-shell-ink/10 hover:text-shell-ink"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            </Reorder.Item>
          ))}
        </Reorder.Group>
      )}

      <label
        htmlFor="add-photo"
        className={cn(
          'flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full px-5 font-body text-sm lowercase transition',
          'border border-shell-ink/15 bg-white/70 text-shell-ink hover:border-shell-accent/50',
          atCap && 'pointer-events-none opacity-40',
        )}
      >
        <ImageUp className="h-4 w-4 text-shell-accent" aria-hidden />
        <span>add a photo</span>
        <input
          id="add-photo"
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={onPickPhoto}
          disabled={atCap}
          className="sr-only"
          aria-label="add a photo"
        />
      </label>
      <p className="font-body text-[12px] text-shell-ink/45">{rows.length}/{MAX_PHOTOS}</p>
    </div>
  );
}

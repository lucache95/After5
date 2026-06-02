'use client';
// M3 edit surface. Holds the editable stops/title/cover, threads every mutation
// through the pure helpers (lib/itinerary/edit) so this stays thin, and saves via
// the owner-scoped update_itinerary_stops RPC with an optimistic toast + rollback.
// Reuses the PhotoManager Reorder pattern (axis="y", useReducedMotion -> drag).
import { useState } from 'react';
import { Reorder, useReducedMotion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { updateItineraryStops } from '@after5/api-client';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';
import { addBlankStop, patchStop, removeStop, validateStopsForSave } from '@/lib/itinerary/edit';
import { EditableStopCard } from './EditableStopCard';
import { CoverPicker } from './CoverPicker';

// Stable drag keys decoupled from stop content (place_id can be blank on a new
// stop), so Reorder identity survives renames + reorders.
interface Row { key: string; stop: Stop; }

export function ItineraryEditor({
  itineraryId,
  initialStops,
  initialTitle,
  initialCover,
}: {
  itineraryId: string;
  initialStops: Stop[];
  initialTitle: string | null;
  initialCover: string | null;
}) {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<Row[]>(
    () => initialStops.map((stop, i) => ({ key: `s${i}`, stop })),
  );
  const [title, setTitle] = useState(initialTitle ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(initialCover);
  const [saving, setSaving] = useState(false);
  const [nextKey, setNextKey] = useState(initialStops.length);

  const stops = rows.map((r) => r.stop);
  const photos = stops
    .map((s) => s.photo_url)
    .filter((u): u is string => Boolean(u));

  function setStops(next: Stop[]) {
    setRows((prev) =>
      next.map((stop, i) => ({ key: prev[i]?.key ?? `s${i}`, stop })),
    );
  }

  function handlePatch(i: number, patch: Partial<Stop>) {
    setStops(patchStop(stops, i, patch));
  }

  function handleRemove(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleAdd() {
    const blank = addBlankStop(stops);
    setRows((prev) => [...prev, { key: `s${nextKey}`, stop: blank[blank.length - 1] }]);
    setNextKey((k) => k + 1);
  }

  function handleReorder(next: Row[]) {
    setRows(next);
  }

  async function handleSave() {
    const check = validateStopsForSave(stops);
    if (!check.ok) {
      toast.error(check.reason ?? 'fix the stops first');
      return;
    }
    setSaving(true);
    const t = toast.loading('saving your changes...');
    try {
      await updateItineraryStops(browserAfter5Client(), {
        itinerary_id: itineraryId,
        stops,
        title: title.trim() || undefined,
        cover_image_url: coverUrl ?? undefined,
      });
      toast.success('saved. looking good.', { id: t });
    } catch {
      toast.error('that didn’t save. try again?', { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 py-6 font-body text-shell-ink">
      <h1 className="font-heading text-3xl lowercase text-shell-ink">edit your night</h1>
      <p className="mt-1 font-body text-sm text-shell-ink/60">
        reorder, rewrite, retime. your call.
      </p>

      <label className="mt-6 block">
        <span className="mb-1 block font-body text-[12px] lowercase tracking-[0.04em] text-shell-ink/55">
          title
        </span>
        <input
          aria-label="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="name your night"
          className="w-full rounded-2xl border border-shell-ink/15 bg-white/70 px-3 py-2 font-body text-base text-shell-ink placeholder:text-shell-ink/35 focus:border-shell-accent/60 focus:outline-none focus:ring-2 focus:ring-shell-accent/20"
        />
      </label>

      <section className="mt-6">
        <h2 className="mb-2 font-heading text-lg lowercase text-shell-ink">stops</h2>
        <Reorder.Group axis="y" values={rows} onReorder={handleReorder} className="space-y-3">
          {rows.map((row, i) => (
            <Reorder.Item
              key={row.key}
              value={row}
              drag={reduce ? false : 'y'}
              dragListener={!reduce}
              className="list-none"
            >
              <EditableStopCard
                stop={row.stop}
                index={i}
                onPatch={handlePatch}
                onRemove={handleRemove}
              />
            </Reorder.Item>
          ))}
        </Reorder.Group>

        <button
          type="button"
          onClick={handleAdd}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-shell-ink/15 bg-white/70 px-5 font-body text-sm lowercase text-shell-ink transition hover:border-shell-accent/50"
        >
          <Plus className="h-4 w-4 text-shell-accent" aria-hidden />
          add a stop
        </button>
      </section>

      {photos.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 font-heading text-lg lowercase text-shell-ink">cover photo</h2>
          <CoverPicker photos={photos} current={coverUrl} onPick={setCoverUrl} />
        </section>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-8 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent px-6 font-body text-base font-semibold lowercase text-white shadow-fun transition hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'saving...' : 'save changes'}
      </button>
    </main>
  );
}

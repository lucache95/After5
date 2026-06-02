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
import type { Json } from '@after5/types';
import { addBlankStop, patchStop, removeStop, validateStopsForSave } from '@/lib/itinerary/edit';
import { googlePlaceToSubmission } from '@/lib/places/normalize';
import { EditableStopCard } from './EditableStopCard';
import { CoverPicker } from './CoverPicker';
import { CustomVenueSearch } from './CustomVenueSearch';

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

  // Append a custom venue (from the Google Places proxy) as an inline stop, then
  // best-effort record the pick to the admin promotion queue (owner RLS). A queue
  // failure is non-fatal — the stop still adds. We DON'T write to the curated
  // `places` table; the stop carries a `custom:<googleId>` id.
  async function handleAddCustom(stop: Stop) {
    setRows((prev) => [...prev, { key: `s${nextKey}`, stop }]);
    setNextKey((k) => k + 1);

    const googleId = stop.place_id.startsWith('custom:') ? stop.place_id.slice('custom:'.length) : stop.place_id;
    try {
      const client = browserAfter5Client();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;
      const row = googlePlaceToSubmission(
        {
          id: googleId,
          displayName: { text: stop.place_name },
          formattedAddress: stop.address ?? undefined,
          location:
            stop.lat != null && stop.lng != null
              ? { latitude: stop.lat, longitude: stop.lng }
              : undefined,
          types: stop.place_type ? [stop.place_type] : undefined,
        },
        itineraryId,
      );
      await client.from('custom_venue_submissions').insert({
        ...row,
        raw: row.raw as unknown as Json,
        submitted_by: user.id,
      });
    } catch {
      // non-fatal: the stop is already on the plan.
    }
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

        <div className="mt-5 rounded-2xl border border-shell-ink/10 bg-shell-ink/[0.02] p-4">
          <h3 className="mb-2 font-heading text-sm lowercase text-shell-ink">
            add a place we don’t have yet
          </h3>
          <CustomVenueSearch onAdd={handleAddCustom} />
        </div>
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

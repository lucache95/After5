'use client';
// M3 edit surface. Holds the editable stops/title/cover, threads every mutation
// through the pure helpers (lib/itinerary/edit) so this stays thin, and saves via
// the owner-scoped update_itinerary_stops RPC with an optimistic toast + rollback.
// Reuses the PhotoManager Reorder pattern (axis="y", useReducedMotion -> drag).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Reorder, useReducedMotion } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { updateItineraryStops } from '@after5/api-client';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';
import type { Json } from '@after5/types';
import { addBlankStop, patchStop, removeStop, sortStopsByTime, validateStopsForSave } from '@/lib/itinerary/edit';
import { googlePlaceToSubmission } from '@/lib/places/normalize';
import { EditableStopCard } from './EditableStopCard';
import { CoverPicker } from './CoverPicker';
import { CoverUploader } from './CoverUploader';
import { CustomVenueSearch } from './CustomVenueSearch';
import { ImproveControls } from '@/app/create/ImproveControls';
import { PendingButtonContent } from '@/components/PendingButtonContent';

// Stable drag keys decoupled from stop content (place_id can be blank on a new
// stop), so Reorder identity survives renames + reorders.
interface Row { key: string; stop: Stop; }

// Turn a thrown save error into a toast the founder can act on. Auth failures
// (expired JWT / failed refresh / 401) get a refresh nudge; anything else with
// a message gets surfaced verbatim; otherwise fall back to the generic line.
function saveErrorMessage(err: unknown): string {
  const e = err as { message?: unknown; status?: unknown; code?: unknown } | null;
  const message = typeof e?.message === 'string' ? e.message : '';
  const status = typeof e?.status === 'number' ? e.status : undefined;
  const authish = status === 401 || /jwt|expired|refresh/i.test(message);
  if (authish) return 'your session expired. refresh the page and try again.';
  if (message) return `that didn’t save: ${message}`;
  return 'that didn’t save. try again?';
}

export function ItineraryEditor({
  itineraryId,
  initialStops,
  initialTitle,
  initialCover,
  cityId = null,
}: {
  itineraryId: string;
  initialStops: Stop[];
  initialTitle: string | null;
  initialCover: string | null;
  /** Present on generated nights (AI-created itineraries with a city seed).
   * Null on blank custom canvases. Used to gate ImproveControls visibility. */
  cityId?: string | null;
}) {
  const reduce = useReducedMotion();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    () => initialStops.map((stop, i) => ({ key: `s${i}`, stop })),
  );
  const [title, setTitle] = useState(initialTitle ?? '');
  const [coverUrl, setCoverUrl] = useState<string | null>(initialCover);
  const [saving, setSaving] = useState(false);
  const [nextKey, setNextKey] = useState(initialStops.length);
  const [titleBusy, setTitleBusy] = useState(false);

  const stops = rows.map((r) => r.stop);
  const photos = stops
    .map((s) => s.photo_url)
    .filter((u): u is string => Boolean(u));

  // #85 door 2 — a blank canvas opens on a single empty stop (no name, no title).
  // Swap the editor's "edit your night" framing for a dry first-stop prompt so the
  // host isn't staring at an unexplained empty card.
  const isBlankCanvas =
    !title.trim() &&
    rows.length <= 1 &&
    stops.every((s) => !s.place_name?.trim() && !s.place_id);

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

  // True when at least one stop has a non-empty place_name — gates the title chips.
  const hasNamedStop = stops.some((s) => s.place_name?.trim());

  // Tone values mapped to chip labels. 'another take' sends no tone (undefined).
  const titleChips: Array<{ label: string; tone?: 'romantic' | 'playful' | 'casual' }> = [
    { label: 'another take' },
    { label: 'more romantic', tone: 'romantic' },
    { label: 'more playful', tone: 'playful' },
    { label: 'more casual', tone: 'casual' },
  ];

  async function handleTitleTake(tone?: 'romantic' | 'playful' | 'casual') {
    if (titleBusy) return;
    setTitleBusy(true);
    try {
      const client = browserAfter5Client();
      const body: Record<string, unknown> = { action: 'regenerate_title', itinerary_id: itineraryId };
      if (tone) body.tone = tone;
      const { data, error } = await client.functions.invoke<{ ok: boolean; title?: string; hook?: string; error?: string; code?: string }>('generate-plan', { body });
      if (error || !data?.ok || !data.title) {
        const msg = (data as { error?: string } | null)?.error ?? 'that one slipped away. try again?';
        toast.error(msg);
        return;
      }
      setTitle(data.title);
      toast.success('new title.');
    } finally {
      setTitleBusy(false);
    }
  }

  // Called by ImproveControls when the server returns a coherent updated stop list.
  // MVP caveat: improve actions compute from the SERVER-persisted stops, and this
  // full-row rebuild discards ANY unsaved local edits (renames, retimes, reorders,
  // added/removed stops) made before the improve call. Save first to keep them.
  function handleImproveUpdated(newStops: Stop[]) {
    const k = nextKey;
    setRows(newStops.map((stop, i) => ({ key: `s${k + i}`, stop })));
    setNextKey(k + newStops.length);
  }

  // Append a custom venue (from the Google Places proxy) as an inline stop, then
  // best-effort record the pick to the admin promotion queue (owner RLS). A queue
  // failure is non-fatal — the stop still adds. We DON'T write to the curated
  // `places` table; the stop carries a `custom:<googleId>` id.
  async function handleAddCustom(rawStop: Stop) {
    // Mirror the same sequential-time default as handleAdd: compute the "next"
    // start_time from the current last stop, then apply it to the incoming venue.
    const currentStops = rows.map((r) => r.stop);
    const withTime = addBlankStop(currentStops);
    const suggestedTime = withTime[withTime.length - 1].start_time;
    const stop: Stop = { ...rawStop, start_time: suggestedTime };
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
    } catch (err) {
      // non-fatal: the stop is already on the plan. Log so it's diagnosable.
      console.error('[editor] custom venue queue record failed', err);
    }
  }

  async function handleSave() {
    const check = validateStopsForSave(stops);
    if (!check.ok) {
      toast.error(check.reason ?? 'fix the stops first');
      return;
    }
    // Sort stops chronologically before persisting. Detect if a reorder happened
    // so we can surface a non-silent nudge to the user.
    const sorted = sortStopsByTime(stops);
    const wasReordered = sorted.some((s, i) => s !== stops[i]);
    setSaving(true);
    const t = toast.loading('saving your changes...');
    try {
      await updateItineraryStops(browserAfter5Client(), {
        itinerary_id: itineraryId,
        stops: sorted,
        title: title.trim() || undefined,
        cover_image_url: coverUrl ?? undefined,
      });
      // Reflect the canonical sorted order in the visible list after save.
      setStops(sorted);
      if (wasReordered) {
        toast.success('reordered your stops by time.', { id: t });
      } else {
        toast.success('saved. looking good.', { id: t });
      }
    } catch (err) {
      console.error('[editor] save failed', err);
      toast.error(saveErrorMessage(err), { id: t });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Minimal escape chrome — history-aware: pop if there's in-app history,
          else fall back to /home. Does not compete with the publish CTA. */}
      <div className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[480px] items-center px-4 py-3">
          <button
            type="button"
            aria-label="close editor"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) router.back();
              else router.push('/home');
            }}
            className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-shell-ink/70 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
          >
            <X className="h-5 w-5" strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      </div>
    <main className="mx-auto w-full max-w-[480px] px-4 py-6 font-body text-shell-ink">
      <h1 className="font-heading text-3xl lowercase text-shell-ink">
        {isBlankCanvas ? 'what’s the move?' : 'edit your night'}
      </h1>
      <p className="mt-1 font-body text-sm text-shell-ink/60">
        {isBlankCanvas
          ? 'add your first spot — search a place or type it in.'
          : 'reorder, rewrite, retime. your call.'}
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

      {/* AI title takes — only shown when at least one stop has a name */}
      {hasNamedStop && (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="title takes">
          {titleChips.map(({ label, tone }) => (
            <button
              key={label}
              type="button"
              onClick={() => handleTitleTake(tone)}
              disabled={titleBusy}
              className="inline-flex min-h-[44px] items-center rounded-full border border-shell-ink/15 bg-white/70 px-4 font-body text-sm lowercase text-shell-ink transition hover:border-shell-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {label}
            </button>
          ))}
        </div>
      )}

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
          <h3 className="font-heading text-sm lowercase text-shell-ink">
            missing a spot? add it
          </h3>
          <p className="mb-2 mt-1 font-body text-[12px] text-shell-ink/55">
            search any real place in town. we&rsquo;ll add it to your night with the details filled in.
          </p>
          <CustomVenueSearch onAdd={handleAddCustom} />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-heading text-lg lowercase text-shell-ink">cover photo</h2>
        {/* E11: upload a real cover that sells the night (storage-backed). */}
        <CoverUploader itineraryId={itineraryId} current={coverUrl} stops={stops} />
        {photos.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 font-body text-[12px] lowercase tracking-[0.04em] text-shell-ink/55">
              or use a stop photo
            </p>
            <CoverPicker photos={photos} current={coverUrl} onPick={setCoverUrl} />
          </div>
        )}
      </section>

      {/* ImproveControls — only for generated nights (cityId present). Must sit
          BEFORE the publish CTA to satisfy FLOW-01. Operates on server-persisted
          stop order; unsaved local reorders diverge momentarily until onUpdated
          rebuilds rows from the canonical returned stops. */}
      {cityId !== null && (
        <ImproveControls
          itineraryId={itineraryId}
          stops={stops}
          onUpdated={handleImproveUpdated}
        />
      )}

      {/* save changes — secondary treatment so it doesn't compete with publish */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-8 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-white/80 px-6 font-body text-base font-semibold lowercase text-shell-ink ring-1 ring-shell-ink/15 transition hover:bg-white hover:ring-shell-ink/25 disabled:opacity-50"
      >
        <PendingButtonContent pending={saving} pendingLabel="saving..." accessibilityLabel="saving itinerary">
          save changes
        </PendingButtonContent>
      </button>

      {/* E11 Door-2 publish CTA — carries the forked itinerary id to the real
          post form (full creator controls live there, F#4 convergence). */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-shell-ink/10 bg-shell-base/95 px-4 backdrop-blur pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => router.push(`/nights/new?itinerary=${itineraryId}`)}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent px-6 font-body text-base font-semibold lowercase text-white shadow-fun transition hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        >
          publish this night
        </button>
      </div>
    </main>
    </>
  );
}

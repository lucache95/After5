// apps/web/app/my-nights/NightCardActions.tsx
// Client leaf: host cancel + edit affordances for a single posted night, mounted
// inside NightCard on /my-nights (Phase 02 E6/E7, D-04/D-05). Affordances render
// ONLY on the host's own `seeking` night — a matched/completed/expired/cancelled
// night is past the point of a soft unpublish or edit, so this renders nothing.
//
// Cancel → vaul confirm → cancelNight (soft, reversible) → sonner toast.
// Edit   → vaul sheet (time / duration / optional venue + ambient) → updateNight.
// The UI gate is convenience only (T-02-16): the DEFINER RPCs re-check creator =
// auth.uid() server-side. Errors map by PG errcode to dry, specific copy (P0/D §3).
// Tokens only (DESIGN-SYSTEM §1): cn(), shell.*, font-heading/body, rounded-3xl,
// shadow-fun, ≥44px targets, focus-visible:ring-shell-accent/40, motion-reduce:*.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Drawer } from 'vaul';
import { toast } from 'sonner';
import { CalendarX, Pencil } from 'lucide-react';
import { browserAfter5Client, cancelNight, updateNight } from '@/lib/after5/client';
import { cn } from '@/lib/cn';

export interface HostNight {
  id: string;
  starts_at: string;
  status: string;
  duration_min?: number | null;
  venue_id?: string | null;
  ambient_sound_id?: string | null;
}

/** A venue the host may re-pin to. Loaded server-side; omit to hide the venue field. */
export interface VenueOption {
  id: string;
  name: string;
}
/** An ambient sound the host may re-pick. Loaded server-side; omit to hide the field. */
export interface AmbientOption {
  id: string;
  name: string;
}

// Map a PostgREST/RPC error to dry, specific host copy. The RPCs raise with a PG
// errcode (.code) and a short message (.message); fall back on the message, then a
// generic line. No filler, no adverbs (stop-slop).
function errorCopy(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  switch (e?.code) {
    case '42501':
      return "that's not your night to change.";
    case 'P0002':
      return "that night's gone.";
    case 'P0001':
      // not_cancellable, or a rejected venue/ambient/duration — the message is specific.
      if (e?.message?.includes('cancellable')) return "this night already matched — you can't take it down.";
      if (e?.message) return e.message.toLowerCase();
      return "that change didn't take. try again?";
    default:
      return "that didn't go through. try again?";
  }
}

// datetime-local wants `YYYY-MM-DDTHH:mm` in LOCAL time; the row carries a UTC ISO.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function NightCardActions({
  night,
  venues = [],
  ambientSounds = [],
}: {
  night: HostNight;
  venues?: VenueOption[];
  ambientSounds?: AmbientOption[];
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Edit-form draft. Seeded from the row each time the sheet opens.
  const [startsAt, setStartsAt] = useState(() => toLocalInput(night.starts_at));
  const [durationMin, setDurationMin] = useState<number>(night.duration_min ?? 150);
  const [venueId, setVenueId] = useState<string>(night.venue_id ?? '');
  const [ambientId, setAmbientId] = useState<string>(night.ambient_sound_id ?? '');

  // Pre-match only: nothing renders once a night leaves `seeking`.
  if (night.status !== 'seeking') return null;

  function openEdit() {
    setStartsAt(toLocalInput(night.starts_at));
    setDurationMin(night.duration_min ?? 150);
    setVenueId(night.venue_id ?? '');
    setAmbientId(night.ambient_sound_id ?? '');
    setEditOpen(true);
  }

  async function doCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await cancelNight(browserAfter5Client(), { instance_id: night.id });
      toast.success('night taken down. you can always post it again.');
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      console.error('[NightCardActions] cancel failed', err);
      toast.error(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  async function doEdit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await updateNight(browserAfter5Client(), {
        instance_id: night.id,
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        duration_min: durationMin,
        venue: venues.length > 0 ? (venueId || null) : null,
        ambient_sound_id: ambientSounds.length > 0 ? (ambientId || null) : null,
      });
      toast.success('night updated.');
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      console.error('[NightCardActions] update failed', err);
      toast.error(errorCopy(err));
    } finally {
      setBusy(false);
    }
  }

  const actionBtn = cn(
    'flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full border-2 px-4 py-2 font-body text-sm font-semibold lowercase transition',
    'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
    'motion-reduce:transition-none disabled:opacity-50',
  );

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={openEdit}
        className={cn(actionBtn, 'border-shell-ink/15 bg-white text-shell-ink hover:border-shell-accent/40 active:scale-[0.98] motion-reduce:active:scale-100')}
      >
        <Pencil className="h-4 w-4 shrink-0" aria-hidden />
        edit
      </button>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className={cn(actionBtn, 'border-shell-accent/30 bg-shell-pink/60 text-shell-accent hover:border-shell-accent/60 active:scale-[0.98] motion-reduce:active:scale-100')}
      >
        <CalendarX className="h-4 w-4 shrink-0" aria-hidden />
        cancel
      </button>

      {/* ── Cancel confirm ─────────────────────────────────────────────────── */}
      <Drawer.Root open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              take this night down?
            </Drawer.Title>
            <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
              it leaves the feed and anyone who slid in gets a heads-up. you can post it again later.
            </Drawer.Description>

            <button
              type="button"
              disabled={busy}
              onClick={() => void doCancel()}
              className="mt-6 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
            >
              {busy ? 'taking it down…' : 'take it down'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="mt-2 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
            >
              keep it up
            </button>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* ── Edit sheet ─────────────────────────────────────────────────────── */}
      <Drawer.Root open={editOpen} onOpenChange={(o) => { if (!o) setEditOpen(false); }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[420px] rounded-t-3xl bg-shell-base px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-3">
            <div aria-hidden className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-shell-ink/20" />
            <Drawer.Title className="font-heading text-3xl lowercase text-shell-ink">
              edit this night
            </Drawer.Title>
            <Drawer.Description className="mt-1 font-body text-sm text-shell-ink/70">
              change the time or details. anyone interested gets a heads-up if the time or place moves.
            </Drawer.Description>

            <form onSubmit={doEdit} className="mt-5 space-y-4" noValidate>
              <div>
                <label htmlFor={`edit-when-${night.id}`} className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">
                  when&apos;s the night?
                </label>
                <input
                  id={`edit-when-${night.id}`}
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
                />
              </div>

              <div>
                <label htmlFor={`edit-duration-${night.id}`} className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">
                  how long? (minutes)
                </label>
                <input
                  id={`edit-duration-${night.id}`}
                  type="number"
                  min={30}
                  max={1440}
                  step={15}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                  className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
                />
              </div>

              {venues.length > 0 && (
                <div>
                  <label htmlFor={`edit-venue-${night.id}`} className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">
                    where?
                  </label>
                  <select
                    id={`edit-venue-${night.id}`}
                    value={venueId}
                    onChange={(e) => setVenueId(e.target.value)}
                    className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
                  >
                    <option value="">leave as is</option>
                    {venues.map((v) => (
                      <option key={v.id} value={v.id}>{v.name.toLowerCase()}</option>
                    ))}
                  </select>
                </div>
              )}

              {ambientSounds.length > 0 && (
                <div>
                  <label htmlFor={`edit-ambient-${night.id}`} className="mb-1.5 block font-body text-sm font-semibold lowercase text-shell-ink">
                    soundtrack?
                  </label>
                  <select
                    id={`edit-ambient-${night.id}`}
                    value={ambientId}
                    onChange={(e) => setAmbientId(e.target.value)}
                    className="block w-full rounded-2xl border border-shell-ink/15 bg-white/80 px-4 py-3 font-body text-[15px] text-shell-ink focus:outline-none focus:ring-2 focus:ring-shell-accent/60"
                  >
                    <option value="">leave as is</option>
                    {ambientSounds.map((s) => (
                      <option key={s.id} value={s.id}>{s.name.toLowerCase()}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mt-1 flex min-h-[48px] w-full items-center justify-center rounded-full bg-shell-accent font-body font-semibold lowercase text-white shadow-fun transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50"
              >
                {busy ? 'saving…' : 'save changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                className="mt-1 flex min-h-[44px] w-full items-center justify-center rounded-full font-body lowercase text-shell-ink/70 transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/30"
              >
                never mind
              </button>
            </form>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

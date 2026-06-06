'use client';

// ImproveControls — the customize/improve loop UI (PLAN-02, Area 4).
//
// Lives in /create under the authed results view. Two affordances:
//   1. a per-stop "tweak" button that swaps a single stop (deterministic
//      re-pick of just that slot via the generate-plan improve dispatch), and
//   2. a free-text "tweak the whole night" input ("cheaper", "more romantic",
//      "later") parsed server-side into scoring knobs.
//
// The improve dispatch re-validates proximity + budget + hours server-side. When
// a change breaks coherence the response is { ok:false, issues }, and we surface
// it as a sonner toast — never a silent swap (T-09-13). On success we hand the
// new stops back to the parent so the itinerary updates in place.
//
// Barbiecore + mobile-first per docs/superpowers/DESIGN-SYSTEM.md: shell.* tokens,
// font-body, lowercase/dry copy, tap targets ≥44px, no raw hex, cn() for classes.

import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/cn';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';

interface ImproveResponse {
  ok: boolean;
  itinerary_id?: string;
  stops?: Stop[];
  issues?: Array<{ kind: string; message: string }>;
  error?: string;
  code?: string;
}

async function callImprove(body: Record<string, unknown>): Promise<ImproveResponse> {
  const client = browserAfter5Client();
  const { data, error } = await client.functions.invoke<ImproveResponse>('generate-plan', { body });
  if (error) {
    // Edge non-2xx is surfaced by supabase-js as a FunctionsHttpError whose
    // context carries the JSON body; try to read the structured message.
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const parsed = (await ctx.json()) as ImproveResponse;
        if (parsed) return parsed;
      }
    } catch {
      /* fall through to a generic failure */
    }
    return { ok: false, error: 'that tweak slipped away. try again?' };
  }
  return data ?? { ok: false, error: 'that tweak slipped away. try again?' };
}

export function ImproveControls({
  itineraryId,
  stops,
  onUpdated,
}: {
  itineraryId: string;
  stops: Stop[];
  /** Called with the new stops after a coherent, persisted change. */
  onUpdated: (stops: Stop[]) => void;
}) {
  const [busyStop, setBusyStop] = useState<number | null>(null);
  const [tweakText, setTweakText] = useState('');
  const [tweaking, setTweaking] = useState(false);

  function handleResult(res: ImproveResponse, successMsg: string) {
    if (res.ok && res.stops) {
      onUpdated(res.stops);
      toast.success(successMsg);
      return;
    }
    // Incoherence (or any failure) is surfaced, never silently shipped.
    toast.error(res.issues?.[0]?.message ?? res.error ?? 'that change breaks the flow of the night.');
  }

  async function swapStop(index: number) {
    if (busyStop !== null || tweaking) return;
    setBusyStop(index);
    try {
      const res = await callImprove({ action: 'swap_stop', itinerary_id: itineraryId, stop_index: index });
      handleResult(res, 'swapped that stop.');
    } finally {
      setBusyStop(null);
    }
  }

  async function applyTweak() {
    const text = tweakText.trim();
    if (!text || tweaking || busyStop !== null) return;
    setTweaking(true);
    try {
      const res = await callImprove({ action: 'nl_tweak', itinerary_id: itineraryId, tweak_text: text });
      handleResult(res, 'reworked your night.');
      if (res.ok) setTweakText('');
    } finally {
      setTweaking(false);
    }
  }

  return (
    <section className="mt-10 rounded-3xl border border-shell-ink/10 bg-shell-pink/40 p-5 shadow-fun">
      <p className="font-heading text-xl lowercase leading-tight text-shell-ink">
        not quite right?
      </p>
      <p className="mt-1.5 font-body text-sm lowercase text-shell-ink/70">
        swap a single stop, or tell us what to change.
      </p>

      {/* per-stop swap affordances */}
      <ul className="mt-5 space-y-2.5">
        {stops.map((s, i) => {
          const busy = busyStop === i;
          return (
            <li
              key={`${s.place_id}-${i}`}
              className="flex items-center gap-3 rounded-2xl border border-shell-ink/10 bg-shell-base px-4 py-3"
            >
              <span className="min-w-0 flex-1 truncate font-body text-sm lowercase text-shell-ink">
                {(s.place_name || 'this stop').toLowerCase()}
              </span>
              <button
                type="button"
                onClick={() => swapStop(i)}
                disabled={busyStop !== null || tweaking}
                aria-label={`swap ${s.place_name || 'this stop'} for another spot`}
                className={cn(
                  'inline-flex min-h-[44px] shrink-0 items-center rounded-pill border px-4 font-body text-sm lowercase transition-colors',
                  'border-shell-ink/15 text-shell-ink hover:border-shell-accent/60 hover:text-shell-accent',
                  'disabled:cursor-not-allowed disabled:opacity-40',
                )}
              >
                {busy ? 'swapping…' : 'tweak'}
              </button>
            </li>
          );
        })}
      </ul>

      {/* free-text NL tweak */}
      <div className="mt-6">
        <label htmlFor="nl-tweak" className="font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-ink/55">
          tweak the whole night
        </label>
        <div className="mt-2.5 flex flex-col gap-2.5 sm:flex-row">
          <input
            id="nl-tweak"
            type="text"
            value={tweakText}
            onChange={(e) => setTweakText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyTweak();
            }}
            maxLength={280}
            placeholder="cheaper · more romantic · later"
            aria-label="describe a change to your night"
            disabled={tweaking}
            className="block w-full rounded-pill border border-shell-ink/15 bg-shell-base px-5 py-3 font-body text-sm lowercase text-shell-ink outline-none transition-colors placeholder:text-shell-ink/35 focus:border-shell-accent disabled:opacity-50"
          />
          <button
            type="button"
            onClick={applyTweak}
            disabled={tweakText.trim().length === 0 || tweaking || busyStop !== null}
            className={cn(
              'inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-pill bg-shell-accent px-6 font-body text-sm font-semibold lowercase text-white shadow-fun transition-opacity',
              'hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40',
            )}
          >
            {tweaking ? 'reworking…' : 'apply'}
          </button>
        </div>
      </div>
    </section>
  );
}

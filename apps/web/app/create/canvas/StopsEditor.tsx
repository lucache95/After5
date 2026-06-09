'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { browserAfter5Client } from '@/lib/after5/client';
import type { Stop } from '@/lib/itinerary-types';
import { Sheet } from './Sheet';

export function StopsEditor({ itineraryId, stops, onApply, onClose }: {
  itineraryId: string;
  stops: Stop[];
  onApply: (stops: Stop[]) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);

  async function act(body: Record<string, unknown>, idx: number) {
    if (busy !== null) return;
    setBusy(idx);
    try {
      const { data, error } = await browserAfter5Client().functions.invoke<{
        ok: boolean;
        stops?: Stop[];
        issues?: { message: string }[];
        error?: string;
      }>('generate-plan', { body });
      if (error || !data?.ok || !data.stops) {
        toast.error(data?.issues?.[0]?.message ?? data?.error ?? 'that change breaks the flow of the night.');
        return;
      }
      onApply(data.stops);
      toast.success('updated.');
    } finally {
      setBusy(null);
    }
  }

  const btn =
    'min-h-[44px] rounded-pill px-3 font-body text-xs lowercase ring-1 ring-shell-ink/15 bg-white/80 text-shell-ink active:scale-95 disabled:opacity-40';
  const isLast = (i: number) => i === stops.length - 1;

  return (
    <Sheet title="the stops" onClose={onClose}>
      <ul className="space-y-3">
        {stops.map((s, i) => (
          <li key={`${s.place_id}-${i}`} className="rounded-2xl border border-shell-ink/10 bg-white/70 p-3">
            <p className="font-body text-sm lowercase text-shell-ink">{s.place_name}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                className={btn}
                disabled={busy !== null}
                onClick={() => act({ action: 'swap_stop', itinerary_id: itineraryId, stop_index: i }, i)}
              >
                {isLast(i) ? 'change the ending' : 'swap this stop'}
              </button>
              {stops.length > 1 && (
                <button
                  className={btn}
                  disabled={busy !== null}
                  onClick={() => act({ action: 'remove_stop', itinerary_id: itineraryId, stop_index: i }, i)}
                >
                  drop this stop
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

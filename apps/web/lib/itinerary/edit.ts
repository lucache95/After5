// M3: pure itinerary edit helpers. The editor keeps zero mutation logic of its
// own — it threads these immutable transforms so the surface stays thin and the
// rules are unit-tested. validateStopsForSave mirrors update_itinerary_stops'
// server checks for instant client-side feedback.
import type { Stop } from '@/lib/itinerary-types';

export function reorderStops(stops: Stop[], from: number, to: number): Stop[] {
  const next = stops.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function patchStop(stops: Stop[], index: number, patch: Partial<Stop>): Stop[] {
  return stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

export function removeStop(stops: Stop[], index: number): Stop[] {
  return stops.filter((_, i) => i !== index);
}

/** Parse "HH:MM" → total minutes from midnight, or null if unparseable. */
export function parseHHMM(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t?.trim() ?? '');
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Format total minutes from midnight as "HH:MM". Wraps past 23:59. */
export function formatHHMM(totalMin: number): string {
  const clamped = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Append a blank editable stop. The default start_time is calculated from the
 * last stop when possible: last.start_time + last.duration_min. Falls back to
 * '19:00' when the list is empty or the last time is unparseable.
 */
export function addBlankStop(stops: Stop[]): Stop[] {
  let start_time = '19:00';
  if (stops.length > 0) {
    const last = stops[stops.length - 1];
    const parsed = parseHHMM(last.start_time);
    if (parsed !== null) {
      start_time = formatHHMM(parsed + (last.duration_min ?? 60));
    }
  }
  return [...stops, { place_id: '', place_name: '', start_time, duration_min: 60, estimated_cost_pp: 0 }];
}

/**
 * Stable sort stops by start_time ascending. Stops with empty or unparseable
 * times keep their relative position and are placed at the end.
 */
export function sortStopsByTime(stops: Stop[]): Stop[] {
  return stops
    .map((s, i) => ({ s, i, t: parseHHMM(s.start_time) }))
    .sort((a, b) => {
      if (a.t === null && b.t === null) return a.i - b.i;
      if (a.t === null) return 1;
      if (b.t === null) return -1;
      return a.t !== b.t ? a.t - b.t : a.i - b.i;
    })
    .map(({ s }) => s);
}

/** Format total minutes from midnight as a friendly local time, e.g. "6:34pm". */
export function formatFriendlyTime(totalMin: number): string {
  const clamped = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * One-line stop summary: "{start}→{end} · ${cost} pp" with friendly times and
 * end = start + duration. Free stops render "free". Null when start_time is
 * unparseable (the card skips the line).
 */
export function stopSummary(stop: Stop): string | null {
  const start = parseHHMM(stop.start_time);
  if (start === null) return null;
  const end = start + (stop.duration_min ?? 0);
  const cost = stop.estimated_cost_pp ?? 0;
  const costPart = cost > 0 ? `$${cost} pp` : 'free';
  return `${formatFriendlyTime(start)}→${formatFriendlyTime(end)} · ${costPart}`;
}

export function validateStopsForSave(stops: Stop[]): { ok: boolean; reason?: string } {
  if (stops.length === 0) return { ok: false, reason: 'add at least one stop' };
  if (stops.length > 12) return { ok: false, reason: 'max 12 stops' };
  for (const s of stops) {
    if (!s.place_name?.trim()) return { ok: false, reason: 'every stop needs a name' };
    if ((s.duration_min ?? -1) < 0) return { ok: false, reason: 'duration can’t be negative' };
    if ((s.estimated_cost_pp ?? -1) < 0) return { ok: false, reason: 'cost can’t be negative' };
  }
  return { ok: true };
}

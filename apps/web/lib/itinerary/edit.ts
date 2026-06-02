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

export function addBlankStop(stops: Stop[]): Stop[] {
  return [...stops, { place_id: '', place_name: '', start_time: '19:00', duration_min: 60, estimated_cost_pp: 0 }];
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

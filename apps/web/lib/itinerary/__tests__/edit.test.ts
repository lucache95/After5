import { describe, it, expect } from 'vitest';
import { reorderStops, patchStop, removeStop, addBlankStop, validateStopsForSave } from '../edit';
import type { Stop } from '@/lib/itinerary-types';

const s = (id: string, over: Partial<Stop> = {}): Stop => ({
  place_id: id, place_name: id, start_time: '18:00', duration_min: 60, estimated_cost_pp: 20, ...over,
});

describe('itinerary edit helpers', () => {
  it('reorderStops moves an item', () => {
    const out = reorderStops([s('a'), s('b'), s('c')], 0, 2);
    expect(out.map((x) => x.place_id)).toEqual(['b', 'c', 'a']);
  });
  it('patchStop updates one stop immutably', () => {
    const stops = [s('a'), s('b')];
    const out = patchStop(stops, 1, { place_name: 'renamed' });
    expect(out[1].place_name).toBe('renamed');
    expect(stops[1].place_name).toBe('b'); // original untouched
  });
  it('removeStop drops by index', () => {
    expect(removeStop([s('a'), s('b')], 0).map((x) => x.place_id)).toEqual(['b']);
  });
  it('addBlankStop appends an editable blank with sane defaults', () => {
    const out = addBlankStop([s('a')]);
    expect(out.length).toBe(2);
    expect(out[1].place_name).toBe('');
    expect(out[1].duration_min).toBeGreaterThanOrEqual(0);
  });
  it('validateStopsForSave mirrors the RPC: empty array + blank name + >12 fail', () => {
    expect(validateStopsForSave([]).ok).toBe(false);
    expect(validateStopsForSave([s('a', { place_name: '' })]).ok).toBe(false);
    expect(validateStopsForSave(Array.from({ length: 13 }, (_, i) => s(String(i)))).ok).toBe(false);
    expect(validateStopsForSave([s('a')]).ok).toBe(true);
  });
});

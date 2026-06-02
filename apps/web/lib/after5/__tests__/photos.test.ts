import { describe, it, expect } from 'vitest';
import { nextSortOrder, toReorderPayload } from '../photos';

describe('photos helpers', () => {
  it('computes next sort order', () => {
    expect(nextSortOrder([])).toBe(0);
    expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 2 }] as never)).toBe(3);
  });
  it('builds reorder payload from a dragged list', () => {
    expect(toReorderPayload([{ id: 'a' }, { id: 'b' }] as never))
      .toEqual([{ id: 'a', sort_order: 0 }, { id: 'b', sort_order: 1 }]);
  });
});

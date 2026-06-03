import { describe, it, expect } from 'vitest';
import { groupActivity, type RawNotification, type ActivityGroup } from '../inbox-activity';

const row = (over: Partial<RawNotification>): RawNotification => ({
  id: 'id', type: 'new_match', payload: null, read_at: null, created_at: '2026-06-01T00:00:00Z', ...over,
});

describe('groupActivity', () => {
  it('groups interest_received by date_instance_id into one counted row', () => {
    const out = groupActivity([
      row({ id: 'a', type: 'interest_received', payload: { date_instance_id: 'd1' }, created_at: '2026-06-01T03:00:00Z' }),
      row({ id: 'b', type: 'interest_received', payload: { date_instance_id: 'd1' }, created_at: '2026-06-01T02:00:00Z', read_at: '2026-06-01T02:30:00Z' }),
      row({ id: 'c', type: 'interest_received', payload: { date_instance_id: 'd1' }, created_at: '2026-06-01T01:00:00Z' }),
    ]);
    expect(out).toHaveLength(1);
    const g = out[0] as ActivityGroup;
    expect(g.kind).toBe('group');
    expect(g.count).toBe(3);
    expect(g.ids).toEqual(['a', 'b', 'c']);
    expect(g.created_at).toBe('2026-06-01T03:00:00Z'); // newest member
    expect(g.anyUnread).toBe(true); // a and c are unread
  });

  it('keeps separate date_instance_ids as separate groups', () => {
    const out = groupActivity([
      row({ id: 'a', type: 'interest_received', payload: { date_instance_id: 'd1' } }),
      row({ id: 'b', type: 'interest_received', payload: { date_instance_id: 'd2' } }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((i) => i.kind === 'group')).toBe(true);
  });

  it('leaves high-signal types as single rows (never grouped)', () => {
    const out = groupActivity([
      row({ id: 'a', type: 'new_match', payload: { lock_id: 'l1' } }),
      row({ id: 'b', type: 'offer_received', payload: { offer_id: 'o1' } }),
      row({ id: 'c', type: 'new_match', payload: { lock_id: 'l2' } }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((i) => i.kind === 'single')).toBe(true);
  });

  it('excludes new_message entirely (lives in the thread zone)', () => {
    const out = groupActivity([
      row({ id: 'a', type: 'new_message' }),
      row({ id: 'b', type: 'new_match' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('b');
  });

  it('keeps an interest_received row single when it has no group key', () => {
    const out = groupActivity([row({ id: 'a', type: 'interest_received', payload: {} })]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('single');
  });

  it('preserves newest-first input order across mixed types', () => {
    const out = groupActivity([
      row({ id: 'a', type: 'new_match', created_at: '2026-06-01T05:00:00Z' }),
      row({ id: 'b', type: 'interest_received', payload: { date_instance_id: 'd1' }, created_at: '2026-06-01T04:00:00Z' }),
      row({ id: 'c', type: 'offer_received', created_at: '2026-06-01T03:00:00Z' }),
    ]);
    expect(out.map((i) => i.id)).toEqual(['a', 'interest_received:d1', 'c']);
  });
});

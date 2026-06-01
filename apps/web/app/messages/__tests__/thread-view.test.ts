// apps/web/app/messages/__tests__/thread-view.test.ts
import { describe, it, expect } from 'vitest';
import {
  unreadCount,
  lastMessagePreview,
  sortThreadsByRecency,
  dedupeById,
  mergeMessage,
  isMessageable,
  type MessageRow,
  type ThreadSummary,
} from '../thread-view';

const msg = (over: Partial<MessageRow>): MessageRow => ({
  id: 'm', thread_id: 't', sender_id: 'them', body: 'hi', read_at: null,
  created_at: '2026-06-01T00:00:00.000Z', ...over,
});

describe('unreadCount', () => {
  it('counts only counterpart messages with no read_at', () => {
    const rows = [
      msg({ id: '1', sender_id: 'them', read_at: null }),
      msg({ id: '2', sender_id: 'them', read_at: '2026-06-01T01:00:00Z' }), // read
      msg({ id: '3', sender_id: 'me', read_at: null }),                      // own
      msg({ id: '4', sender_id: 'them', read_at: null }),
    ];
    expect(unreadCount(rows, 'me')).toBe(2);
  });
  it('is 0 for an empty thread', () => {
    expect(unreadCount([], 'me')).toBe(0);
  });
});

describe('lastMessagePreview', () => {
  it('returns null when empty', () => {
    expect(lastMessagePreview([])).toBeNull();
  });
  it('returns the newest (last) message body + timestamp', () => {
    const rows = [msg({ id: '1', body: 'first' }), msg({ id: '2', body: 'last', created_at: '2026-06-02T00:00:00Z' })];
    expect(lastMessagePreview(rows)).toEqual({ body: 'last', at: '2026-06-02T00:00:00Z' });
  });
  it('truncates a long body with an ellipsis', () => {
    const long = 'a'.repeat(100);
    const out = lastMessagePreview([msg({ body: long })]);
    expect(out?.body.endsWith('…')).toBe(true);
    expect(out?.body.length).toBe(64);
  });
});

describe('sortThreadsByRecency', () => {
  const t = (id: string, lastAt: string | null): ThreadSummary => ({
    threadId: id, counterpartName: id, counterpartPhotoUrl: null, dateLabel: '',
    lastMessage: null, lastAt, unread: 0, messageable: true,
  });
  it('puts most-recent first and null lastAt last', () => {
    const out = sortThreadsByRecency([
      t('old', '2026-06-01T00:00:00Z'),
      t('none', null),
      t('new', '2026-06-03T00:00:00Z'),
    ]);
    expect(out.map((x) => x.threadId)).toEqual(['new', 'old', 'none']);
  });
  it('does not mutate the input', () => {
    const input = [t('a', '2026-06-01T00:00:00Z'), t('b', '2026-06-02T00:00:00Z')];
    sortThreadsByRecency(input);
    expect(input.map((x) => x.threadId)).toEqual(['a', 'b']);
  });
});

describe('dedupeById', () => {
  it('keeps the first occurrence of each id, preserving order', () => {
    const rows = [msg({ id: '1' }), msg({ id: '2' }), msg({ id: '1', body: 'dupe' })];
    const out = dedupeById(rows);
    expect(out.map((m) => m.id)).toEqual(['1', '2']);
    expect(out[0].body).toBe('hi');
  });
});

describe('mergeMessage', () => {
  it('appends a new id and keeps oldest -> newest', () => {
    const rows = [msg({ id: '1', created_at: '2026-06-01T00:00:00Z' })];
    const out = mergeMessage(rows, msg({ id: '2', created_at: '2026-06-02T00:00:00Z' }));
    expect(out.map((m) => m.id)).toEqual(['1', '2']);
  });
  it('replaces an existing id rather than duplicating (echo dedupe)', () => {
    const rows = [msg({ id: '1', body: 'optimistic' })];
    const out = mergeMessage(rows, msg({ id: '1', body: 'reconciled' }));
    expect(out).toHaveLength(1);
    expect(out[0].body).toBe('reconciled');
  });
});

describe('isMessageable', () => {
  it('is true for open/promoted with no revoke', () => {
    expect(isMessageable('open', null)).toBe(true);
    expect(isMessageable('promoted', null)).toBe(true);
  });
  it('is false when closed or revoked', () => {
    expect(isMessageable('closed', null)).toBe(false);
    expect(isMessageable('open', '2026-06-01T00:00:00Z')).toBe(false);
    expect(isMessageable(null, null)).toBe(false);
  });
});

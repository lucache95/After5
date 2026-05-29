import { describe, it, expect, vi, beforeEach } from 'vitest';

const insert = vi.fn();
const getUser = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({
    auth: { getUser },
    from: () => ({ insert }),
  }),
}));

import { submitRating, MatchError } from '@/lib/after5/match';

beforeEach(() => {
  insert.mockReset();
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: 'me' } }, error: null });
});

const input = {
  lockId: 'lock-1', rateeId: 'them',
  showed_up: true, on_time: false, cancelled_with_notice: null, unsafe_or_disrespectful: false,
};

describe('submitRating', () => {
  it('inserts the rating with rater_id from the session and returns ok', async () => {
    insert.mockResolvedValue({ error: null });
    await expect(submitRating(input)).resolves.toBe('ok');
    expect(insert).toHaveBeenCalledWith({
      lock_id: 'lock-1', rater_id: 'me', ratee_id: 'them',
      showed_up: true, on_time: false, cancelled_with_notice: null, unsafe_or_disrespectful: false,
    });
  });

  it('maps a 23505 unique violation to already_rated', async () => {
    insert.mockResolvedValue({ error: { code: '23505', message: 'dup' } });
    await expect(submitRating(input)).resolves.toBe('already_rated');
  });

  it('throws MatchError on any other error', async () => {
    insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    await expect(submitRating(input)).rejects.toBeInstanceOf(MatchError);
  });

  it('throws when there is no authed user', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(submitRating(input)).rejects.toBeInstanceOf(MatchError);
  });
});

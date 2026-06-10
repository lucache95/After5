// apps/web/app/inbox/__tests__/StandbyList.test.tsx
// Data-path tests for the standby section: the queue_entries read is hydrated
// with each night's blind-safe summary via get_night_detail (a candidate has no
// direct RLS read on date_instances/itineraries pre-offer — 20260527127500),
// and a null/failed detail degrades the row instead of blanking the section.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const { getNightDetail, cardEntry } = vi.hoisted(() => ({
  getNightDetail: vi.fn(),
  cardEntry: vi.fn(),
}));

vi.mock('@after5/api-client', () => ({ getNightDetail }));
vi.mock('@/components/StandbyCard', () => ({
  StandbyCard: ({ entry }: { entry: unknown }) => {
    cardEntry(entry);
    return <div data-testid="standby-card" />;
  },
}));

import { StandbyList } from '../StandbyList';

type SupabaseArg = Parameters<typeof StandbyList>[0]['supabase'];

// Minimal chain double for the one queue_entries select StandbyList issues.
function buildClient(rows: unknown[]): SupabaseArg {
  return {
    from: (table: string) => {
      if (table !== 'queue_entries') throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ order: async () => ({ data: rows }) }),
          }),
        }),
      };
    },
  } as unknown as SupabaseArg;
}

const row = (id: string, rank: number | null) => ({ date_instance_id: id, status: 'interested', rank });

beforeEach(() => {
  getNightDetail.mockReset();
  cardEntry.mockClear();
});

describe('StandbyList', () => {
  it('renders nothing when the candidate has no pending-interest rows', async () => {
    const ui = await StandbyList({ supabase: buildClient([]), userId: 'u1' });
    expect(ui).toBeNull();
    expect(getNightDetail).not.toHaveBeenCalled();
  });

  it('hydrates each row with title/starts_at/cover from get_night_detail', async () => {
    getNightDetail.mockImplementation(async (_c: unknown, id: string) => ({
      title: `night ${id}`,
      time_window_start: '2026-06-12T19:00:00Z',
      cover_image_url: `https://img/${id}.jpg`,
      vibe_tags: ['chill'],
    }));

    render(await StandbyList({ supabase: buildClient([row('d1', 1), row('d2', null)]), userId: 'u1' }));

    expect(screen.getByText('your queue')).toBeInTheDocument();
    expect(screen.getAllByTestId('standby-card')).toHaveLength(2);
    expect(getNightDetail).toHaveBeenCalledTimes(2); // one per row, no extra calls
    expect(cardEntry).toHaveBeenCalledWith({
      instance_id: 'd1',
      rank: 1,
      status: 'interested',
      title: 'night d1',
      starts_at: '2026-06-12T19:00:00Z',
      cover_image_url: 'https://img/d1.jpg',
      vibe_tags: ['chill'],
    });
  });

  it('a null or failed detail degrades that row to identity-free nulls', async () => {
    getNightDetail
      .mockResolvedValueOnce(null) // night expired/cancelled since the swipe
      .mockRejectedValueOnce(new Error('rpc down')); // broken RPC must not blank the section

    render(await StandbyList({ supabase: buildClient([row('d1', 2), row('d2', null)]), userId: 'u1' }));

    expect(screen.getAllByTestId('standby-card')).toHaveLength(2);
    for (const id of ['d1', 'd2']) {
      expect(cardEntry).toHaveBeenCalledWith(
        expect.objectContaining({ instance_id: id, title: null, starts_at: null, cover_image_url: null, vibe_tags: null }),
      );
    }
  });
});

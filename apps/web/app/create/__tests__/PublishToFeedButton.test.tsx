import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const postNight = vi.fn().mockResolvedValue('di-1');
vi.mock('@after5/api-client', () => ({ postNight: (...a: unknown[]) => postNight(...a) }));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({}) }));

import { PublishToFeedButton } from '../PublishToFeedButton';

beforeEach(() => postNight.mockClear());

describe('PublishToFeedButton', () => {
  it('unverified: shows the profile prompt, no publish', () => {
    render(<PublishToFeedButton itineraryId="i1" canPublish={false} startsAt="2026-07-01T18:00:00Z" />);
    expect(screen.getByText(/create a profile to publish/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });
  it('verified: publishes via postNight', async () => {
    render(<PublishToFeedButton itineraryId="i1" canPublish={true} startsAt="2026-07-01T18:00:00Z" />);
    await userEvent.click(screen.getByRole('button', { name: /publish to the feed/i }));
    expect(postNight).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itinerary_id: 'i1' }));
  });
});

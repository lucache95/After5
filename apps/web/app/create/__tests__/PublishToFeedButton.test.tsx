import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));

import { PublishToFeedButton } from '../PublishToFeedButton';

beforeEach(() => mockPush.mockClear());

describe('PublishToFeedButton', () => {
  it('unverified: shows the profile prompt, no publish', () => {
    render(<PublishToFeedButton itineraryId="i1" canPublish={false} />);
    expect(screen.getByText(/create a profile to publish/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });
  it('verified: routes to the real post form carrying the itinerary id (F#4 convergence)', async () => {
    render(<PublishToFeedButton itineraryId="i1" canPublish={true} />);
    await userEvent.click(screen.getByRole('button', { name: /publish to the feed/i }));
    expect(mockPush).toHaveBeenCalledWith('/nights/new?itinerary=i1');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

const upload = vi.fn().mockResolvedValue({ error: null });
const getPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://x/stop.jpg' } }));
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } });

vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({
    auth: { getUser: () => getUser() },
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a), getPublicUrl: (...a: unknown[]) => getPublicUrl(...a) }) },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { StopPhotoPicker } from '../StopPhotoPicker';

const file = () => new File(['x'], 'pic.jpg', { type: 'image/jpeg' });

// Harness mirroring the editor: photo_url lives in parent state.
function Harness({ initial }: { initial: string | null }) {
  const [url, setUrl] = useState<string | null>(initial);
  return <StopPhotoPicker itineraryId="it-1" index={0} photoUrl={url} onChange={setUrl} />;
}

beforeEach(() => {
  upload.mockClear().mockResolvedValue({ error: null });
  getUser.mockClear().mockResolvedValue({ data: { user: { id: 'u1' } } });
});

describe('StopPhotoPicker', () => {
  it('renders the set-a-photo affordance when the stop has no photo', () => {
    render(<Harness initial={null} />);
    expect(screen.getByText(/set a photo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/set a photo for stop 1/i)).toBeInTheDocument();
  });

  it('shows the catalog photo as the current value', () => {
    render(<Harness initial="https://cat/venue.jpg" />);
    const img = document.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://cat/venue.jpg');
    expect(screen.queryByText(/reset to original/i)).not.toBeInTheDocument();
  });

  it('override uploads under the per-itinerary folder and sets the new url', async () => {
    render(<Harness initial="https://cat/venue.jpg" />);
    await userEvent.upload(screen.getByLabelText(/set a photo for stop 1/i), file());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(String(upload.mock.calls[0][0])).toMatch(/^u1\/it-1\//);
    await waitFor(() =>
      expect(document.querySelector('img')).toHaveAttribute('src', 'https://x/stop.jpg'),
    );
  });

  it('reset restores the original catalog photo after an override', async () => {
    render(<Harness initial="https://cat/venue.jpg" />);
    await userEvent.upload(screen.getByLabelText(/set a photo for stop 1/i), file());
    const reset = await screen.findByText(/reset to original/i);
    await userEvent.click(reset);
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://cat/venue.jpg');
    expect(screen.queryByText(/reset to original/i)).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const upload = vi.fn().mockResolvedValue({ error: null });
const getPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://x/cover.jpg' } }));
const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } });
const updateItineraryStops = vi.fn().mockResolvedValue('it-1');

vi.mock('@after5/api-client', () => ({
  updateItineraryStops: (...a: unknown[]) => updateItineraryStops(...a),
}));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({
    auth: { getUser: () => getUser() },
    storage: { from: () => ({ upload: (...a: unknown[]) => upload(...a), getPublicUrl: (...a: unknown[]) => getPublicUrl(...a) }) },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CoverUploader } from '../CoverUploader';

const file = () => new File(['x'], 'pic.jpg', { type: 'image/jpeg' });

beforeEach(() => {
  upload.mockClear().mockResolvedValue({ error: null });
  updateItineraryStops.mockClear().mockResolvedValue('it-1');
  getUser.mockClear().mockResolvedValue({ data: { user: { id: 'u1' } } });
});

describe('CoverUploader', () => {
  it('empty state shows the dry prompt', () => {
    render(<CoverUploader itineraryId="it-1" current={null} stops={[]} />);
    expect(screen.getByText(/no cover yet/i)).toBeInTheDocument();
  });

  it('uploads the file then persists the url via updateItineraryStops', async () => {
    render(<CoverUploader itineraryId="it-1" current={null} stops={[]} />);
    const input = screen.getByLabelText(/upload a cover/i);
    await userEvent.upload(input, file());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(updateItineraryStops).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ itinerary_id: 'it-1', cover_image_url: 'https://x/cover.jpg' }),
    );
  });

  it('on upload failure does not persist a url and surfaces the dry copy', async () => {
    upload.mockResolvedValueOnce({ error: { message: 'boom' } });
    render(<CoverUploader itineraryId="it-1" current={null} stops={[]} />);
    await userEvent.upload(screen.getByLabelText(/upload a cover/i), file());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(updateItineraryStops).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn.t upload that/i)).toBeInTheDocument();
  });
});

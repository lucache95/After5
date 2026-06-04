import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { EditableStopCard } from '../EditableStopCard';
import { CoverPicker } from '../CoverPicker';
import { CustomVenueSearch } from '../CustomVenueSearch';
import { ItineraryEditor } from '../ItineraryEditor';

const updateItineraryStops = vi.fn().mockResolvedValue('itin-1');
const insert = vi.fn().mockResolvedValue({ error: null });
const from = vi.fn(() => ({ insert }));
// ItineraryEditor now mounts a Door-2 "publish this night" CTA that calls
// router.push, so the editor reads useRouter at render — stub next/navigation.
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush, refresh: vi.fn() }) }));
vi.mock('@after5/api-client', () => ({
  updateItineraryStops: (...a: unknown[]) => updateItineraryStops(...a),
}));
// CoverUploader (mounted on the canvas) reaches for storage on upload; stub it so
// the client mock is complete even though render alone never calls it.
const storageUpload = vi.fn().mockResolvedValue({ error: null });
const storage = { from: () => ({ upload: storageUpload, getPublicUrl: () => ({ data: { publicUrl: 'https://x/cover.jpg' } }) }) };
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ from, storage, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }) }));
vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
  useReducedMotion: () => true,
}));

describe('EditableStopCard', () => {
  it('edits the name + fires onPatch, and remove fires onRemove', async () => {
    const onPatch = vi.fn(); const onRemove = vi.fn();
    render(<EditableStopCard stop={{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }} index={0} onPatch={onPatch} onRemove={onRemove} />);
    const name = screen.getByLabelText(/name/i);
    fireEvent.change(name, { target: { value: 'pottery' } });
    expect(onPatch).toHaveBeenCalledWith(0, expect.objectContaining({ place_name: 'pottery' }));
    await userEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

describe('CoverPicker', () => {
  it('renders stop photos and fires onPick', async () => {
    const onPick = vi.fn();
    render(<CoverPicker photos={['a.jpg', 'b.jpg']} current="a.jpg" onPick={onPick} />);
    const opts = screen.getAllByRole('button', { name: /use this cover/i });
    await userEvent.click(opts[1]);
    expect(onPick).toHaveBeenCalledWith('b.jpg');
  });
});

const customStop = {
  place_id: 'custom:g1',
  place_name: 'quiet coffee',
  place_type: 'cafe',
  address: '1 main st',
  start_time: '19:00',
  duration_min: 60,
  estimated_cost_pp: 0,
  photo_url: null,
};

describe('CustomVenueSearch', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('searches, renders a result, and add-to-plan fires onAdd', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [customStop] }), { status: 200 }),
    );
    const onAdd = vi.fn();
    render(<CustomVenueSearch onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText(/search for a place/i), 'coffee');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/quiet coffee/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /add to plan/i }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ place_id: 'custom:g1' }));
  });

  it('shows the unavailable copy when the route returns 503', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'search_unavailable' }), { status: 503 }),
    );
    const onAdd = vi.fn();
    render(<CustomVenueSearch onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText(/search for a place/i), 'coffee');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/isn.t available yet/i)).toBeInTheDocument());
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('ItineraryEditor', () => {
  it('saves edited stops via the RPC', async () => {
    render(<ItineraryEditor itineraryId="itin-1" initialTitle="t" initialCover={null}
      initialStops={[{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }]} />);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(updateItineraryStops).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ itinerary_id: 'itin-1' }));
  });

  // #85 door 2 — a blank canvas opens on one empty stop with no title.
  it('shows the blank-canvas prompt and lets you add a manual + a places stop', async () => {
    from.mockClear(); insert.mockClear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [customStop] }), { status: 200 }),
    );
    render(<ItineraryEditor itineraryId="blank-1" initialTitle={null} initialCover={null}
      initialStops={[{ place_id: '', place_name: '', start_time: '19:00', duration_min: 60, estimated_cost_pp: 0 }]} />);
    // dry blank-state copy, not "edit your night"
    expect(screen.getByText(/what.s the move\?/i)).toBeInTheDocument();
    expect(screen.getByText(/add your first spot/i)).toBeInTheDocument();
    expect(screen.queryByText(/edit your night/i)).not.toBeInTheDocument();
    // manual add appends a blank stop
    await userEvent.click(screen.getByRole('button', { name: /add a stop/i }));
    await waitFor(() => expect(screen.getAllByLabelText(/^name$/i)).toHaveLength(2));
    // places add appends a real venue
    await userEvent.type(screen.getByLabelText(/search for a place/i), 'coffee');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/quiet coffee/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /add to plan/i }));
    await waitFor(() => expect(screen.getAllByLabelText(/^name$/i)).toHaveLength(3));
  });

  it('adds a custom venue stop and records it to the queue', async () => {
    from.mockClear(); insert.mockClear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: [customStop] }), { status: 200 }),
    );
    render(<ItineraryEditor itineraryId="itin-1" initialTitle="t" initialCover={null}
      initialStops={[{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 }]} />);
    expect(screen.getAllByLabelText(/^name$/i)).toHaveLength(1);
    await userEvent.type(screen.getByLabelText(/search for a place/i), 'coffee');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/quiet coffee/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /add to plan/i }));
    // stop count increased
    await waitFor(() => expect(screen.getAllByLabelText(/^name$/i)).toHaveLength(2));
    // best-effort queue record fired
    await waitFor(() => expect(from).toHaveBeenCalledWith('custom_venue_submissions'));
    expect(insert).toHaveBeenCalled();
  });
});

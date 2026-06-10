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
// invoke is used by title-takes chips and (via ImproveControls) the improve loop.
const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ from, storage, auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) }, functions: { invoke: (...a: unknown[]) => invoke(...a) } }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    loading: () => 't',
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    dismiss: vi.fn(),
  },
}));

// ImproveControls is a real component but pulls in the same mocked client above.
// We vi.mock it to a light marker so heavy internal deps (if any) don't bleed in.
// Test 4 uses the marker copy to assert presence/order; test 5 invokes onUpdated.
vi.mock('@/app/create/ImproveControls', () => ({
  ImproveControls: ({ onUpdated, stops }: { itineraryId: string; stops: { place_name?: string }[]; onUpdated: (s: unknown[]) => void }) => (
    <div data-testid="improve-controls">
      <p>not quite right?</p>
      <button type="button" onClick={() => onUpdated([{ place_id: 'new1', place_name: 'new venue', start_time: '20:00', duration_min: 60, estimated_cost_pp: 0 }])}>
        trigger-update
      </button>
      <span data-testid="improve-stop-count">{stops.length}</span>
    </div>
  ),
}));
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

// ---------------------------------------------------------------------------
// AI title takes (CHANGE 2)
// ---------------------------------------------------------------------------

const namedStop = { place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 60, estimated_cost_pp: 20 };

describe('AI title takes', () => {
  beforeEach(() => {
    invoke.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('test 1 — chips render when a stop has a name; "another take" success → title input becomes returned title', async () => {
    invoke.mockResolvedValue({ data: { ok: true, title: 'velvet dusk', hook: 'wine then water' }, error: null });

    render(<ItineraryEditor itineraryId="itin-t1" initialTitle="old title" initialCover={null} initialStops={[namedStop]} />);

    // getByRole throws if not found — sufficient proof of presence
    const chip = screen.getByRole('button', { name: /another take/i });
    expect(chip).toBeTruthy();

    await userEvent.click(chip);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('generate-plan', {
      body: { action: 'regenerate_title', itinerary_id: 'itin-t1' },
    }));

    // title input updated to returned title
    await waitFor(() => expect((screen.getByRole('textbox', { name: /title/i }) as HTMLInputElement).value).toBe('velvet dusk'));
    expect(toastSuccess).toHaveBeenCalledWith('new title.');
  });

  it('test 2 — title chip failure → toast.error called, title left unchanged', async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: 'the server is grumpy.' }, error: null });

    render(<ItineraryEditor itineraryId="itin-t2" initialTitle="original title" initialCover={null} initialStops={[namedStop]} />);

    await userEvent.click(screen.getByRole('button', { name: /another take/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('the server is grumpy.'));
    expect((screen.getByRole('textbox', { name: /title/i }) as HTMLInputElement).value).toBe('original title');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('test 3 — no named stops → no "another take" chip', () => {
    const blankStop = { place_id: '', place_name: '', start_time: '19:00', duration_min: 60, estimated_cost_pp: 0 };
    render(<ItineraryEditor itineraryId="itin-t3" initialTitle={null} initialCover={null} initialStops={[blankStop]} />);

    // queryByRole returns null when absent — check directly
    expect(screen.queryByRole('button', { name: /another take/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ImproveControls mounting (CHANGE 3)
// ---------------------------------------------------------------------------

describe('ImproveControls mounting', () => {
  it('test 4a — cityId present → ImproveControls marker visible AND before publish CTA', async () => {
    render(
      <ItineraryEditor
        itineraryId="itin-ic1"
        initialTitle="t"
        initialCover={null}
        initialStops={[namedStop]}
        cityId="city-123"
      />,
    );

    // getByText/getByTestId throws if absent — proof of presence
    expect(screen.getByText(/not quite right\?/i)).toBeTruthy();

    // ImproveControls marker precedes the publish button in DOM order
    const improveSection = screen.getByTestId('improve-controls');
    const publishBtn = screen.getByRole('button', { name: /publish this night/i });
    expect(improveSection.compareDocumentPosition(publishBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // FLOW-01 criterion 5 — the canvas publish CTA routes to the one publish
    // path, carrying the itinerary id.
    await userEvent.click(publishBtn);
    expect(routerPush).toHaveBeenCalledWith('/nights/new?itinerary=itin-ic1');
  });

  it('test 4b — cityId null → ImproveControls absent', () => {
    render(
      <ItineraryEditor
        itineraryId="itin-ic2"
        initialTitle="t"
        initialCover={null}
        initialStops={[namedStop]}
        cityId={null}
      />,
    );

    // queryBy returns null when absent
    expect(screen.queryByTestId('improve-controls')).toBeNull();
    expect(screen.queryByText(/not quite right\?/i)).toBeNull();
  });

  it('test 5 — onUpdated from ImproveControls rebuilds the visible stop list', async () => {
    render(
      <ItineraryEditor
        itineraryId="itin-ic3"
        initialTitle="t"
        initialCover={null}
        initialStops={[namedStop]}
        cityId="city-456"
      />,
    );

    // initially one stop input with value 'clay'
    expect((screen.getAllByLabelText(/^name$/i)[0] as HTMLInputElement).value).toBe('clay');

    // trigger the mock's onUpdated with a new stop list
    await userEvent.click(screen.getByRole('button', { name: /trigger-update/i }));

    // editor now shows the new stop name
    await waitFor(() => expect((screen.getAllByLabelText(/^name$/i)[0] as HTMLInputElement).value).toBe('new venue'));
  });
});

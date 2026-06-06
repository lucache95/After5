// Phase 10 plan 03 — the phase-gate WIRING spec for FLOW-01.
//
// Proves the primary night-creation path is wired end-to-end OFFLINE: no real
// LLM/generation call, no live Foursquare key, no network. Generation, the city
// POST, and the improve dispatch are all mocked so the FLOW is asserted
// deterministically. The @420px visual-verify of these surfaces is DEFERRED to
// Phase 11's interactive Playwright-MCP audit (which walks /create) — see the
// 10-03-SUMMARY note. This spec is the build+local-green gate.
//
// FLOW-01 wiring asserted here:
//   1. /create (authed) presents generate as the dominant door + the demoted
//      manual link still works (CreateChooser).
//   2. the global + tab / UserMenu wedge route to /create/generate.
//   3. the funnel city pick POSTs /api/profile/city (writes primary_city_id +
//      enqueues the seed server-side).
//   4. generation (mocked) lands on a result where ImproveControls is present
//      BEFORE the publish CTA, and an improve action persists in place.
//   5. PublishToFeedButton routes to /nights/new?itinerary=<id> — the one
//      publish path.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CreateFlow } from '../CreateFlow';
import { CreateChooser } from '../CreateChooser';
import type { KnownCity } from '@/lib/create/cities';
import type { GatedItinerary } from '@/lib/create/blur-gate';

// ---- shared mocks (offline) -------------------------------------------------

const push = vi.fn();
const back = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back }),
}));

vi.mock('sonner', () => ({
  toast: { loading: () => 't', success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));

// The improve dispatch (generate-plan edge fn) is mocked — no real edge call.
const invoke = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ functions: { invoke: (...a: unknown[]) => invoke(...a) } }),
}));

const createBlankItinerary = vi.fn();
vi.mock('@after5/api-client', () => ({
  createBlankItinerary: (...a: unknown[]) => createBlankItinerary(...a),
}));

// ItineraryView is a heavy presentational tree (gallery hero, maps, rails). The
// WIRING gate only cares that the result surface renders, so stub it to a light
// marker — the flow assertions live on the city POST, generate POST, improve
// dispatch, and publish route, not the itinerary chrome.
vi.mock('@/components/itinerary/ItineraryView', () => ({
  ItineraryView: ({ itinerary }: { itinerary: { title?: string } }) => (
    <div data-testid="itinerary-view">{itinerary.title}</div>
  ),
}));

const KELOWNA = '22222222-2222-2222-2222-222222222222';
const CITIES: KnownCity[] = [
  { id: KELOWNA, slug: 'kelowna', name: 'Kelowna' },
  { id: '33333333-3333-3333-3333-333333333333', slug: 'vernon', name: 'Vernon' },
];

// A minimal coherent generated night (the shape /api/create-plan returns). Two
// stops so ImproveControls renders a swap affordance per stop.
const GENERATED: GatedItinerary = {
  id: 'gen-itin-1',
  title: 'a slow kelowna evening',
  template_name: 'date night',
  hook: 'wine, then water.',
  total_cost_pp: 70,
  total_duration_min: 180,
  stops: [
    {
      place_id: 'a', place_name: 'Clay Studio', place_slug: 'clay-studio', place_type: 'activity',
      start_time: '18:00', duration_min: 60, estimated_cost_pp: 30, what_to_do: 'throw a pot',
      photo_url: null, address: null, neighborhood: 'downtown', lat: null, lng: null,
      local_insight: null, reservation_url: null, locked: false,
    },
    {
      place_id: 'b', place_name: 'Sandrine', place_slug: 'sandrine', place_type: 'restaurant',
      start_time: '19:30', duration_min: 90, estimated_cost_pp: 40, what_to_do: 'share plates',
      photo_url: null, address: null, neighborhood: 'downtown', lat: null, lng: null,
      local_insight: null, reservation_url: null, locked: false,
    },
  ],
} as unknown as GatedItinerary;

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockClear();
  back.mockClear();
  invoke.mockReset();
  createBlankItinerary.mockReset();
  fetchMock.mockReset();
  // Default fetch: the city POST returns ok; generation returns the mocked night.
  fetchMock.mockImplementation((url: string) => {
    if (url === '/api/profile/city') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    if (url === '/api/create-plan') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ itineraries: [GENERATED], authed: true, city: 'Kelowna' }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
});

function bodyOf(url: string): Record<string, unknown> | undefined {
  const call = fetchMock.mock.calls.find(([u]) => u === url);
  return call ? JSON.parse((call[1] as { body: string }).body) : undefined;
}

describe('FLOW-01 primary-path wiring (offline)', () => {
  it('criterion 1 — /create presents generate as the dominant door; the demoted manual link still works', async () => {
    createBlankItinerary.mockResolvedValue('blank-9');
    render(<CreateChooser />);

    // generate is the one dominant pink action and routes to the funnel.
    const generate = screen.getByRole('button', { name: /build it for me/i });
    expect(generate.className).toContain('bg-shell-accent');
    await userEvent.click(generate);
    expect(push).toHaveBeenCalledWith('/create/generate');

    // the manual door is demoted (not a co-equal pink card) but NOT a trap.
    const manual = screen.getByRole('button', { name: /build from scratch/i });
    expect(manual.className).not.toContain('bg-shell-accent');
    await userEvent.click(manual);
    await waitFor(() => expect(createBlankItinerary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/plans/blank-9/edit'));
  });

  it('criterion 2 — the global create entry routes to /create/generate (source assertion)', () => {
    // The + tab (BottomTabShell) and the UserMenu wedge both target the funnel.
    // Assert the wiring at the source so the gate is deterministic + offline.
    const here = dirname(fileURLToPath(import.meta.url));
    const tab = readFileSync(resolve(here, '../../../components/BottomTabShell.tsx'), 'utf8');
    const menu = readFileSync(resolve(here, '../../../components/UserMenu.tsx'), 'utf8');
    expect(tab).toContain('/create/generate');
    expect(menu).toContain('/create/generate');
  });

  it('criteria 3+4+5 — city POST → generate → improve(before publish) → publish routes to /nights/new', async () => {
    render(<CreateFlow initialCity="" authed cities={CITIES} canPublish />);

    // pick a vibe (gate) + the curated Kelowna chip → POST /api/profile/city.
    await userEvent.click(screen.getByRole('button', { name: /creative/i }));
    await userEvent.click(screen.getByRole('button', { name: /^kelowna$/i }));
    await waitFor(() => expect(bodyOf('/api/profile/city')).toEqual({ cityId: KELOWNA }));

    // generate (mocked) → the result surface.
    await userEvent.click(screen.getByRole('button', { name: /make my date/i }));
    await waitFor(() => expect(screen.getByTestId('itinerary-view')).toBeInTheDocument());
    // generation POSTed the funnel inputs (offline mock, no LLM).
    expect(bodyOf('/api/create-plan')).toMatchObject({ city_query: 'Kelowna', vibe: ['creative'] });

    // ImproveControls is present in the result, placed BEFORE the publish CTA.
    const improve = screen.getByText(/not quite right\?/i).closest('section')!;
    const publish = screen.getByRole('button', { name: /publish to the feed/i });
    expect(improve).toBeInTheDocument();
    // DOM order: the improve section precedes the publish button.
    expect(improve.compareDocumentPosition(publish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // one improve action (swap a stop) persists in place via the mocked dispatch.
    const swappedStops = [{ ...(GENERATED.stops[0]), place_id: 'c', place_name: 'New Studio' }, GENERATED.stops[1]];
    invoke.mockResolvedValue({ data: { ok: true, stops: swappedStops }, error: null });
    await userEvent.click(within(improve).getAllByRole('button', { name: /swap .* for another spot/i })[0]);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('generate-plan', {
      body: { action: 'swap_stop', itinerary_id: 'gen-itin-1', stop_index: 0 },
    }));

    // publish routes to the single post path carrying the itinerary id.
    await userEvent.click(screen.getByRole('button', { name: /publish to the feed/i }));
    expect(push).toHaveBeenCalledWith('/nights/new?itinerary=gen-itin-1');
  });

  it('no trap — a city-save failure never blocks generation', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/profile/city') return Promise.resolve({ ok: false, json: async () => ({}) });
      if (url === '/api/create-plan') {
        return Promise.resolve({ ok: true, json: async () => ({ itineraries: [GENERATED], authed: true, city: 'Kelowna' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(<CreateFlow initialCity="" authed cities={CITIES} canPublish />);

    await userEvent.click(screen.getByRole('button', { name: /creative/i }));
    await userEvent.click(screen.getByRole('button', { name: /^kelowna$/i }));
    // the CTA stays live despite the failed save.
    expect(screen.getByRole('button', { name: /make my date/i })).not.toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: /make my date/i }));
    await waitFor(() => expect(screen.getByTestId('itinerary-view')).toBeInTheDocument());
  });
});

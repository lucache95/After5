import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://x/api/places/search', { method: 'POST', body: JSON.stringify(body) });

const googleOk = {
  places: [
    {
      id: 'g1',
      displayName: { text: 'quiet coffee' },
      formattedAddress: '1 main st',
      location: { latitude: 49.88, longitude: -119.49 },
      types: ['coffee_shop'],
    },
  ],
};

const ORIGINAL_KEY = process.env.GOOGLE_PLACES_API_KEY;

beforeEach(() => {
  getUser.mockReset();
  vi.restoreAllMocks();
});
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = ORIGINAL_KEY;
});

describe('POST /api/places/search', () => {
  it('anon → 401', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    process.env.GOOGLE_PLACES_API_KEY = 'k';
    const res = await POST(req({ query: 'coffee' }));
    expect(res.status).toBe(401);
  });

  it('no key → 503 search_unavailable', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    delete process.env.GOOGLE_PLACES_API_KEY;
    const res = await POST(req({ query: 'coffee' }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('search_unavailable');
  });

  it('with key + google 200 → mapped results with custom: ids', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    process.env.GOOGLE_PLACES_API_KEY = 'k';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(googleOk), { status: 200 }));
    const res = await POST(req({ query: 'coffee', lat: 49.9, lng: -119.5, radiusKm: 10 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].place_id).toBe('custom:g1');
    expect(body.results[0].place_name).toBe('quiet coffee');
    // mirrors the M1 call shape exactly
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect((init?.headers as Record<string, string>)['X-Goog-Api-Key']).toBe('k');
    expect((init?.headers as Record<string, string>)['X-Goog-FieldMask']).toContain('places.id');
  });

  it('google 500 → 502 search_failed', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    process.env.GOOGLE_PLACES_API_KEY = 'k';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    const res = await POST(req({ query: 'coffee' }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('search_failed');
  });

  it('rejects an empty query → 400', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    process.env.GOOGLE_PLACES_API_KEY = 'k';
    const res = await POST(req({ query: '' }));
    expect(res.status).toBe(400);
  });
});

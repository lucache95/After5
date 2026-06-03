import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ functions: { invoke }, auth: { getUser } }),
}));

import { POST } from './route';

const itin = {
  template_id: 't', template_name: 'n', title: 'x', hook: 'h', why_it_works: 'WHY',
  total_cost_pp: 50, total_duration_min: 120, vibe: ['v'],
  stops: [
    { place_id: 'p1', place_name: 'A', place_type: 'cafe', start_time: '18:00', duration_min: 60, estimated_cost_pp: 25 },
    { place_id: 'p2', place_name: 'B', place_type: 'bar', start_time: '19:30', duration_min: 60, estimated_cost_pp: 25 },
  ],
};
const req = (body: unknown) => new Request('http://x/api/create-plan', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => { invoke.mockReset(); getUser.mockReset(); });

describe('POST /api/create-plan', () => {
  it('anon: returns a gated teaser (why stripped, later stop silhouetted)', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    invoke.mockResolvedValue({ data: { itineraries: [itin] }, error: null });
    const res = await POST(req({ vibe: ['v'], city_query: 'Portland, OR' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.authed).toBe(false);
    expect(body.itineraries[0].why_it_works).toBe('');
    expect(body.itineraries[0].stops[1].place_name).toBe('');
    expect(JSON.stringify(body)).not.toContain('WHY');
  });

  it('authed: returns full itineraries', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    invoke.mockResolvedValue({ data: { itineraries: [itin] }, error: null });
    const res = await POST(req({ vibe: ['v'], city_query: 'Austin, TX' }));
    const body = await res.json();
    expect(body.authed).toBe(true);
    expect(body.itineraries[0].why_it_works).toBe('WHY');
    expect(body.city).toBe('Austin, TX');
  });

  it('forwards the free-text city_query to the edge fn (no closed-city fallback)', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    invoke.mockResolvedValue({ data: { itineraries: [itin] }, error: null });
    const res = await POST(req({ vibe: ['v'], city_query: 'Narnia' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.city).toBe('Narnia');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][1].body.city_query).toBe('Narnia');
  });

  it('still accepts a legacy city_slug', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    invoke.mockResolvedValue({ data: { itineraries: [itin] }, error: null });
    const res = await POST(req({ vibe: ['v'], city_slug: 'kelowna' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.city).toBe('kelowna');
    expect(invoke.mock.calls[0][1].body.city_slug).toBe('kelowna');
  });

  it('rejects an empty vibe (the one required input)', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ vibe: [], city_query: 'x' }));
    expect(res.status).toBe(400);
  });

  it('rejects when no city is given', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(req({ vibe: ['v'] }));
    expect(res.status).toBe(400);
  });
});

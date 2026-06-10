import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

// CreateFlow reads useRouter at render (generated nights land on the canvas).
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

import { CreateFlow } from '../../../app/create/CreateFlow';

const cities = [{ slug: 'kelowna', name: 'Kelowna' }];
const teaser = {
  itineraries: [{ template_id: 't', template_name: 'n', title: 'pottery + ramen', hook: 'h',
    why_it_works: '', locked: true, total_cost_pp: 50, total_duration_min: 120, vibe: ['creative'],
    stops: [{ place_id: 'p1', place_name: 'Clay', place_type: 'activity', start_time: '18:00', duration_min: 60, estimated_cost_pp: 25, locked: false }] }],
  authed: false, city: 'kelowna', fellBack: false,
};

describe('CreateFlow', () => {
  it('requires a vibe before it will generate', async () => {
    render(<CreateFlow initialCity="kelowna" fellBack={false} authed={false} cities={cities} />);
    const go = screen.getByRole('button', { name: /make my date|create|plan my/i });
    expect(go).toBeDisabled();
  });

  it('generates and renders the plan title; anon sees the locked CTA', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => teaser });
    render(<CreateFlow initialCity="kelowna" fellBack={false} authed={false} cities={cities} />);
    await userEvent.click(screen.getByRole('button', { name: /creative/i }));
    await userEvent.click(screen.getByRole('button', { name: /make my date|create|plan my/i }));
    expect(await screen.findByText(/pottery \+ ramen/i)).toBeInTheDocument();
    // anon → email CTA to unlock
    expect(screen.getByText(/unlock|email me|see the full/i)).toBeInTheDocument();
  });
});

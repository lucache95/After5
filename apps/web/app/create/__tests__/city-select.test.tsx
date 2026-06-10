import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateFlow } from '../CreateFlow';
import type { KnownCity } from '@/lib/create/cities';

// The curated-city POST is fire-and-forget from the UI; we mock fetch and assert
// the call shape + that a failed save never disables the generate CTA.
const fetchMock = vi.fn();

const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));

// CreateFlow reads useRouter at render (generated nights land on the canvas).
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

const KELOWNA = '22222222-2222-2222-2222-222222222222';
const CITIES: KnownCity[] = [
  { id: KELOWNA, slug: 'kelowna', name: 'Kelowna' },
  { id: '33333333-3333-3333-3333-333333333333', slug: 'vernon', name: 'Vernon' },
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal('fetch', fetchMock);
  toastError.mockReset();
});

function pickAtLeastOneVibe() {
  // satisfy the generate-CTA gate so we can assert it stays enabled
  return userEvent.click(screen.getByRole('button', { name: /creative/i }));
}

describe('CreateFlow city selector', () => {
  it('tapping a curated chip (authed) POSTs the chosen cityId to /api/profile/city', async () => {
    render(<CreateFlow initialCity="" authed cities={CITIES} />);

    await userEvent.click(screen.getByRole('button', { name: /^kelowna$/i }));

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/profile/city');
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(call![1].body)).toEqual({ cityId: KELOWNA });
  });

  it('does NOT post when an anon user taps a curated chip (no write path)', async () => {
    render(<CreateFlow initialCity="" authed={false} cities={CITIES} />);

    await userEvent.click(screen.getByRole('button', { name: /^kelowna$/i }));

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/profile/city');
    expect(call).toBeUndefined();
  });

  it('prefills the saved city (prefillCityName) as the selected chip', () => {
    render(
      <CreateFlow
        initialCity=""
        authed
        cities={CITIES}
        prefillCityId={KELOWNA}
        prefillCityName="Kelowna"
      />,
    );
    // the prefilled chip renders pressed
    expect(screen.getByRole('button', { name: /^kelowna$/i })).toHaveAttribute('aria-pressed', 'true');
    // and the city field is seeded with it
    expect(screen.getByLabelText('city')).toHaveValue('Kelowna');
  });

  it('a failed city POST shows a quiet notice but never disables the generate CTA', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<CreateFlow initialCity="" authed cities={CITIES} />);

    await pickAtLeastOneVibe();
    await userEvent.click(screen.getByRole('button', { name: /^kelowna$/i }));

    const cta = screen.getByRole('button', { name: /make my date/i });
    expect(cta).not.toBeDisabled();
  });

  it('free-typed non-curated city does not POST and still enables generate', async () => {
    render(<CreateFlow initialCity="" authed cities={CITIES} />);

    await pickAtLeastOneVibe();
    await userEvent.type(screen.getByLabelText('city'), 'Saskatoon');

    const call = fetchMock.mock.calls.find(([url]) => url === '/api/profile/city');
    expect(call).toBeUndefined();
    expect(screen.getByRole('button', { name: /make my date/i })).not.toBeDisabled();
  });
});

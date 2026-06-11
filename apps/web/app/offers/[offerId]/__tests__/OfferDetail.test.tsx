// apps/web/app/offers/[offerId]/__tests__/OfferDetail.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const acceptOffer = vi.fn();
const passOffer = vi.fn();
const withdraw = vi.fn();
vi.mock('@/lib/after5/match', () => ({
  acceptOffer: (...a: unknown[]) => acceptOffer(...a),
  passOffer: (...a: unknown[]) => passOffer(...a),
  withdraw: (...a: unknown[]) => withdraw(...a),
  MatchError: class extends Error { code: string; constructor(c: string) { super(c); this.code = c; } },
  messageForCode: (c: string) => c,
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) }) }));
// next/image renders nothing useful in jsdom (and `fill` warns); stub to a plain img.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));
// vaul (the full-plan sheet) reads real CSS transforms jsdom can't compute; stub to
// plain DOM. Root respects `open` so "tap → the sheet appears" is a real assertion.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Root = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null;
  return { Drawer: Object.assign(Pass, { Root, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});
// NightDetailSheet imports the browser client + get_night_detail; the offer surface
// threads the SSR-loaded plan as `preloaded` so the RPC must never fire here.
const getNightDetail = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  getNightDetail: (...a: unknown[]) => getNightDetail(...a),
}));

import { OfferDetail, type OfferDetailProps } from '../OfferDetail';
import { MatchError } from '@/lib/after5/match';
import type { NightDetailNight, NightDetailStop } from '@/lib/after5/client';

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 10_000).toISOString();

function stop(over: Partial<NightDetailStop>): NightDetailStop {
  return {
    name: 'a spot', type: null, start_time: null, duration_min: null,
    cost_pp: null, what_to_do: null, neighborhood: null, local_insight: null,
    photo_url: null, lat: null, lng: null, google_place_id: null, drive_to_next_min: null,
    ...over,
  };
}

function props(over: Partial<OfferDetailProps> = {}): OfferDetailProps {
  return {
    offerId: 'off-1',
    instanceId: 'inst-1',
    expiresAt: future,
    status: 'active',
    host: { first_name: 'Sam', age: 29, city: 'Portland', photo_url: null },
    date: { startsAt: new Date('2026-06-01T19:00:00Z').toISOString() },
    stops: [],
    vibeTags: ['chill'],
    ...over,
  };
}

// The SSR-loaded itinerary detail the page threads in as `night` for the sheet.
function nightDetail(over: Partial<NightDetailNight> = {}): NightDetailNight {
  return {
    date_instance_id: 'inst-1',
    time_window_start: new Date('2026-06-01T19:00:00Z').toISOString(),
    pay_setting: null, vibe_tags: ['chill'], why_note: null, hook: 'the hook',
    why_it_works: null, cover_image_url: null, title: 'jazz bar + late night ramen',
    venue_neighborhood: null, is_seed: false, total_cost_pp: 40, total_duration_min: 120,
    stops: [stop({ name: 'rooftop bar', place_slug: 'rooftop-bar' })], ...over,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  acceptOffer.mockReset();
  passOffer.mockReset();
  withdraw.mockReset();
  push.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  getNightDetail.mockReset();
});

describe('OfferDetail', () => {
  it('renders host tier-3 lowercased (no bio — F#5 removed)', () => {
    render(<OfferDetail {...props()} />);
    expect(screen.getByText(/sam, 29/i)).toBeInTheDocument();
    expect(screen.getByText(/portland/i)).toBeInTheDocument();
  });

  // ——— reveal-at-pick (founder decision 2026-06-10) ———

  it('active offer renders the CLEAR profile card gallery + prompts (reveal-at-pick)', () => {
    render(<OfferDetail {...props({
      photos: ['https://signed/clear-1.jpg', 'https://signed/clear-2.jpg'],
      prompts: [{ label: 'my simple pleasure', answer: 'late night drives' }],
    })} />);
    const imgs = screen.getAllByRole('img');
    expect(imgs.some((i) => i.getAttribute('src') === 'https://signed/clear-1.jpg')).toBe(true);
    // no rung-2 blurred avatar remains on a live offer
    expect(document.querySelector('[data-rung2-avatar]')).toBeNull();
    expect(screen.getByText('late night drives')).toBeInTheDocument();
  });

  it('plays the ceremony once per offer per session (sessionStorage gate)', () => {
    expect(window.sessionStorage.getItem('offer-reveal-off-1')).toBeNull();
    const { unmount } = render(<OfferDetail {...props({ photos: ['https://signed/clear-1.jpg'] })} />);
    expect(window.sessionStorage.getItem('offer-reveal-off-1')).toBe('1');
    unmount();
    // second mount: marker present, the card renders static (still clear)
    render(<OfferDetail {...props({ photos: ['https://signed/clear-1.jpg'] })} />);
    expect(screen.getAllByRole('img').some((i) => i.getAttribute('src') === 'https://signed/clear-1.jpg')).toBe(true);
  });

  it('passed/expired offers keep the blurred rung-2 hint, never the clear card', () => {
    render(<OfferDetail {...props({ status: 'passed', host: { first_name: 'Sam', age: 29, city: 'Portland', photo_url: 'https://signed/blurred.jpg' }, photos: [] })} />);
    expect(document.querySelector('[data-rung2-avatar]')).not.toBeNull();
    expect(document.querySelector('[data-offer-reveal]')).toBeNull();
  });

  it('accepted offer keeps the clear card alongside the locked-in state', () => {
    render(<OfferDetail {...props({ status: 'accepted', lockId: 'lock-9', photos: ['https://signed/clear-1.jpg'] })} />);
    expect(screen.getAllByRole('img').some((i) => i.getAttribute('src') === 'https://signed/clear-1.jpg')).toBe(true);
    expect(screen.getByText(/you’re locked in\./i)).toBeInTheDocument();
  });

  it('renders the matched plan stops via PlanTimeline in "the night"', () => {
    render(<OfferDetail {...props({ stops: [
      stop({ name: 'rooftop bar', cost_pp: 22 }),
      stop({ name: 'late-night ramen', cost_pp: 0 }),
    ] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText('rooftop bar')).toBeInTheDocument();
    expect(screen.getByText('late-night ramen')).toBeInTheDocument();
  });

  it('shows the degrade copy when stops are empty (never a blank labelled section)', () => {
    render(<OfferDetail {...props({ stops: [] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText('the full plan unlocks here.')).toBeInTheDocument();
  });

  it('accept resolves a lock id and routes to /matches/<lock>', async () => {
    acceptOffer.mockResolvedValue('lock-7');
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /lock it in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/matches/lock-7'));
    expect(acceptOffer).toHaveBeenCalledWith('off-1');
  });

  it('pass routes to /feed', async () => {
    passOffer.mockResolvedValue(undefined);
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /^pass$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feed'));
    expect(passOffer).toHaveBeenCalledWith('off-1');
  });

  it('withdraw calls withdraw(instanceId) when instanceId is set', async () => {
    withdraw.mockResolvedValue(null);
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /not interested/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feed'));
    expect(withdraw).toHaveBeenCalledWith('inst-1');
    expect(passOffer).not.toHaveBeenCalled();
  });

  it('withdraw falls back to passOffer when instanceId is null', async () => {
    passOffer.mockResolvedValue(undefined);
    render(<OfferDetail {...props({ instanceId: null })} />);
    await userEvent.click(screen.getByRole('button', { name: /not interested/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/feed'));
    expect(passOffer).toHaveBeenCalledWith('off-1');
    expect(withdraw).not.toHaveBeenCalled();
  });

  it('offer_expired error toasts and routes to /feed', async () => {
    acceptOffer.mockRejectedValue(new MatchError('offer_expired'));
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /lock it in/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('offer_expired'));
    expect(push).toHaveBeenCalledWith('/feed');
  });

  it('account_gated error renders inline AccountGate and does not navigate', async () => {
    acceptOffer.mockRejectedValue(new MatchError('account_gated'));
    render(<OfferDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /lock it in/i }));
    await waitFor(() => expect(screen.getByRole('heading')).toHaveTextContent(/can't take this offer/i));
    expect(push).not.toHaveBeenCalled();
  });

  it('expired prop disables accept + pass but leaves withdraw enabled', () => {
    render(<OfferDetail {...props({ expiresAt: past })} />);
    expect(screen.getByRole('button', { name: /lock it in/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^pass$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /not interested/i })).toBeEnabled();
  });

  it('null date renders the unlock-on-accept placeholder', () => {
    render(<OfferDetail {...props({ date: null })} />);
    expect(screen.getByText(/details unlock when you accept/i)).toBeInTheDocument();
  });

  // ——— founder rule: tapping a night preview opens the FULL date-plan view ———

  it('"the night" header is a real button that opens the full-plan sheet (preloaded, blind)', async () => {
    const { container } = render(<OfferDetail {...props({
      stops: [stop({ name: 'rooftop bar', place_slug: 'rooftop-bar' })],
      night: nightDetail(),
    })} />);
    const btn = screen.getByRole('button', { name: /see the full plan/i });
    await userEvent.click(btn);
    // the sheet's hero title + timeline stop render alongside the inline card's
    expect(screen.getAllByText('jazz bar + late night ramen').length).toBeGreaterThan(0);
    expect(screen.getAllByText('rooftop bar').length).toBeGreaterThan(1);
    // preloaded — the blind RPC never fires from this surface
    expect(getNightDetail).not.toHaveBeenCalled();
    // PRE-lock: linkSlugs stays off — no /places venue link may leak anywhere
    const placeLinks = Array.from(container.querySelectorAll('a[href]')).filter((a) =>
      (a.getAttribute('href') ?? '').includes('/places/'),
    );
    expect(placeLinks).toHaveLength(0);
  });

  it('no night detail → no full-plan button (static header, never a dead tap)', () => {
    render(<OfferDetail {...props({ night: null })} />);
    expect(screen.queryByRole('button', { name: /see the full plan/i })).not.toBeInTheDocument();
    expect(screen.getByText('the night')).toBeInTheDocument();
  });

  // ——— coherence: the surface must agree with the DB status (live crawl 2026-06-10) ———

  it('active status renders the live countdown', () => {
    render(<OfferDetail {...props({ status: 'active' })} />);
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });

  it('accepted status renders the locked-in state linking to the match, no countdown, no actions', () => {
    render(<OfferDetail {...props({ status: 'accepted', lockId: 'lock-9' })} />);
    expect(screen.getByText(/you’re locked in\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /see your match/i })).toHaveAttribute('href', '/matches/lock-9');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lock it in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^pass$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /not interested/i })).not.toBeInTheDocument();
  });

  it('accepted status without a lock id falls back to /matches', () => {
    render(<OfferDetail {...props({ status: 'accepted', lockId: null })} />);
    expect(screen.getByRole('link', { name: /see your match/i })).toHaveAttribute('href', '/matches');
  });

  it('passed status renders honest terminal copy + a feed link, no countdown, no actions', () => {
    render(<OfferDetail {...props({ status: 'passed' })} />);
    expect(screen.getByText(/you passed on this one\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the feed/i })).toHaveAttribute('href', '/feed');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lock it in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /not interested/i })).not.toBeInTheDocument();
  });

  it('expired status renders honest terminal copy + a feed link, no countdown, no actions', () => {
    render(<OfferDetail {...props({ status: 'expired' })} />);
    expect(screen.getByText(/this one expired\./i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to the feed/i })).toHaveAttribute('href', '/feed');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lock it in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /not interested/i })).not.toBeInTheDocument();
  });
});

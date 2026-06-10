import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

const withdrawInterest = vi.fn().mockResolvedValue(undefined);
const mockRefresh = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const sheetProps = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  withdrawInterest: (...a: unknown[]) => withdrawInterest(...a),
}));
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

// next/image needs a plain <img> in jsdom (no Next loader/optimizer here). Drop
// the Next-only boolean props (fill/priority) so React doesn't warn.
vi.mock('next/image', () => ({
  default: ({
    alt = '',
    fill: _fill,
    priority: _priority,
    ...rest
  }: { alt?: string; fill?: unknown; priority?: unknown; [k: string]: unknown }) =>
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img alt={alt} {...(rest as Record<string, unknown>)} />,
}));

// Stub the feed's detail sheet — these tests verify the row WIRES it (open
// state + blind night summary), not the sheet's own rendering.
vi.mock('@/app/feed/NightDetailSheet', () => ({
  NightDetailSheet: (props: { open: boolean; night: { title: string | null } | null }) => {
    sheetProps(props);
    return props.open ? <div data-testid="night-detail-sheet">{props.night?.title}</div> : null;
  },
}));

// vaul renders into a portal; stub it to a plain inline container so the sheet
// content is queryable when `open`.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Root = ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
    open ? <div>{children}</div> : null;
  return {
    Drawer: {
      Root,
      Portal: Pass,
      Overlay: () => null,
      Content: ({ children }: { children?: React.ReactNode }) => <div role="dialog">{children}</div>,
      Title: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
      Description: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    },
  };
});

import { StandbyCard, type StandbyEntry } from '../StandbyCard';

const baseEntry: StandbyEntry = {
  instance_id: 'inst-1',
  rank: 1,
  status: 'interested',
  title: 'Pottery + Ramen',
  starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  cover_image_url: null,
  vibe_tags: ['chill'],
};

beforeEach(() => {
  withdrawInterest.mockClear();
  mockRefresh.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
  sheetProps.mockClear();
});

describe('StandbyCard', () => {
  it("renders the night's title, lowercased", () => {
    render(<StandbyCard entry={baseEntry} />);
    expect(screen.getByText('pottery + ramen')).toBeTruthy();
  });

  it('renders a human countdown to starts_at', () => {
    render(<StandbyCard entry={baseEntry} />);
    // +72h keeps the time-of-day, so the calendar-day diff is exactly 3; accept
    // the neighbour buckets to stay robust at midnight/DST boundaries.
    expect(screen.getByText(/^(tonight|tomorrow|in \d+ days)$/)).toBeTruthy();
  });

  it("rank=1 renders 'you're next in line'", () => {
    render(<StandbyCard entry={{ ...baseEntry, rank: 1 }} />);
    expect(screen.getByText(/you'?re next in line/i)).toBeTruthy();
  });

  it("rank>1 renders 'you're #{rank} in line'", () => {
    render(<StandbyCard entry={{ ...baseEntry, rank: 3 }} />);
    expect(screen.getByText(/you'?re #3 in line/i)).toBeTruthy();
  });

  it('tapping the row opens the night detail sheet with the blind summary', async () => {
    const user = userEvent.setup();
    render(<StandbyCard entry={baseEntry} />);
    expect(screen.queryByTestId('night-detail-sheet')).toBeNull();
    await user.click(screen.getByRole('button', { name: /pottery \+ ramen/i }));
    expect(screen.getByTestId('night-detail-sheet')).toBeTruthy();
    const night = sheetProps.mock.lastCall?.[0]?.night;
    expect(night).toMatchObject({
      date_instance_id: 'inst-1',
      title: 'Pottery + Ramen',
      time_window_start: baseEntry.starts_at,
      // blind contract: the row can never hand the sheet identity data.
      host_first_name: null,
      host_blurred_photo_url: null,
      host_age: null,
    });
  });

  it('an unreadable night (expired/cancelled) degrades to the identity-free fallback', () => {
    render(<StandbyCard entry={{ ...baseEntry, title: null, starts_at: null }} />);
    expect(screen.getByText('a night you slid in on')).toBeTruthy();
    expect(screen.getByText(/this night'?s gone/i)).toBeTruthy();
    // no sheet mounted, and the row tap is disabled — nothing left to open.
    expect(sheetProps).not.toHaveBeenCalled();
    const row = screen.getByRole('button', { name: /a night you slid in on/i });
    expect((row as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the demoted pull-my-interest control', () => {
    render(<StandbyCard entry={baseEntry} />);
    expect(screen.getByRole('button', { name: /pull my interest/i })).toBeTruthy();
  });

  it('opening the confirm shows the UI-SPEC confirm copy', async () => {
    const user = userEvent.setup();
    render(<StandbyCard entry={baseEntry} />);
    await user.click(screen.getByRole('button', { name: /pull my interest/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/pull your interest\?/i)).toBeTruthy();
    expect(within(dialog).getByText(/you'?ll drop off this night'?s list\. you can always slide back in later\./i)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /yep, pull it/i })).toBeTruthy();
  });

  it('confirm calls withdrawInterest and toasts success + refreshes', async () => {
    const user = userEvent.setup();
    render(<StandbyCard entry={baseEntry} />);
    await user.click(screen.getByRole('button', { name: /pull my interest/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /yep, pull it/i }));
    expect(withdrawInterest).toHaveBeenCalledWith(expect.anything(), { instance_id: 'inst-1' });
    expect(toastSuccess).toHaveBeenCalledWith('pulled. you\'re off this one.');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('surfaces an error toast when withdraw fails', async () => {
    withdrawInterest.mockRejectedValueOnce({ code: 'P0001', message: 'not_interested' });
    const user = userEvent.setup();
    render(<StandbyCard entry={baseEntry} />);
    await user.click(screen.getByRole('button', { name: /pull my interest/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /yep, pull it/i }));
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('has no a11y violations', async () => {
    const { container } = render(<StandbyCard entry={baseEntry} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

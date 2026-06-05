import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

const withdrawInterest = vi.fn().mockResolvedValue(undefined);
const mockRefresh = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  withdrawInterest: (...a: unknown[]) => withdrawInterest(...a),
}));
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

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

import { StandbyCard } from '../StandbyCard';

const baseEntry = {
  instance_id: 'inst-1',
  rank: 1 as number | null,
  status: 'interested',
  night_label: "thursday's pottery night",
};

beforeEach(() => {
  withdrawInterest.mockClear();
  mockRefresh.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('StandbyCard', () => {
  it("rank=1 renders 'you're next in line'", () => {
    render(<StandbyCard entry={{ ...baseEntry, rank: 1 }} />);
    expect(screen.getByText(/you'?re next in line/i)).toBeTruthy();
  });

  it("rank>1 renders 'you're #{rank} in line'", () => {
    render(<StandbyCard entry={{ ...baseEntry, rank: 3 }} />);
    expect(screen.getByText(/you'?re #3 in line/i)).toBeTruthy();
  });

  it('renders the soft sub-line verbatim', () => {
    render(<StandbyCard entry={baseEntry} />);
    expect(screen.getByText(/if the spot opens up, you'?re up\./i)).toBeTruthy();
  });

  it('renders the neutral pull-my-interest control', () => {
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

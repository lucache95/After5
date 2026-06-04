import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';

const cancelNight = vi.fn().mockResolvedValue(undefined);
const updateNight = vi.fn().mockResolvedValue(undefined);
const mockRefresh = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  cancelNight: (...a: unknown[]) => cancelNight(...a),
  updateNight: (...a: unknown[]) => updateNight(...a),
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

import { NightCardActions } from '../NightCardActions';

const baseNight = {
  id: 'inst-1',
  starts_at: '2026-07-01T19:00:00.000Z',
  status: 'seeking',
  duration_min: 150,
};

beforeEach(() => {
  cancelNight.mockClear();
  updateNight.mockClear();
  mockRefresh.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('NightCardActions', () => {
  it('renders cancel + edit affordances on a seeking night', () => {
    render(<NightCardActions night={baseNight} />);
    expect(screen.getByRole('button', { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
  });

  it('renders NOTHING on a non-seeking (matched) night', () => {
    const { container } = render(<NightCardActions night={{ ...baseNight, status: 'matched' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing on a completed / cancelled / expired night', () => {
    for (const status of ['completed', 'cancelled', 'expired']) {
      const { container } = render(<NightCardActions night={{ ...baseNight, status }} />);
      expect(container.firstChild).toBeNull();
    }
  });

  it('cancel → confirm calls cancelNight and toasts success', async () => {
    const user = userEvent.setup();
    render(<NightCardActions night={baseNight} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /take it down/i }));
    expect(cancelNight).toHaveBeenCalledWith(expect.anything(), { instance_id: 'inst-1' });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('surfaces a readable error toast when cancel fails (not_creator 42501)', async () => {
    cancelNight.mockRejectedValueOnce({ code: '42501', message: 'not_creator' });
    const user = userEvent.setup();
    render(<NightCardActions night={baseNight} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /take it down/i }));
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('edit → submit calls updateNight and toasts success', async () => {
    const user = userEvent.setup();
    render(<NightCardActions night={baseNight} />);
    await user.click(screen.getByRole('button', { name: /edit/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }));
    expect(updateNight).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ instance_id: 'inst-1' }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('has no a11y violations on the seeking actions', async () => {
    const { container } = render(<NightCardActions night={baseNight} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// saveFeedFilters is the self-write seam (Plan 04-02). We mock it so the test
// asserts (a) the exact built FeedFilters shape, (b) onApplied fires once on
// success, and (c) onApplied is NOT called when the save rejects.
const saveFeedFilters = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  saveFeedFilters: (...a: unknown[]) => saveFeedFilters(...a),
}));

// sonner toast.error — assert the dry copy on a save failure.
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

// vaul reads real transform matrices jsdom can't compute; stub to plain DOM and
// only render content when `open` so the sheet body is queryable.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Root = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <>{children}</> : null;
  return { Drawer: { Root, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass } };
});

import { FilterSheet } from '../FilterSheet';

const noop = () => {};

beforeEach(() => {
  saveFeedFilters.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
});

describe('FilterSheet', () => {
  it('renders the two groups with inclusive framing (no "exclude")', () => {
    render(<FilterSheet open onOpenChange={noop} userId="u1" />);
    expect(screen.getByText('dealbreakers')).toBeInTheDocument();
    expect(screen.getByText('nice to have')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /who's hosting/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /vibe/i })).toBeInTheDocument();
    expect(screen.queryByText(/exclude/i)).not.toBeInTheDocument();
  });

  it('chips toggle aria-checked', async () => {
    render(<FilterSheet open onOpenChange={noop} userId="u1" />);
    const women = screen.getByRole('checkbox', { name: /women/i });
    expect(women).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(women);
    expect(women).toHaveAttribute('aria-checked', 'true');
  });

  it('apply persists the built FeedFilters AND fires onApplied exactly once', async () => {
    const onApplied = vi.fn();
    const onOpenChange = vi.fn();
    render(<FilterSheet open onOpenChange={onOpenChange} userId="u1" onApplied={onApplied} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /women/i }));
    await userEvent.click(screen.getByRole('radio', { name: /≤ 25km/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /^chill$/i }));
    await userEvent.click(screen.getByRole('button', { name: /apply filters/i }));

    await waitFor(() =>
      expect(saveFeedFilters).toHaveBeenCalledWith(expect.anything(), 'u1', {
        host_genders: ['woman'],
        max_distance_km: 25,
        vibes: ['chill'],
      }),
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith({
      host_genders: ['woman'],
      max_distance_km: 25,
      vibes: ['chill'],
    });
    // closes on success
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('an untouched apply persists the inclusive empty-object default', async () => {
    const onApplied = vi.fn();
    render(<FilterSheet open onOpenChange={noop} userId="u1" onApplied={onApplied} />);
    await userEvent.click(screen.getByRole('button', { name: /apply filters/i }));
    await waitFor(() => expect(saveFeedFilters).toHaveBeenCalledWith(expect.anything(), 'u1', {}));
    expect(onApplied).toHaveBeenCalledWith({});
  });

  it('a save failure toasts and does NOT call onApplied', async () => {
    saveFeedFilters.mockRejectedValueOnce(new Error('rls'));
    const onApplied = vi.fn();
    render(<FilterSheet open onOpenChange={noop} userId="u1" onApplied={onApplied} />);
    await userEvent.click(screen.getByRole('button', { name: /apply filters/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/didn.t save/i)));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('reset clears all chips back to inclusive defaults', async () => {
    render(<FilterSheet open onOpenChange={noop} userId="u1" current={{ host_genders: ['woman'], max_distance_km: 25 }} />);
    const women = screen.getByRole('checkbox', { name: /women/i });
    expect(women).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: /reset filters/i }));
    expect(women).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /≤ 25km/i })).toHaveAttribute('aria-checked', 'false');
  });
});

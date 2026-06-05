import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const cancelLock = vi.fn();
vi.mock('@/lib/after5/match', () => ({
  cancelLock: (...a: unknown[]) => cancelLock(...a),
  MatchError: class extends Error { code: string; constructor(c: string) { super(c); this.code = c; } },
  messageForCode: (c: string) => c,
}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const toastFn = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign((...a: unknown[]) => toastFn(...a), { error: (...a: unknown[]) => toastError(...a) }) }));
// vaul renders into a portal; passthrough so drawer content is queryable.
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Pass, { Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});
// framer-motion (used by MatchConfirmation + the real RevealModal in this tree) — stub.
// Pass through any motion.* tag (div/span/section/…) as a plain element, dropping the
// animation-only props that aren't valid DOM attributes.
vi.mock('framer-motion', () => {
  const strip = (props: Record<string, unknown>) => {
    const {
      initial, animate, exit, transition, variants, custom, layout, layoutId,
      whileHover, whileTap, whileFocus, whileInView, whileDrag, drag, dragConstraints,
      onAnimationComplete, onAnimationStart, viewport, ...rest
    } = props;
    return rest;
  };
  const motion = new Proxy({}, {
    get: (_t, tag) => {
      const Tag = String(tag) as React.ElementType;
      return (props: Record<string, unknown> = {}) => {
        const { children, ...rest } = strip(props);
        return <Tag {...rest}>{children as React.ReactNode}</Tag>;
      };
    },
  });
  return {
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
    motion,
  };
});
// next/image (used by PlanTimeline) renders nothing useful in jsdom — stub to a plain img.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));

import { LockDetail, type LockDetailProps } from '../LockDetail';
import type { PartyProfile } from '../../lock-view';
import type { NightDetailStop } from '@/lib/after5/client';

const counterpart: PartyProfile = {
  id: 'p1', first_name: 'jamie', age: 28, city: 'portland', neighborhood: 'alberta',
  clear_photo_url: null, vibe_tags: ['hiking'],
};

function stop(over: Partial<NightDetailStop>): NightDetailStop {
  return {
    name: 'a spot', type: null, start_time: null, duration_min: null,
    cost_pp: null, what_to_do: null, neighborhood: null, local_insight: null,
    photo_url: null, lat: null, lng: null, drive_to_next_min: null,
    ...over,
  };
}

function props(over: Partial<LockDetailProps> = {}): LockDetailProps {
  return {
    lockId: 'lock-1', status: 'active', counterpart, threadId: 'thread-1',
    startsAt: '2026-06-01T19:00:00Z', ratingOpen: false, justLocked: false,
    stops: [], vibeTags: ['hiking'], ...over,
  };
}

beforeEach(() => { cancelLock.mockReset(); refresh.mockReset(); toastFn.mockReset(); toastError.mockReset(); });

describe('LockDetail', () => {
  it('opens the reveal modal from the "see their profile" trigger', async () => {
    render(<LockDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /see their profile/i }));
    expect(screen.getByText('jamie, 28')).toBeInTheDocument();
  });

  it('links to the conversation thread instead of the old phase-7 placeholder', () => {
    render(<LockDetail {...props({ threadId: 'thread-1' })} />);
    const link = screen.getByRole('link', { name: /message jamie/i });
    expect(link).toHaveAttribute('href', '/messages/thread-1');
    expect(screen.queryByText(/coming with phase 7/i)).not.toBeInTheDocument();
  });

  it('falls back to a quiet note when no thread exists', () => {
    render(<LockDetail {...props({ threadId: null })} />);
    expect(screen.queryByRole('link', { name: /message jamie/i })).not.toBeInTheDocument();
    expect(screen.getByText(/chat will open up here/i)).toBeInTheDocument();
  });

  it('hides the rate CTA when ratingOpen is false', () => {
    render(<LockDetail {...props({ ratingOpen: false })} />);
    expect(screen.queryByRole('link', { name: /rate this date/i })).not.toBeInTheDocument();
  });

  it('shows the rate CTA linking to /rate when ratingOpen is true', () => {
    render(<LockDetail {...props({ ratingOpen: true })} />);
    expect(screen.getByRole('link', { name: /rate this date/i })).toHaveAttribute('href', '/matches/lock-1/rate');
  });

  it('cancelled lock shows no rate CTA even when window open', () => {
    render(<LockDetail {...props({ status: 'cancelled', ratingOpen: true })} />);
    expect(screen.queryByRole('link', { name: /rate this date/i })).not.toBeInTheDocument();
    expect(screen.getByText(/this date was cancelled/i)).toBeInTheDocument();
  });

  it('renders "the night" plan via PlanTimeline when stops are present', () => {
    render(<LockDetail {...props({ stops: [
      stop({ name: 'rooftop bar', cost_pp: 22 }),
      stop({ name: 'late-night ramen', cost_pp: 0 }),
    ] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText('rooftop bar')).toBeInTheDocument();
    expect(screen.getByText('late-night ramen')).toBeInTheDocument();
  });

  it('shows the degrade copy when a lock has no stops (never a blank section)', () => {
    render(<LockDetail {...props({ stops: [] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText("plan's being put together.")).toBeInTheDocument();
  });

  it('active lock cancel flow calls cancelLock with the chosen reason', async () => {
    cancelLock.mockResolvedValue(null);
    render(<LockDetail {...props({ status: 'active' })} />);
    // The detail-screen trigger and the picker's confirm both read "cancel this date"
    // (the picker confirm starts disabled). Pick a reason, then click the enabled confirm.
    await userEvent.click(screen.getByRole('radio', { name: /both of us called it off/i }));
    // The picker's confirm is the LAST "cancel this date" button (after the detail trigger).
    const buttons = screen.getAllByRole('button', { name: /^cancel this date$/i });
    const confirm = buttons[buttons.length - 1];
    await userEvent.click(confirm);
    await waitFor(() => expect(cancelLock).toHaveBeenCalledWith('lock-1', 'mutual'));
    expect(refresh).toHaveBeenCalled();
  });
});

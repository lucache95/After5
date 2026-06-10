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
// vaul renders into a portal; passthrough so drawer content is queryable. Root
// respects `open` so "tap → the sheet appears" is a real assertion (not
// trivially-true always-rendered content).
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Root = ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <div>{children}</div> : null;
  return { Drawer: Object.assign(Pass, { Root, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});
// NightDetailSheet imports the browser client + get_night_detail; the lock surface
// must NEVER call the pre-lock RPC (its WHERE excludes locked nights) — preloaded only.
const getNightDetail = vi.fn();
vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({}),
  getNightDetail: (...a: unknown[]) => getNightDetail(...a),
}));
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
import type { NightDetailNight, NightDetailStop } from '@/lib/after5/client';

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

// The full get_lock_night_detail row (normalized server-side) that page.tsx
// threads in as `night` for the full-plan sheet.
function nightDetail(over: Partial<NightDetailNight> = {}): NightDetailNight {
  return {
    date_instance_id: 'di-1',
    time_window_start: '2026-06-01T19:00:00Z',
    pay_setting: null, vibe_tags: ['hiking'], why_note: null, hook: 'the hook',
    why_it_works: null, cover_image_url: null, title: 'jazz bar + late night ramen',
    venue_neighborhood: null, is_seed: false, total_cost_pp: 40, total_duration_min: 120,
    stops: [stop({ name: 'rooftop bar' })], ...over,
  };
}

beforeEach(() => { cancelLock.mockReset(); refresh.mockReset(); toastFn.mockReset(); toastError.mockReset(); getNightDetail.mockReset(); });

describe('LockDetail', () => {
  it('opens the reveal modal from the "see their profile" trigger', async () => {
    render(<LockDetail {...props()} />);
    await userEvent.click(screen.getByRole('button', { name: /see their profile/i }));
    // the hero h1 reads "jamie, 28" AND the opened ProfileCard repeats it
    // (vaul is a passthrough mock, so presence + the working trigger is the contract).
    expect(screen.getAllByText('jamie, 28').length).toBeGreaterThan(1);
  });

  it('the reveal hero shows name + age and the initial-avatar fallback when no photo', () => {
    render(<LockDetail {...props()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'jamie, 28' })).toBeInTheDocument();
    // no signed photo → brand initial avatar inside the polaroid, never a blank
    expect(screen.getByText('j')).toBeInTheDocument();
  });

  it('message is the one primary; see their profile stays quiet secondary', () => {
    render(<LockDetail {...props()} />);
    const message = screen.getByRole('link', { name: /message jamie/i });
    const profile = screen.getByRole('button', { name: /see their profile/i });
    expect(message.className).toContain('bg-shell-accent');
    expect(profile.className).not.toContain('bg-shell-accent');
    expect(profile.className).not.toContain('bg-shell-pink');
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
    render(<LockDetail {...props({ nightTitle: 'jazz bar + late night ramen', stops: [
      stop({ name: 'rooftop bar', cost_pp: 22 }),
      stop({ name: 'late-night ramen', cost_pp: 0 }),
    ] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'jazz bar + late night ramen' })).toBeInTheDocument();
    expect(screen.getByText('rooftop bar')).toBeInTheDocument();
    expect(screen.getByText('late-night ramen')).toBeInTheDocument();
    // a real night never shows the degrade copy
    expect(screen.queryByText("plan's being put together.")).not.toBeInTheDocument();
  });

  it('shows the degrade copy when a lock has no stops (never a blank section)', () => {
    render(<LockDetail {...props({ stops: [] })} />);
    expect(screen.getByText('the night')).toBeInTheDocument();
    expect(screen.getByText("plan's being put together.")).toBeInTheDocument();
  });

  it('active lock cancel flow calls cancelLock with the chosen reason', async () => {
    cancelLock.mockResolvedValue(null);
    render(<LockDetail {...props({ status: 'active' })} />);
    // Open the cancel drawer from the detail-screen trigger first (the vaul Root
    // mock respects `open`), then pick a reason and click the picker's confirm —
    // both buttons read "cancel this date"; the confirm is the LAST one.
    await userEvent.click(screen.getByRole('button', { name: /^cancel this date$/i }));
    await userEvent.click(screen.getByRole('radio', { name: /both of us called it off/i }));
    const buttons = screen.getAllByRole('button', { name: /^cancel this date$/i });
    const confirm = buttons[buttons.length - 1];
    await userEvent.click(confirm);
    await waitFor(() => expect(cancelLock).toHaveBeenCalledWith('lock-1', 'mutual'));
    expect(refresh).toHaveBeenCalled();
  });

  // ——— founder rule: tapping a night preview opens the FULL date-plan view ———

  it('"the night" header is a real button that opens the full-plan sheet (preloaded, no RPC)', async () => {
    render(<LockDetail {...props({
      nightTitle: 'jazz bar + late night ramen',
      stops: [stop({ name: 'rooftop bar' })],
      night: nightDetail(),
    })} />);
    // sheet content is NOT in the DOM before the tap (Root respects open)
    expect(screen.getAllByText('jazz bar + late night ramen')).toHaveLength(1);
    const btn = screen.getByRole('button', { name: /see the full plan/i });
    await userEvent.click(btn);
    // the sheet's hero title + timeline stop render alongside the inline card's
    expect(screen.getAllByText('jazz bar + late night ramen').length).toBeGreaterThan(1);
    expect(screen.getAllByText('rooftop bar').length).toBeGreaterThan(1);
    // post-lock surface NEVER calls the pre-lock get_night_detail RPC
    expect(getNightDetail).not.toHaveBeenCalled();
  });

  it('no night detail row → no full-plan button (static header, never a dead tap)', () => {
    render(<LockDetail {...props({ nightTitle: 'jazz bar + late night ramen', night: null })} />);
    expect(screen.queryByRole('button', { name: /see the full plan/i })).not.toBeInTheDocument();
    expect(screen.getByText('the night')).toBeInTheDocument();
  });
});

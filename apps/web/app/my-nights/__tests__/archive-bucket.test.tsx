// apps/web/app/my-nights/__tests__/archive-bucket.test.tsx
// E25 (D-02 scoped): the /my-nights upcoming/archive segment toggle.
// Locks the bucket contract over date_instances.status:
//   upcoming = seeking | matched | active
//   archive  = completed | expired | cancelled
// plus the funny empty-archive copy (UI-SPEC §Copywriting, verbatim).
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// NightCardActions is a client leaf that reads useRouter for its cancel/edit
// refresh; the segment renders it on seeking cards, so stub the router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} data-testid="cover" />,
}));

import { NightsSegments, bucketForStatus, type NightRow } from '../NightsSegments';

function night(id: string, status: string): NightRow {
  return {
    id,
    starts_at: '2026-06-10T19:00:00Z',
    status,
    duration_min: 120,
    venue_id: null,
    ambient_sound_id: null,
    itinerary: { title: `${status} night`, cover_image_url: null, inputs: null },
  };
}

// A fixture set spanning all 6 statuses so both buckets are exercised.
const ALL_STATUSES = ['seeking', 'matched', 'active', 'completed', 'expired', 'cancelled'];
const fixtures = ALL_STATUSES.map((s) => night(`inst-${s}`, s));

const noCounts: Record<string, number> = {};

describe('bucketForStatus', () => {
  it('buckets the three live statuses as upcoming', () => {
    expect(bucketForStatus('seeking')).toBe('upcoming');
    expect(bucketForStatus('matched')).toBe('upcoming');
    expect(bucketForStatus('active')).toBe('upcoming');
  });

  it('buckets the three terminal statuses as archive', () => {
    expect(bucketForStatus('completed')).toBe('archive');
    expect(bucketForStatus('expired')).toBe('archive');
    expect(bucketForStatus('cancelled')).toBe('archive');
  });

  it('returns null for an unknown status', () => {
    expect(bucketForStatus('mystery')).toBeNull();
  });
});

describe('NightsSegments — upcoming/archive toggle', () => {
  it('defaults to upcoming and shows only seeking/matched/active', () => {
    render(<NightsSegments nights={fixtures} counts={noCounts} venues={[]} ambientSounds={[]} />);

    // The upcoming tab is selected by default.
    const upcomingTab = screen.getByRole('tab', { name: 'upcoming' });
    expect(upcomingTab).toHaveAttribute('aria-selected', 'true');

    // Live statuses render their titles; archive ones do not.
    expect(screen.getByText('seeking night')).toBeInTheDocument();
    expect(screen.getByText('matched night')).toBeInTheDocument();
    expect(screen.getByText('active night')).toBeInTheDocument();
    expect(screen.queryByText('completed night')).not.toBeInTheDocument();
    expect(screen.queryByText('expired night')).not.toBeInTheDocument();
    expect(screen.queryByText('cancelled night')).not.toBeInTheDocument();
  });

  it('switching to archive shows only completed/expired/cancelled', async () => {
    const user = userEvent.setup();
    render(<NightsSegments nights={fixtures} counts={noCounts} venues={[]} ambientSounds={[]} />);

    await user.click(screen.getByRole('tab', { name: 'archive' }));

    expect(screen.getByRole('tab', { name: 'archive' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('completed night')).toBeInTheDocument();
    expect(screen.getByText('expired night')).toBeInTheDocument();
    expect(screen.getByText('cancelled night')).toBeInTheDocument();
    expect(screen.queryByText('seeking night')).not.toBeInTheDocument();
    expect(screen.queryByText('matched night')).not.toBeInTheDocument();
    expect(screen.queryByText('active night')).not.toBeInTheDocument();
  });

  it('shows the funny empty state when the archive bucket is empty', async () => {
    const user = userEvent.setup();
    // Only upcoming statuses → archive bucket is empty.
    const liveOnly = [night('inst-1', 'seeking'), night('inst-2', 'matched')];
    render(<NightsSegments nights={liveOnly} counts={noCounts} venues={[]} ambientSounds={[]} />);

    await user.click(screen.getByRole('tab', { name: 'archive' }));

    expect(screen.getByText('nothing in the rear-view yet')).toBeInTheDocument();
    expect(
      screen.getByText('your past nights and matches land here once they wrap.'),
    ).toBeInTheDocument();
  });

  it('renders both segment controls as >=44px tap targets', () => {
    render(<NightsSegments nights={fixtures} counts={noCounts} venues={[]} ambientSounds={[]} />);
    for (const name of ['upcoming', 'archive']) {
      const tab = screen.getByRole('tab', { name });
      expect(tab.className).toContain('min-h-[44px]');
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/image renders nothing useful in jsdom (and `fill` warns); stub to a plain img.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));

import { PlanTimeline } from '../PlanTimeline';
import type { NightDetailStop } from '@/lib/after5/client';

function stop(over: Partial<NightDetailStop>): NightDetailStop {
  return {
    name: 'a spot', type: null, start_time: null, duration_min: null,
    cost_pp: null, what_to_do: null, neighborhood: null, local_insight: null,
    photo_url: null, lat: null, lng: null, drive_to_next_min: null,
    ...over,
  };
}

describe('PlanTimeline', () => {
  it('renders one numbered row per stop with names and cost', () => {
    const stops = [
      stop({ name: 'rooftop bar', cost_pp: 22 }),
      stop({ name: 'late-night ramen', cost_pp: 0 }),
      stop({ name: 'riverwalk', cost_pp: 14 }),
    ];
    const { container } = render(<PlanTimeline stops={stops} accent="#ff00aa" vibeTags={['chill']} />);

    // one <li> per stop
    expect(container.querySelectorAll('li').length).toBe(3);
    expect(screen.getByText('rooftop bar')).toBeInTheDocument();
    expect(screen.getByText('late-night ramen')).toBeInTheDocument();
    expect(screen.getByText('riverwalk')).toBeInTheDocument();
    // cost: positive renders "$N pp", zero renders "free"
    expect(screen.getByText(/\$22 pp/)).toBeInTheDocument();
    expect(screen.getByText('free')).toBeInTheDocument();
    expect(screen.getByText(/\$14 pp/)).toBeInTheDocument();
  });

  it('renders no rows for an empty stops array (no crash)', () => {
    const { container } = render(<PlanTimeline stops={[]} accent="#ff00aa" vibeTags={null} />);
    expect(container.querySelectorAll('li').length).toBe(0);
  });

  it('normalizes a thin/rich shape via raw stops (place_name/place_type)', () => {
    // Caller may pass already-normalized stops; PlanTimeline must render names as given.
    const stops = [stop({ name: 'jazz cellar', type: 'bar', neighborhood: 'alberta' })];
    render(<PlanTimeline stops={stops} accent="#ff00aa" vibeTags={['jazz']} />);
    expect(screen.getByText('jazz cellar')).toBeInTheDocument();
    expect(screen.getByText(/alberta/)).toBeInTheDocument();
  });
});

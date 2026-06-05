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
    photo_url: null, lat: null, lng: null, place_slug: null, drive_to_next_min: null,
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

  // E20 — per-stop coord deep-links --------------------------------------------
  it('uses a coord deep-link for the map link when lat/lng are present', () => {
    const stops = [stop({ name: 'rooftop bar', lat: 49.888, lng: -119.496 })];
    render(<PlanTimeline stops={stops} accent="#ff00aa" vibeTags={null} />);
    const link = screen.getByRole('link', { name: /map/i });
    expect(link).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=49.888,-119.496',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('falls back to a name search for the map link when coords are absent', () => {
    const stops = [stop({ name: 'rooftop bar', lat: null, lng: null })];
    render(<PlanTimeline stops={stops} accent="#ff00aa" vibeTags={null} />);
    const link = screen.getByRole('link', { name: /map/i });
    expect(link.getAttribute('href')).toContain('query=rooftop%20bar');
    expect(link.getAttribute('href')).not.toContain('query=49');
  });

  // E21 — opt-in /places slug link (default OFF, blind contract) ----------------
  it('does NOT link the stop name to /places by default (blind contract)', () => {
    const stops = [stop({ name: 'jazz cellar', place_slug: 'jazz-cellar' })];
    const { container } = render(
      <PlanTimeline stops={stops} accent="#ff00aa" vibeTags={null} />,
    );
    // the name is plain text, never a /places anchor
    expect(container.querySelector('a[href^="/places/"]')).toBeNull();
    expect(screen.getByText('jazz cellar').closest('a')).toBeNull();
  });

  it('links the stop name to /places/[slug] when linkSlugs=true AND a slug is present', () => {
    const stops = [stop({ name: 'jazz cellar', place_slug: 'jazz-cellar' })];
    render(<PlanTimeline stops={stops} accent="#ff00aa" vibeTags={null} linkSlugs />);
    const nameLink = screen.getByRole('link', { name: 'jazz cellar' });
    expect(nameLink).toHaveAttribute('href', '/places/jazz-cellar');
  });

  it('renders the stop name as plain text when linkSlugs=true but the slug is absent (graceful degrade)', () => {
    const stops = [stop({ name: 'mystery spot', place_slug: null })];
    const { container } = render(
      <PlanTimeline stops={stops} accent="#ff00aa" vibeTags={null} linkSlugs />,
    );
    expect(container.querySelector('a[href^="/places/"]')).toBeNull();
    expect(screen.getByText('mystery spot').closest('a')).toBeNull();
  });
});

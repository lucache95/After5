import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/image needs a plain <img> in jsdom (no Next loader/optimizer here). Drop
// the Next-only boolean props (fill/priority) so React doesn't warn about
// non-boolean DOM attributes.
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

import { NightCard } from '../NightCard';
import type { FeedNight } from '@/lib/after5/client';

const base = (over: Partial<FeedNight> = {}): FeedNight => ({
  date_instance_id: 'd1',
  city_id: 'c1',
  time_window_start: new Date(Date.now() + 86400000).toISOString(),
  pay_setting: null,
  vibe_tags: ['chill'],
  why_note: 'low-key night',
  cover_image_url: null,
  title: 'pottery + ramen',
  venue_neighborhood: 'downtown',
  is_seed: false,
  distance_m: 1200,
  ambient_sound_path: null,
  ambient_sound_name: null,
  fit: false,
  ...over,
});

const PILL = /looks for someone like you/i;

describe('NightCard fit pill (D-03)', () => {
  it('renders the fit pill when night.fit === true', () => {
    render(<NightCard night={base({ fit: true })} />);
    expect(screen.getByText(PILL)).toBeInTheDocument();
  });

  it('renders no pill when night.fit === false', () => {
    render(<NightCard night={base({ fit: false })} />);
    expect(screen.queryByText(PILL)).not.toBeInTheDocument();
  });

  it('never shows a score or percentage in the pill', () => {
    render(<NightCard night={base({ fit: true })} />);
    const pill = screen.getByText(PILL);
    expect(pill.textContent ?? '').not.toMatch(/\d/);
    expect(pill.textContent ?? '').not.toMatch(/%/);
  });

  it('coexists with the curated badge without replacing it (both render)', () => {
    render(<NightCard night={base({ fit: true, is_seed: true })} />);
    expect(screen.getByText(/curated/i)).toBeInTheDocument();
    expect(screen.getByText(PILL)).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchesList, type MatchCard } from '../MatchesList';
import type { PartyProfile } from '../lock-view';

const person = (over: Partial<PartyProfile> = {}): PartyProfile => ({
  id: 'p1', first_name: 'jamie', age: 28, city: 'pdx', neighborhood: null, clear_photo_url: null, vibe_tags: [], ...over,
});

const card = (over: Partial<MatchCard> = {}): MatchCard => ({
  id: 'lock-1', status: 'active', counterpart: person(), startsAt: '2026-06-01T19:00:00Z', ...over,
});

describe('MatchesList', () => {
  it('renders active + past buckets with counterpart name + status label', () => {
    render(
      <MatchesList
        active={[card({ id: 'a1', status: 'active', counterpart: person({ first_name: 'jamie' }) })]}
        past={[card({ id: 'p1', status: 'completed', counterpart: person({ id: 'q', first_name: 'alex' }) })]}
      />,
    );
    // each name appears at least once (may also appear in the polaroid placeholder)
    expect(screen.getAllByText('jamie').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('alex').length).toBeGreaterThanOrEqual(1);
    // status pill on the active card (the "locked in" section header also exists)
    expect(screen.getAllByText('locked in').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('links each card to /matches/<id>', () => {
    render(<MatchesList active={[card({ id: 'lock-9' })]} past={[]} />);
    const link = screen.getByRole('link', { name: /jamie/i });
    expect(link).toHaveAttribute('href', '/matches/lock-9');
  });

  it('shows empty state with feed link when there are no locks', () => {
    render(<MatchesList active={[]} past={[]} />);
    expect(screen.getByText('no locked dates yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse dates/i })).toHaveAttribute('href', '/feed');
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MatchesList, type MatchCard } from '../MatchesList';
import type { PartyProfile } from '../lock-view';

const person = (over: Partial<PartyProfile> = {}): PartyProfile => ({
  id: 'p1', first_name: 'jamie', age: 28, city: 'pdx', neighborhood: null, clear_photo_url: null, vibe_tags: [], ...over,
});

const card = (over: Partial<MatchCard> = {}): MatchCard => ({
  id: 'lock-1', status: 'active', counterpart: person(), startsAt: '2026-06-01T19:00:00Z',
  nightTitle: 'golden hour walk', ratable: false, ...over,
});

describe('MatchesList', () => {
  it('renders upcoming + past sections with counterpart name, night title + status chip', () => {
    render(
      <MatchesList
        upcoming={[card({ id: 'a1', status: 'active', counterpart: person({ first_name: 'jamie' }) })]}
        past={[card({ id: 'p1', status: 'completed', counterpart: person({ id: 'q', first_name: 'alex' }), nightTitle: 'rooftop wine' })]}
      />,
    );
    // lowercase section headers, upcoming first
    expect(screen.getByRole('heading', { name: 'upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'past' })).toBeInTheDocument();
    expect(screen.getByText('jamie')).toBeInTheDocument();
    expect(screen.getByText('alex')).toBeInTheDocument();
    // the night sells itself on the card
    expect(screen.getByText('golden hour walk')).toBeInTheDocument();
    expect(screen.getByText('rooftop wine')).toBeInTheDocument();
    // status chips
    expect(screen.getByText('upcoming', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('links each card to /matches/<id>', () => {
    render(<MatchesList upcoming={[card({ id: 'lock-9' })]} past={[]} />);
    const link = screen.getByRole('link', { name: /your date with jamie/i });
    expect(link).toHaveAttribute('href', '/matches/lock-9');
  });

  it('swaps the chip for a rate CTA linking to /matches/<id>/rate when ratable', () => {
    render(<MatchesList upcoming={[]} past={[card({ id: 'lock-7', status: 'completed', ratable: true })]} />);
    const rate = screen.getByRole('link', { name: /rate it/i });
    expect(rate).toHaveAttribute('href', '/matches/lock-7/rate');
    // the chip gave way to the CTA
    expect(screen.queryByText('done')).not.toBeInTheDocument();
  });

  it('falls back to the brand initial avatar when there is no clear photo — never a name-stamped polaroid', () => {
    render(<MatchesList upcoming={[card({ counterpart: person({ first_name: 'jamie', clear_photo_url: null }) })]} past={[]} />);
    // no photo → no <img> at all; the pink-wash initial carries the avatar
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('j')).toBeInTheDocument();
    // the name renders ONCE (the heading) — not stamped inside the frame too
    expect(screen.getAllByText('jamie')).toHaveLength(1);
  });

  it('renders the clear photo when present (post-lock, clear is correct)', () => {
    render(
      <MatchesList
        upcoming={[card({ counterpart: person({ clear_photo_url: '/places/place-walk.jpg' }) })]}
        past={[]}
      />,
    );
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toContain('place-walk');
  });

  it('shows empty state with the feed CTA when there are no locks', () => {
    render(<MatchesList upcoming={[]} past={[]} />);
    expect(screen.getByText('no matches yet.')).toBeInTheDocument();
    expect(screen.getByText('the nights are waiting.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse tonight's nights/i })).toHaveAttribute('href', '/feed');
  });
});

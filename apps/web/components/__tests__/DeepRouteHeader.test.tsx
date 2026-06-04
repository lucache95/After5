// REQ-E1 / D-07-nav / D-08 — the shared deep-route back-chrome primitive.
// Asserts: (1) the back control is a next/link <a href={backHref}> with the
// accessible name {backLabel}, (2) the optional title renders when passed and is
// absent when omitted, (3) the optional right slot renders, and (4) jest-axe
// reports zero a11y violations (labelled control, focus ring, ink-on-cream).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';

import { DeepRouteHeader } from '../DeepRouteHeader';

describe('DeepRouteHeader — deterministic static back chrome (D-08)', () => {
  it('renders the back control as a link to the STATIC backHref with the a11y label', () => {
    render(<DeepRouteHeader backHref="/matches" backLabel="back to matches" />);
    const back = screen.getByRole('link', { name: 'back to matches' });
    expect(back).toHaveAttribute('href', '/matches');
  });

  it('renders the optional title when passed', () => {
    render(<DeepRouteHeader backHref="/inbox" backLabel="back to inbox" title="jamie" />);
    expect(screen.getByRole('heading', { name: 'jamie' })).toBeInTheDocument();
  });

  it('renders no heading node when title is omitted', () => {
    render(<DeepRouteHeader backHref="/inbox" backLabel="back to inbox" />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders the optional right slot', () => {
    render(
      <DeepRouteHeader
        backHref="/matches"
        backLabel="back to matches"
        right={<button type="button">rate</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'rate' })).toBeInTheDocument();
  });

  it('has no a11y violations (labelled control, ink-on-cream)', async () => {
    const { container } = render(
      <DeepRouteHeader backHref="/inbox" backLabel="back to inbox" title="your match" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

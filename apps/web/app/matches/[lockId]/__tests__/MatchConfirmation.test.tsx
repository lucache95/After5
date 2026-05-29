import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useReducedMotion = vi.fn();
vi.mock('framer-motion', () => ({
  useReducedMotion: () => useReducedMotion(),
  motion: { span: (props: Record<string, unknown>) => <span {...props} /> },
}));

import { MatchConfirmation } from '../MatchConfirmation';

beforeEach(() => { useReducedMotion.mockReset(); });

describe('MatchConfirmation', () => {
  it('announces the match via role=status and renders NO particles under reduced motion', () => {
    useReducedMotion.mockReturnValue(true);
    const { container } = render(<MatchConfirmation name="jamie" show />);
    expect(screen.getByRole('status')).toHaveTextContent('you matched with jamie');
    // particles live in an aria-hidden decorative layer; none under reduced motion
    expect(container.querySelectorAll('[aria-hidden="true"] span').length).toBe(0);
  });

  it('renders aria-hidden particles when motion is allowed', () => {
    useReducedMotion.mockReturnValue(false);
    const { container } = render(<MatchConfirmation name="jamie" show />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"] span').length).toBeGreaterThan(0);
  });

  it('renders nothing when show is false', () => {
    useReducedMotion.mockReturnValue(true);
    const { container } = render(<MatchConfirmation name="jamie" show={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});

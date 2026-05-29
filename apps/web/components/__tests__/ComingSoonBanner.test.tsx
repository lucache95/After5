import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoonBanner } from '../ComingSoonBanner';

describe('ComingSoonBanner', () => {
  it('shows the dry lowercase coming-soon copy', () => {
    render(<ComingSoonBanner />);
    expect(screen.getByRole('heading', { name: /matching launches soon/i })).toBeInTheDocument();
  });
  it('accepts a custom note', () => {
    render(<ComingSoonBanner note="hang tight" />);
    expect(screen.getByText(/hang tight/i)).toBeInTheDocument();
  });
});

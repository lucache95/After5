import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { PolaroidLoader } from './PolaroidLoader';

describe('PolaroidLoader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the city-aware heading and first caption', () => {
    render(<PolaroidLoader city="Vernon" />);
    expect(
      screen.getByRole('heading', { name: /flipping through every vernon spot/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/pulling vetted vernon spots/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 9/i)).toBeInTheDocument();
  });

  it('falls back to a generic city when none is passed', () => {
    render(<PolaroidLoader />);
    expect(
      screen.getByRole('heading', { name: /flipping through every your city spot/i }),
    ).toBeInTheDocument();
  });

  it('cycles to a later caption as time advances', () => {
    render(<PolaroidLoader city="kelowna" />);
    expect(screen.getByText(/pulling vetted kelowna spots/i)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/step 4 of 9/i)).toBeInTheDocument();
  });
});

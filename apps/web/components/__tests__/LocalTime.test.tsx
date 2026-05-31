// apps/web/components/__tests__/LocalTime.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocalTime } from '../LocalTime';

describe('LocalTime', () => {
  it('renders a formatted date string for a valid ISO input', () => {
    const { container } = render(
      <LocalTime iso="2026-06-04T00:40:00Z" opts={{ month: 'short', day: 'numeric', hour: 'numeric' }} />,
    );
    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    // Text must be non-empty and must not be the fallback.
    expect(span!.textContent).not.toBe('');
    expect(span!.textContent).not.toBe('date tbd');
  });

  it('renders the default fallback when iso is null', () => {
    render(<LocalTime iso={null} />);
    expect(screen.getByText('date tbd')).toBeInTheDocument();
  });

  it('renders a custom fallback when iso is null', () => {
    render(<LocalTime iso={null} fallback="time unknown" />);
    expect(screen.getByText('time unknown')).toBeInTheDocument();
  });

  it('renders the fallback for an invalid date string', () => {
    render(<LocalTime iso="not-a-date" fallback="invalid" />);
    expect(screen.getByText('invalid')).toBeInTheDocument();
  });

  it('forwards className to the span', () => {
    const { container } = render(<LocalTime iso="2026-06-04T00:40:00Z" className="text-sm" />);
    const span = container.querySelector('span');
    expect(span).toHaveClass('text-sm');
  });
});

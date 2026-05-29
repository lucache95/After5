import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Phase7Placeholder } from '../Phase7Placeholder';

describe('Phase7Placeholder', () => {
  it('renders the exact headline + body copy in a labelled region', () => {
    render(<Phase7Placeholder />);
    const region = screen.getByRole('region', { name: 'messages' });
    expect(region).toBeInTheDocument();
    expect(screen.getByText('messages coming with phase 7')).toBeInTheDocument();
    expect(screen.getByText(/swap numbers off-platform/i)).toBeInTheDocument();
  });
});

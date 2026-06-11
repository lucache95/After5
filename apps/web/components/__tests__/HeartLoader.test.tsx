import { render, screen } from '@testing-library/react';
import { FullScreenHeartLoader, HeartLoader } from '../HeartLoader';
import { PendingButtonContent } from '../PendingButtonContent';

describe('HeartLoader', () => {
  it('renders an indeterminate busy progressbar with the requested label', () => {
    render(<HeartLoader size={32} accessibilityLabel="finding matches" />);

    const loader = screen.getByRole('progressbar', { name: 'finding matches' });
    expect(loader).toHaveAttribute('aria-busy', 'true');
    expect(loader).toHaveStyle({ width: '32px', height: '32px' });
  });

  it('supports a full-screen route loading wrapper', () => {
    render(<FullScreenHeartLoader accessibilityLabel="loading date" />);

    expect(screen.getByTestId('fullscreen-heart-loader')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('progressbar', { name: 'loading date' })).toBeInTheDocument();
  });

  it('renders pending button content with an inherited-color loader', () => {
    render(
      <button type="button">
        <PendingButtonContent pending pendingLabel="saving" accessibilityLabel="saving preferences">
          save
        </PendingButtonContent>
      </button>,
    );

    expect(screen.getByRole('progressbar', { name: 'saving preferences' })).toBeInTheDocument();
    expect(screen.getByText('saving')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// next/image → plain img in jsdom.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...(props as Record<string, never>)} />;
  },
}));

// PhotoCropper is heavy (canvas) — stub it.
vi.mock('@/app/onboarding/steps/PhotoCropper', () => ({
  PhotoCropper: () => <div data-testid="cropper" />,
}));

let reducedMotion = false;
vi.mock('framer-motion', () => ({
  Reorder: {
    Group: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
    Item: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
  },
  useReducedMotion: () => reducedMotion,
}));

import { PhotoManager } from '../PhotoManager';

const PHOTOS = [
  { id: 'p1', clear_path: 'u/p1.jpg', url: 'https://x/p1', is_primary: true, sort_order: 0 },
  { id: 'p2', clear_path: 'u/p2.jpg', url: 'https://x/p2', is_primary: false, sort_order: 1 },
  { id: 'p3', clear_path: 'u/p3.jpg', url: 'https://x/p3', is_primary: false, sort_order: 2 },
];

describe('PhotoManager', () => {
  beforeEach(() => { reducedMotion = false; });

  it('renders a tile per photo plus an add affordance, with a main badge on the primary', () => {
    render(<PhotoManager photos={PHOTOS} onRemove={vi.fn()} onReorder={vi.fn()} onSetPrimary={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(3);
    expect(screen.getByText('main')).toBeInTheDocument();
    expect(screen.getByLabelText(/add a photo/i)).toBeInTheDocument();
  });

  it('remove button calls onRemove with the photo id', () => {
    const onRemove = vi.fn();
    render(<PhotoManager photos={PHOTOS} onRemove={onRemove} onReorder={vi.fn()} onSetPrimary={vi.fn()} onAdd={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: /remove photo/i })[1]);
    expect(onRemove).toHaveBeenCalledWith('p2');
  });

  it('renders without crashing under reduced motion', () => {
    reducedMotion = true;
    render(<PhotoManager photos={PHOTOS} onRemove={vi.fn()} onReorder={vi.fn()} onSetPrimary={vi.fn()} onAdd={vi.fn()} />);
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/image is a real module in jsdom; stub to a plain img so renders don't
// complain about the test environment lacking a Next.js image loader.
vi.mock('next/image', () => ({
  default: ({ src, alt, ...rest }: { src: string; alt: string; [k: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...rest} />
  ),
}));
// next/link — passthrough stub.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { Polaroid } from '../Polaroid';

describe('Polaroid', () => {
  it('renders an image when src is a valid URL', () => {
    render(<Polaroid src="https://example.com/photo.jpg" alt="Test photo" />);
    expect(screen.getByRole('img', { name: 'Test photo' })).toBeInTheDocument();
  });

  it('shows the gradient placeholder (no crash) when src is an empty string', () => {
    render(<Polaroid src="" alt="jamie" label="jamie" />);
    // No <img> should be rendered — we never forward '' to next/image.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // The label/alt text should appear at least once (in gradient span; label <p> also renders).
    expect(screen.getAllByText('jamie').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the gradient placeholder (no crash) when src is null', () => {
    render(<Polaroid src={null} alt="alex" label="alex" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByText('alex').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the gradient placeholder (no crash) when src is undefined', () => {
    render(<Polaroid src={undefined} alt="sam" label="sam" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getAllByText('sam').length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to alt text in placeholder when label is omitted', () => {
    render(<Polaroid src="" alt="no label person" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('no label person')).toBeInTheDocument();
  });
});

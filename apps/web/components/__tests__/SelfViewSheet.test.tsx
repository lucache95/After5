import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// vaul renders into a portal; stub to a prop-passthrough so the Drawer.Content
// classes/structure are queryable in jsdom (jsdom can't exercise real drag/scroll).
vi.mock('vaul', () => {
  const Pass = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div {...(props as Record<string, never>)}>{children}</div>
  );
  return {
    Drawer: Object.assign(Pass, {
      Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass,
      Content: Pass, Title: Pass, Description: Pass, Close: Pass,
    }),
  };
});
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));

import { SelfViewSheet } from '../SelfViewSheet';

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  name: 'Maya',
  age: 29,
  place: 'glenmore',
  photos: ['https://x/1', 'https://x/2'],
  vibe_tags: ['trails'],
  prompts: [{ label: 'my roman empire', answer: 'the 2013 grammys' }],
};

describe('SelfViewSheet', () => {
  it('renders the ProfileCard content inside the sheet', () => {
    render(<SelfViewSheet {...baseProps} />);
    expect(screen.getByRole('heading', { name: /maya, 29/i })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText(/my roman empire/i)).toBeInTheDocument();
    expect(screen.getByText(/the 2013 grammys/i)).toBeInTheDocument();
  });

  it('keeps Drawer.Content non-scrolling and scrolls via an inner div (vaul height bug)', () => {
    render(<SelfViewSheet {...baseProps} />);
    // vaul sets touch-action:none on Drawer.Content and treats a scrollable
    // role="dialog" as a drag target, so Content must be a capped flex column
    // (overflow-hidden) and the body must scroll in a child div.
    const content = screen.getByLabelText('as others see it');
    expect(content.className).toContain('max-h-[92dvh]');
    expect(content.className).toContain('overflow-hidden');
    expect(content.className).not.toContain('overflow-y-auto');
    const scroller = content.querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toContain('min-h-0');
    expect(scroller!.className).toContain('flex-1');
    // the full content (prompt card) lives inside the scrollable region
    expect(scroller!.textContent).toMatch(/my roman empire/i);
  });

  it('never receives or renders instagram/PII', () => {
    const { container } = render(<SelfViewSheet {...baseProps} />);
    expect(container.textContent).not.toMatch(/@/);
  });
});

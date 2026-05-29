import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The bell affordance is the NotificationCenter trigger; the badge is seeded from
// the SSR unread count. This verifies the header wiring contract (Task 7 / G-1)
// without booting the async server component: the center renders an accessible
// bell with the seeded count.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/after5/realtime', () => ({ subscribeNotifications: () => () => {} }));
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Pass, { Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});

import { NotificationCenter } from '../NotificationCenter';

describe('notification header affordance', () => {
  it('renders an accessible bell trigger', () => {
    render(<NotificationCenter userId="u1" initialCount={0} />);
    expect(screen.getByLabelText('notifications')).toBeInTheDocument();
  });

  it('seeds the badge from the SSR unread count', () => {
    render(<NotificationCenter userId="u1" initialCount={4} />);
    expect(screen.getByLabelText('4 unread notifications')).toHaveTextContent('4');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/after5/realtime', () => ({ subscribeNotifications: () => () => {} }));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('vaul', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { Drawer: Object.assign(Pass, { Root: Pass, Trigger: Pass, Portal: Pass, Overlay: Pass, Content: Pass, Title: Pass, Description: Pass, Close: Pass }) };
});

import { NotificationCenter } from '../NotificationCenter';
import { NotificationBadge } from '../NotificationBadge';
import { PreferencesForm } from '../../app/account/notifications/PreferencesForm';

describe('notification surfaces a11y', () => {
  it('NotificationCenter (bell + sheet) has no violations', async () => {
    const { container } = render(<NotificationCenter userId="u1" initialCount={3} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('NotificationBadge announces its unread count', async () => {
    const { container } = render(<NotificationBadge userId="u1" initialCount={5} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('PreferencesForm (all-on defaults) has no violations', async () => {
    const { container } = render(<PreferencesForm userId="u1" initial={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('PreferencesForm (quiet hours set) has no violations', async () => {
    const { container } = render(
      <PreferencesForm
        userId="u1"
        initial={{
          push_enabled: true, email_enabled: false, offers_enabled: true, matches_enabled: true,
          messages_enabled: false, reminders_enabled: true, account_enabled: true,
          quiet_hours_start: '22:00', quiet_hours_end: '07:00',
        }}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

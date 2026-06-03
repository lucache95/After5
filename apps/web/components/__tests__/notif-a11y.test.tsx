import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'jest-axe';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/after5/realtime', () => ({ subscribeNotifications: () => () => {} }));
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => ({ from: () => ({ upsert: async () => ({ error: null }) }) }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
// framer-motion passthrough so motion.li renders as a plain <li> in jsdom.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...rest }: { children?: React.ReactNode }) => <li {...rest}>{children}</li> }),
  useReducedMotion: () => true,
}));

import { ActivityList } from '../../app/inbox/ActivityList';
import { InboxTabBadge } from '../InboxTabBadge';
import { PreferencesForm } from '../../app/account/notifications/PreferencesForm';
import type { ActivityItem } from '@/lib/after5/inbox-activity';

const items: ActivityItem[] = [
  { kind: 'single', id: 'n1', type: 'new_match', payload: { lock_id: 'l1' }, read_at: null, created_at: '2026-06-01T10:00:00Z' },
  { kind: 'group', id: 'interest_received:d1', type: 'interest_received', ids: ['a', 'b', 'c'], count: 3, groupKey: 'd1', created_at: '2026-06-01T09:00:00Z', anyUnread: true, payload: { date_instance_id: 'd1' } },
];

describe('inbox notification surfaces a11y', () => {
  it('ActivityList has no violations', async () => {
    const { container } = render(<ActivityList userId="u1" initialItems={items} initialCursor={null} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('InboxTabBadge (with count) has no violations', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ total: 5 }) })) as unknown as typeof fetch;
    const { container } = render(<span className="relative"><InboxTabBadge userId="u1" /></span>);
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

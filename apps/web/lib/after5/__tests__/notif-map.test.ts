import { describe, it, expect } from 'vitest';
import { NOTIF_META, hrefForNotification, NOTIFICATION_TYPES } from '../notif-map';

describe('NOTIF_META', () => {
  it('covers all 20 notification types', () => {
    expect(NOTIFICATION_TYPES).toHaveLength(20);
    for (const t of NOTIFICATION_TYPES) {
      const meta = NOTIF_META[t];
      expect(meta).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.label).toBe(meta.label.toLowerCase());
      expect(meta.Icon).toBeTruthy();
      expect(meta.category).toBeTruthy();
    }
  });

  it('hrefForNotification never returns empty string, tolerates empty/odd payloads', () => {
    for (const t of NOTIFICATION_TYPES) {
      expect(hrefForNotification(t, {})).not.toBe('');
      expect(hrefForNotification(t, null as unknown as Record<string, unknown>)).not.toBe('');
      expect(hrefForNotification(t, { junk: 1 })).not.toBe('');
    }
  });

  it('builds deeplinks from verified payload keys', () => {
    expect(hrefForNotification('offer_received', { offer_id: 'o1' })).toBe('/offers/o1');
    expect(hrefForNotification('new_match', { lock_id: 'l1' })).toBe('/matches/l1');
    expect(hrefForNotification('reciprocal_detected', { pair_id: 'p1' })).toBe('/reciprocal/p1');
    expect(hrefForNotification('rating_request', { lock_id: 'l2' })).toBe('/matches/l2');
    // fallback when the key the route needs is absent
    expect(hrefForNotification('new_match', {})).toBe('/matches');
    expect(hrefForNotification('offer_received', {})).toBe('/feed');
    expect(hrefForNotification('account', {})).toBe('/account');
  });
});

// apps/web/lib/__tests__/admin-alerts.test.ts
import { describe, it, expect } from 'vitest';
import { formatAlertKind } from '../admin-alerts';

describe('formatAlertKind', () => {
  it('formats known kinds as title-case label', () => {
    expect(formatAlertKind('safety_job_failed')).toBe('Safety job failed');
    expect(formatAlertKind('job_missing_rpc')).toBe('Job missing rpc');
  });

  it('returns unknown kinds as-is when not in map', () => {
    expect(formatAlertKind('totally_new_kind')).toBe('Totally new kind');
  });

  it('handles empty string gracefully', () => {
    expect(formatAlertKind('')).toBe('');
  });
});

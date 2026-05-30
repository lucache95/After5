import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({
        data: { session: { user: { id: 'u1', email: 'a@b.com', user_metadata: {} } } },
        error: null,
      })),
    },
  })),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ is: async () => ({ error: null, count: 0 }) }) }),
    }),
  })),
}));
vi.mock('@/lib/email/welcome', () => ({ ensureWelcomeSent: vi.fn(async () => {}) }));

import { GET } from '../route';

function req(url: string) {
  return new Request(url) as unknown as import('next/server').NextRequest;
}

describe('auth callback redirect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to /home when no next param', async () => {
    const res = await GET(req('https://app.test/auth/callback?code=abc'));
    expect(res.headers.get('location')).toBe('https://app.test/home');
  });

  it('preserves an explicit relative next', async () => {
    const res = await GET(req('https://app.test/auth/callback?code=abc&next=/feed'));
    expect(res.headers.get('location')).toBe('https://app.test/feed');
  });

  it('rejects an absolute (open-redirect) next and falls back to /home', async () => {
    const res = await GET(req('https://app.test/auth/callback?code=abc&next=https://evil.com'));
    expect(res.headers.get('location')).toBe('https://app.test/home');
  });

  it('redirects to /login on missing code', async () => {
    const res = await GET(req('https://app.test/auth/callback'));
    expect(res.headers.get('location')).toBe('https://app.test/login?error=no_code');
  });
});

// apps/web/lib/after5/__tests__/client.test.ts
import { describe, it, expect, vi } from 'vitest';

// The browser SSR client is created by @/lib/supabase/client; browserAfter5Client
// must return exactly that instance, typed as After5Client (no second client).
vi.mock('@/lib/supabase/client', () => {
  const fake = { __brand: 'browser-ssr-client', from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() }, auth: {} };
  return { createClient: vi.fn(() => fake) };
});

describe('browserAfter5Client', () => {
  it('returns the @supabase/ssr browser client (no separate client constructed)', async () => {
    const { browserAfter5Client } = await import('../client');
    const { createClient } = await import('@/lib/supabase/client');
    const c = browserAfter5Client();
    expect((c as unknown as { __brand: string }).__brand).toBe('browser-ssr-client');
    expect(createClient).toHaveBeenCalledOnce();
  });
});

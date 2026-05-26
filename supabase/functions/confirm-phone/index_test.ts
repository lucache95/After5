import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { buildPhoneVerificationRow } from './index.ts';

Deno.test('buildPhoneVerificationRow has verified phone shape', () => {
  const row = buildPhoneVerificationRow('user-uuid-9');
  assertEquals(row.user_id, 'user-uuid-9');
  assertEquals(row.kind, 'phone');
  assertEquals(row.state, 'verified');
  assertEquals(row.provider, 'supabase_auth');
  assertEquals(typeof row.verified_at, 'string');
});

// match-cancel-lock/index.test.ts — validation (incl. reason enum) + arg-shaping.
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { handler } from './index.ts';
import { resetStub } from '../_shared/_test_supabase_stub.ts';

function setEnv() {
  Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-dummy');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-dummy');
}
const AUTHED = { Authorization: 'Bearer dummy' };
const post = (b: unknown) => new Request('http://x/', { method: 'POST', headers: AUTHED, body: JSON.stringify(b) });

Deno.test('match-cancel-lock: missing lock or reason -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({ reason: 'mutual' }))).status, 400);
  assertEquals((await handler(post({ lock: 'l-1' }))).status, 400);
});

Deno.test('match-cancel-lock: invalid reason -> 400 (enum guard)', async () => {
  setEnv();
  resetStub();
  const res = await handler(post({ lock: 'l-1', reason: 'because' }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, 'bad_request');
});

Deno.test('match-cancel-lock: valid reason shapes p_* args + mints idem_key', async () => {
  setEnv();
  const stub = resetStub({ user: { id: 'actor-1' } });
  await handler(post({ lock: 'l-1', reason: 'safety' }));
  assertEquals(stub.calls[0].name, 'match_cancel_lock');
  assertEquals(stub.calls[0].args.p_actor, 'actor-1');
  assertEquals(stub.calls[0].args.p_lock, 'l-1');
  assertEquals(stub.calls[0].args.p_reason, 'safety');
  assertEquals(typeof stub.calls[0].args.p_idem_key, 'string');
});

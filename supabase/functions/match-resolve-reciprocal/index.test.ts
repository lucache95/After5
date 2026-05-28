// match-resolve-reciprocal/index.test.ts — validation + arg-shaping.
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

Deno.test('match-resolve-reciprocal: missing pair_id or chosen_instance -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({ chosen_instance: 'i' }))).status, 400);
  assertEquals((await handler(post({ pair_id: 'p' }))).status, 400);
});

Deno.test('match-resolve-reciprocal: shapes p_actor/p_pair_id/p_chosen_instance/p_idem_key', async () => {
  setEnv();
  const stub = resetStub({ user: { id: 'actor-1' } });
  await handler(post({ pair_id: 'p-1', chosen_instance: 'i-1', idem_key: 'k-1' }));
  assertEquals(stub.calls[0].name, 'match_resolve_reciprocal');
  assertEquals(stub.calls[0].args, { p_actor: 'actor-1', p_pair_id: 'p-1', p_chosen_instance: 'i-1', p_idem_key: 'k-1' });
});

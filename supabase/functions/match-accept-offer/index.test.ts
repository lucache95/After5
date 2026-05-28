// match-accept-offer/index.test.ts — validation + arg-shaping.
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

Deno.test('match-accept-offer: missing offer -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({}))).status, 400);
});

Deno.test('match-accept-offer: shapes p_actor/p_offer/p_idem_key', async () => {
  setEnv();
  const stub = resetStub({ user: { id: 'actor-1' } });
  await handler(post({ offer: 'o-1', idem_key: 'idem-1' }));
  assertEquals(stub.calls[0].name, 'match_accept_offer');
  assertEquals(stub.calls[0].args, { p_actor: 'actor-1', p_offer: 'o-1', p_idem_key: 'idem-1' });
});

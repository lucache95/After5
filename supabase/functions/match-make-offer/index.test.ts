// match-make-offer/index.test.ts — validation + arg-shaping (incl. idem_key passthrough/mint).
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

Deno.test('match-make-offer: missing instance/candidate -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({ candidate: 'c' }))).status, 400);
  assertEquals((await handler(post({ instance: 'i' }))).status, 400);
});

Deno.test('match-make-offer: passes provided idem_key verbatim', async () => {
  setEnv();
  const stub = resetStub({ user: { id: 'actor-1' } });
  const res = await handler(post({ instance: 'i-1', candidate: 'c-1', idem_key: 'idem-xyz' }));
  assertEquals(res.status, 200);
  assertEquals(stub.calls[0].name, 'match_make_offer');
  assertEquals(stub.calls[0].args, { p_actor: 'actor-1', p_instance: 'i-1', p_candidate: 'c-1', p_idem_key: 'idem-xyz' });
});

Deno.test('match-make-offer: mints a UUID idem_key when absent', async () => {
  setEnv();
  const stub = resetStub({ user: { id: 'actor-1' } });
  await handler(post({ instance: 'i-1', candidate: 'c-1' }));
  const minted = stub.calls[0].args.p_idem_key as string;
  // RFC4122 v4 shape
  assertEquals(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(minted), true);
});

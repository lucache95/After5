// match-demand-hint/index.test.ts — validation + arg-shaping (no actor; read-only hint).
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

Deno.test('match-demand-hint: missing instance -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({}))).status, 400);
});

Deno.test('match-demand-hint: shapes p_instance and returns the band data', async () => {
  setEnv();
  const stub = resetStub({ user: { id: 'actor-1' }, rpc: { match_demand_hint: { data: 'warming_up' } } });
  const res = await handler(post({ instance: 'i-1' }));
  assertEquals(res.status, 200);
  assertEquals(stub.calls[0].name, 'match_demand_hint');
  assertEquals(stub.calls[0].args, { p_instance: 'i-1' });
  const body = await res.json();
  assertEquals(body.data, 'warming_up');
});

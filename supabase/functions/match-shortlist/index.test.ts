// match-shortlist/index.test.ts — validation rejects + RPC arg-shaping.
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { handler } from './index.ts';
import { resetStub } from '../_shared/_test_supabase_stub.ts';

function setEnv() {
  Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-dummy');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-dummy');
}
const AUTHED = { Authorization: 'Bearer dummy' };
function post(body: unknown) {
  return new Request('http://x/', { method: 'POST', headers: AUTHED, body: JSON.stringify(body) });
}

Deno.test('match-shortlist: missing instance -> 400', async () => {
  setEnv();
  resetStub();
  const res = await handler(post({ candidate: 'c', rank: 1 }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, 'bad_request');
});

Deno.test('match-shortlist: missing candidate -> 400', async () => {
  setEnv();
  resetStub();
  const res = await handler(post({ instance: 'i', rank: 1 }));
  assertEquals(res.status, 400);
});

Deno.test('match-shortlist: non-numeric rank -> 400', async () => {
  setEnv();
  resetStub();
  const res = await handler(post({ instance: 'i', candidate: 'c', rank: 'x' }));
  assertEquals(res.status, 400);
});

Deno.test('match-shortlist: valid body -> calls match_shortlist with p_* args', async () => {
  setEnv();
  const stub = resetStub({ user: { id: 'actor-1' } });
  const res = await handler(post({ instance: 'i-1', candidate: 'c-1', rank: 2 }));
  assertEquals(res.status, 200);
  assertEquals(stub.calls.length, 1);
  assertEquals(stub.calls[0].name, 'match_shortlist');
  assertEquals(stub.calls[0].args, { p_actor: 'actor-1', p_instance: 'i-1', p_candidate: 'c-1', p_rank: 2 });
});

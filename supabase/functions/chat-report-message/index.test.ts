// chat-report-message/index.test.ts — validation + arg-shaping + errcode mapping.
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

Deno.test('chat-report-message: missing message_id -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({ reason: 'spam' }))).status, 400);
});

Deno.test('chat-report-message: shapes p_actor/p_message/p_reason', async () => {
  setEnv();
  const stub = resetStub({
    user: { id: 'actor-1' },
    rpc: { report_message: { data: { kind: 'report', report_id: 'r-1' } } },
  });
  const res = await handler(post({ message_id: 'm-1', reason: 'creepy' }));
  assertEquals(res.status, 200);
  assertEquals(stub.calls[0].name, 'report_message');
  assertEquals(stub.calls[0].args, { p_actor: 'actor-1', p_message: 'm-1', p_reason: 'creepy' });
  assertEquals(await res.json(), { ok: true, data: { kind: 'report', report_id: 'r-1' } });
});

Deno.test('chat-report-message: reason defaults to null when omitted', async () => {
  setEnv();
  const stub = resetStub({
    user: { id: 'actor-1' },
    rpc: { report_message: { data: { kind: 'report', report_id: 'r-1' } } },
  });
  await handler(post({ message_id: 'm-1' }));
  assertEquals(stub.calls[0].args, { p_actor: 'actor-1', p_message: 'm-1', p_reason: null });
});

Deno.test('chat-report-message: P5012 -> 403 cannot_report', async () => {
  setEnv();
  resetStub({
    user: { id: 'actor-1' },
    rpc: { report_message: { error: { code: 'P5012', message: 'cannot report your own message' } } },
  });
  const res = await handler(post({ message_id: 'm-1' }));
  assertEquals(res.status, 403);
  const json = await res.json();
  assertEquals(json.ok, false);
  assertEquals(json.code, 'cannot_report');
  assertEquals(json.errcode, 'P5012');
});

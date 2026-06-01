// chat-send-message/index.test.ts — validation + arg-shaping + errcode mapping.
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

Deno.test('chat-send-message: missing thread_id -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({ body: 'hi' }))).status, 400);
});

Deno.test('chat-send-message: missing body -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({ thread_id: 't-1' }))).status, 400);
});

Deno.test('chat-send-message: blank/whitespace body -> 400', async () => {
  setEnv();
  resetStub();
  assertEquals((await handler(post({ thread_id: 't-1', body: '   ' }))).status, 400);
});

Deno.test('chat-send-message: shapes p_actor/p_thread/p_body/p_idem_key', async () => {
  setEnv();
  const stub = resetStub({
    user: { id: 'actor-1' },
    rpc: { chat_send_message: { data: { kind: 'message', message_id: 'm-1', both_ready: false } } },
  });
  const res = await handler(post({ thread_id: 't-1', body: 'hey', idem_key: 'idem-1' }));
  assertEquals(res.status, 200);
  assertEquals(stub.calls[0].name, 'chat_send_message');
  assertEquals(stub.calls[0].args, { p_actor: 'actor-1', p_thread: 't-1', p_body: 'hey', p_idem_key: 'idem-1' });
  const json = await res.json();
  assertEquals(json, { ok: true, data: { kind: 'message', message_id: 'm-1', both_ready: false } });
});

Deno.test('chat-send-message: mints idem_key when omitted', async () => {
  setEnv();
  const stub = resetStub({
    user: { id: 'actor-1' },
    rpc: { chat_send_message: { data: { kind: 'message', message_id: 'm-1' } } },
  });
  await handler(post({ thread_id: 't-1', body: 'hey' }));
  const args = stub.calls[0].args as { p_idem_key?: string };
  assertEquals(typeof args.p_idem_key, 'string');
  assertEquals((args.p_idem_key ?? '').length > 0, true);
});

Deno.test('chat-send-message: P5011 -> 409 chat_closed', async () => {
  setEnv();
  resetStub({
    user: { id: 'actor-1' },
    rpc: { chat_send_message: { error: { code: 'P5011', message: 'chat thread is closed' } } },
  });
  const res = await handler(post({ thread_id: 't-1', body: 'hey' }));
  assertEquals(res.status, 409);
  const json = await res.json();
  assertEquals(json.ok, false);
  assertEquals(json.code, 'chat_closed');
  assertEquals(json.errcode, 'P5011');
});

Deno.test('chat-send-message: P5010 -> 403 chat_not_party', async () => {
  setEnv();
  resetStub({
    user: { id: 'actor-1' },
    rpc: { chat_send_message: { error: { code: 'P5010', message: 'not a party' } } },
  });
  const res = await handler(post({ thread_id: 't-1', body: 'hey' }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).code, 'chat_not_party');
});

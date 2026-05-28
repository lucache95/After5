// supabase/functions/_shared/match.test.ts
// Unit tests for withMatchHandler — the request scaffolding shared by all 8 match-* fns.
// Covers the pre-RPC branches that need NO DB (CORS / 405 / missing-env / missing-auth)
// AND, via the test-only supabase-js stub (see _test_import_map.json), the authed paths:
//   - getUser failure -> 401
//   - handler success -> CORS mirrored onto response
//   - handler RPC raising PG errcode P5000 -> mapped to HTTP 503 in the catch block.
//
// Run with: deno test --allow-all --import-map _test_import_map.json (see suite runner).
import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { withMatchHandler, callRpcAndRespond } from './match.ts';
import { corsHeaders } from './cors.ts';
import { resetStub } from './_test_supabase_stub.ts';

// Local-dummy env so the env-present branch passes when we want it to.
function setEnv() {
  Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-dummy');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-dummy');
}

const AUTHED = { Authorization: 'Bearer dummy-jwt' };

Deno.test('OPTIONS preflight -> 200 with CORS headers', async () => {
  setEnv();
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), corsHeaders['Access-Control-Allow-Methods']);
});

Deno.test('non-POST (GET) -> 405 method_not_allowed', async () => {
  setEnv();
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'GET' }));
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.code, 'method_not_allowed');
});

Deno.test('missing env -> 500 server_error', async () => {
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_ANON_KEY');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'POST' }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, 'server_error');
});

Deno.test('missing Authorization header -> 401 auth_mismatch', async () => {
  setEnv();
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'POST', body: '{}' }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.code, 'auth_mismatch');
});

Deno.test('invalid/expired JWT (getUser error) -> 401 auth_mismatch', async () => {
  setEnv();
  resetStub({ userError: { message: 'invalid jwt' }, user: null });
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'POST', headers: AUTHED, body: '{}' }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.code, 'auth_mismatch');
});

Deno.test('invalid JSON body -> 400 bad_request', async () => {
  setEnv();
  resetStub();
  const h = withMatchHandler(async () => new Response('unreached'));
  const res = await h(new Request('http://x/', { method: 'POST', headers: AUTHED, body: '{not json' }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.code, 'bad_request');
});

Deno.test('authed success -> handler runs, user id + body passed, CORS mirrored', async () => {
  setEnv();
  resetStub({ user: { id: 'u-123' } });
  let sawUserId = '';
  let sawBody: Record<string, unknown> = {};
  const h = withMatchHandler(async ({ user, body }) => {
    sawUserId = user.id;
    sawBody = body;
    return new Response(JSON.stringify({ ok: true, data: 'done' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const res = await h(new Request('http://x/', { method: 'POST', headers: AUTHED, body: JSON.stringify({ instance: 'i-1' }) }));
  assertEquals(res.status, 200);
  assertEquals(sawUserId, 'u-123');
  assertEquals(sawBody.instance, 'i-1');
  // CORS mirrored onto the success response
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('handler RPC raising PG errcode P5000 -> 503 feature_disabled (catch-block mapping)', async () => {
  setEnv();
  // Stub rpc('match_x') to return a PostgrestError with code P5000.
  resetStub({ user: { id: 'u-1' }, rpc: { match_x: { error: { code: 'P5000', message: 'flag off' } } } });
  // A realistic handler shape: call the RPC via callRpcAndRespond (same as the 8 fns).
  const h = withMatchHandler(async ({ client }) => callRpcAndRespond(client, 'match_x', { p_actor: 'u-1' }));
  const res = await h(new Request('http://x/', { method: 'POST', headers: AUTHED, body: '{}' }));
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.code, 'feature_disabled');
  assertEquals(body.errcode, 'P5000');
  // CORS mirrored even on error responses
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('handler that THROWS a PG error (code on thrown obj) -> mapped via catch', async () => {
  setEnv();
  resetStub({ user: { id: 'u-1' } });
  const h = withMatchHandler(async () => {
    throw { code: 'P5007', message: 'expired' };
  });
  const res = await h(new Request('http://x/', { method: 'POST', headers: AUTHED, body: '{}' }));
  assertEquals(res.status, 410);
  const body = await res.json();
  assertEquals(body.code, 'offer_expired');
});

Deno.test('handler throwing a plain JS error -> 500 server_error', async () => {
  setEnv();
  resetStub({ user: { id: 'u-1' } });
  const h = withMatchHandler(async () => {
    throw new Error('boom');
  });
  const res = await h(new Request('http://x/', { method: 'POST', headers: AUTHED, body: '{}' }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, 'server_error');
});

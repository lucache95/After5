// supabase/functions/process-jobs/handlers_rpc_fail_closed_test.ts
// TDD tests for R0.2: callRpc helper + handlers fail closed on missing/errored RPC.
// Uses an inline fake Db — no live DB, no functions-serve required.
// Run: deno test --allow-env supabase/functions/process-jobs/handlers_rpc_fail_closed_test.ts

import { assertEquals, assertRejects, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { callRpc, HANDLERS, type Job } from './handlers.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

function makeDb(result: RpcResult): { rpc: (fn: string, args: unknown) => Promise<RpcResult>; rpcCalls: string[] } {
  const rpcCalls: string[] = [];
  return {
    rpcCalls,
    rpc: (fn: string, _args: unknown) => {
      rpcCalls.push(fn);
      return Promise.resolve(result);
    },
    // handlers must not write tables directly
    from: () => { throw new Error('handler must not call db.from()'); },
  };
}

const makeJob = (type: string, payload: Record<string, unknown> = {}): Job => ({
  id: 'j-test', type, payload, run_after: '', status: 'running',
});

// ---------------------------------------------------------------------------
// callRpc unit tests
// ---------------------------------------------------------------------------

Deno.test('callRpc resolves when rpc returns { error: null }', async () => {
  const db = makeDb({ data: null, error: null });
  // should not throw
  await callRpc(db as never, 'some_fn', { p_foo: 'bar' });
  assertEquals(db.rpcCalls, ['some_fn']);
});

Deno.test('callRpc rejects on PGRST202 (missing function)', async () => {
  const db = makeDb({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function some_fn in the schema cache' },
  });
  const err = await assertRejects(
    () => callRpc(db as never, 'some_fn', { p_foo: 'bar' }),
    Error,
    'rpc some_fn failed',
  );
  assertEquals((err as Error & { rpcCode?: string }).rpcCode, 'PGRST202');
  assertEquals((err as Error & { rpcFn?: string }).rpcFn, 'some_fn');
});

Deno.test('callRpc rejects on pg 42883 (function does not exist)', async () => {
  const db = makeDb({
    data: null,
    error: { code: '42883', message: 'function match_stale_date_close(p_instance => uuid) does not exist' },
  });
  const err = await assertRejects(
    () => callRpc(db as never, 'match_stale_date_close', { p_instance: 'i1' }),
    Error,
    'rpc match_stale_date_close failed',
  );
  assertEquals((err as Error & { rpcCode?: string }).rpcCode, '42883');
  assertEquals((err as Error & { rpcFn?: string }).rpcFn, 'match_stale_date_close');
});

Deno.test('callRpc rejects on arbitrary rpc error (non-missing-function)', async () => {
  const db = makeDb({
    data: null,
    error: { code: 'P5001', message: 'auth mismatch' },
  });
  await assertRejects(
    () => callRpc(db as never, 'do_something', {}),
    Error,
    'rpc do_something failed',
  );
});

// ---------------------------------------------------------------------------
// Handler tests — missing-RPC handlers reject (fail closed)
// ---------------------------------------------------------------------------

Deno.test('deletion_process handler rejects when rpc returns PGRST202 error', async () => {
  const db = makeDb({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function process_deletion' },
  });
  const err = await assertRejects(
    () => HANDLERS['deletion_process'](db as never, makeJob('deletion_process', { user_id: 'u1' })),
    Error,
    'rpc process_deletion failed',
  );
  assert((err as Error & { rpcCode?: string }).rpcCode === 'PGRST202');
  assert((err as Error & { rpcFn?: string }).rpcFn === 'process_deletion');
});

Deno.test('stale_date_close handler rejects when rpc returns 42883 error', async () => {
  const db = makeDb({
    data: null,
    error: { code: '42883', message: 'function match_stale_date_close does not exist' },
  });
  await assertRejects(
    () => HANDLERS['stale_date_close'](db as never, makeJob('stale_date_close', { instance_id: 'i1' })),
    Error,
    'rpc match_stale_date_close failed',
  );
});

Deno.test('pending_expiry handler rejects when rpc returns error', async () => {
  const db = makeDb({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function match_expire_pending' },
  });
  await assertRejects(
    () => HANDLERS['pending_expiry'](db as never, makeJob('pending_expiry', { queue_entry_id: 'q1' })),
    Error,
    'rpc match_expire_pending failed',
  );
});

Deno.test('reconfirm_timeout handler rejects when rpc returns error', async () => {
  const db = makeDb({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function match_reconfirm_timeout' },
  });
  await assertRejects(
    () => HANDLERS['reconfirm_timeout'](db as never, makeJob('reconfirm_timeout', { lock_id: 'l1' })),
    Error,
    'rpc match_reconfirm_timeout failed',
  );
});

Deno.test('chat_purge handler rejects when rpc returns error', async () => {
  const db = makeDb({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function chat_purge_thread' },
  });
  await assertRejects(
    () => HANDLERS['chat_purge'](db as never, makeJob('chat_purge', { thread_id: 't1' })),
    Error,
    'rpc chat_purge_thread failed',
  );
});

Deno.test('analytics_relay handler rejects when rpc returns error', async () => {
  const db = makeDb({
    data: null,
    error: { code: 'PGRST202', message: 'Could not find the function analytics_relay_drain' },
  });
  await assertRejects(
    () => HANDLERS['analytics_relay'](db as never, makeJob('analytics_relay', { batch: [] })),
    Error,
    'rpc analytics_relay_drain failed',
  );
});

// ---------------------------------------------------------------------------
// Handler tests — working handlers resolve when rpc returns no error
// ---------------------------------------------------------------------------

Deno.test('offer_expiry handler resolves when rpc returns { error: null }', async () => {
  const db = makeDb({ data: null, error: null });
  // should not throw
  await HANDLERS['offer_expiry'](db as never, makeJob('offer_expiry', { offer_id: 'o1' }));
  assert(db.rpcCalls.includes('match_expire_offer'));
});

Deno.test('standby_roll handler resolves when rpc returns { error: null }', async () => {
  const db = makeDb({ data: null, error: null });
  await HANDLERS['standby_roll'](db as never, makeJob('standby_roll', { instance_id: 'inst1' }));
  assert(db.rpcCalls.includes('match_auto_roll'));
});

Deno.test('bulk_withdraw handler resolves when rpc returns { error: null }', async () => {
  const db = makeDb({ data: null, error: null });
  await HANDLERS['bulk_withdraw'](db as never, makeJob('bulk_withdraw', { user: 'u1' }));
  assert(db.rpcCalls.includes('match_bulk_withdraw'));
});

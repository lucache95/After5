// supabase/functions/process-jobs/handlers_test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { HANDLERS } from './handlers.ts';

const ALL_TYPES = [
  'offer_expiry','standby_roll','bulk_withdraw',
  'chat_purge','rating_window','analytics_relay','notify',
];

Deno.test('every job_type has a handler', () => {
  for (const t of ALL_TYPES) assert(typeof HANDLERS[t] === 'function', `missing handler ${t}`);
});

Deno.test('offer_expiry calls match_expire_offer (no direct offer write)', async () => {
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const fakeDb = {
    rpc: (name: string, args: unknown) => { rpcCalls.push({ name, args }); return Promise.resolve({ data: null, error: null }); },
    from: () => { throw new Error('handler must not write tables directly'); },
  };
  await HANDLERS['offer_expiry'](fakeDb as never, {
    id: 'j1', type: 'offer_expiry', payload: { offer_id: 'o1' }, run_after: '', status: 'running',
  } as never);
  assert(rpcCalls.some((c) => c.name === 'match_expire_offer'), 'did not call match_expire_offer');
});

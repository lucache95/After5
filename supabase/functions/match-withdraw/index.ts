// supabase/functions/match-withdraw/index.ts
// Wraps public.match_withdraw (B-lite). Args: { instance }. No idem_key.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond } from '../_shared/match.ts';

serve(withMatchHandler(async ({ user, body, client }) => {
  const { instance } = body as { instance?: string };
  if (!instance) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'instance required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'match_withdraw', {
    p_actor: user.id,
    p_instance: instance,
  });
}));

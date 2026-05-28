// supabase/functions/match-resolve-reciprocal/index.ts
// Wraps public.match_resolve_reciprocal (B-complete). Args: { pair_id, chosen_instance, idem_key? }.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, mintIdemKey } from '../_shared/match.ts';

serve(withMatchHandler(async ({ user, body, client }) => {
  const { pair_id, chosen_instance, idem_key } = body as { pair_id?: string; chosen_instance?: string; idem_key?: string };
  if (!pair_id || !chosen_instance) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'pair_id and chosen_instance required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'match_resolve_reciprocal', {
    p_actor: user.id,
    p_pair_id: pair_id,
    p_chosen_instance: chosen_instance,
    p_idem_key: idem_key ?? mintIdemKey(),
  });
}));

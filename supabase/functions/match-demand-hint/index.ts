// supabase/functions/match-demand-hint/index.ts
// Wraps public.match_demand_hint (C-SQL stub). Args: { instance }.
// Returns: { ok: true, data: 'quiet'|'warming_up'|'filling_up'|'almost_full' }.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond } from '../_shared/match.ts';

serve(withMatchHandler(async ({ body, client }) => {
  const { instance } = body as { instance?: string };
  if (!instance) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'instance required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond<string>(client, 'match_demand_hint', { p_instance: instance });
}));

// supabase/functions/match-shortlist/index.ts
// Wraps public.match_shortlist (A.3). Args: { instance, candidate, rank }.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond } from '../_shared/match.ts';

serve(withMatchHandler(async ({ user, body, client }) => {
  const { instance, candidate, rank } = body as { instance?: string; candidate?: string; rank?: number };
  if (!instance || !candidate || typeof rank !== 'number') {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'instance, candidate, and rank required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'match_shortlist', {
    p_actor: user.id,
    p_instance: instance,
    p_candidate: candidate,
    p_rank: rank,
  });
}));

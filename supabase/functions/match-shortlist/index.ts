// supabase/functions/match-shortlist/index.ts
// Wraps public.match_shortlist (A.3). Args: { instance, candidate, rank }.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, type MatchHandler } from '../_shared/match.ts';

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
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
};

export const handler = withMatchHandler(matchHandler);

// Only bind the HTTP listener when run as the entrypoint (deploy/serve), not when
// imported by unit tests. Behavior-preserving: Supabase runs this file as main.
if (import.meta.main) serve(handler);

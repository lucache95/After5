// supabase/functions/match-reject-candidate/index.ts
// Wraps public.reject_candidate (E12). Args: { instance, candidate }.
// Silent host decline — the RPC sends NO notification; this envelope just
// routes the call. Mirrors match-shortlist exactly.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, type MatchHandler } from '../_shared/match.ts';

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
  const { instance, candidate } = body as { instance?: string; candidate?: string };
  if (!instance || !candidate) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'instance and candidate required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'reject_candidate', {
    p_actor: user.id,
    p_instance: instance,
    p_candidate: candidate,
  });
};

export const handler = withMatchHandler(matchHandler);

// Only bind the HTTP listener when run as the entrypoint (deploy/serve), not when
// imported by unit tests. Behavior-preserving: Supabase runs this file as main.
if (import.meta.main) serve(handler);

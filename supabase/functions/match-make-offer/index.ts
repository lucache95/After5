// supabase/functions/match-make-offer/index.ts
// Wraps public.match_make_offer (A.4). Args: { instance, candidate, idem_key? }.
// idem_key is auto-minted if absent. Returns: { ok: true, data: { offer_id } }.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, mintIdemKey, type MatchHandler } from '../_shared/match.ts';

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
  const { instance, candidate, idem_key } = body as { instance?: string; candidate?: string; idem_key?: string };
  if (!instance || !candidate) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'instance and candidate required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'match_make_offer', {
    p_actor: user.id,
    p_instance: instance,
    p_candidate: candidate,
    p_idem_key: idem_key ?? mintIdemKey(),
  });
};

export const handler = withMatchHandler(matchHandler);

// Only bind the HTTP listener when run as the entrypoint (deploy/serve), not when
// imported by unit tests. Behavior-preserving: Supabase runs this file as main.
if (import.meta.main) serve(handler);

// supabase/functions/match-pass-offer/index.ts
// Wraps public.match_pass_offer (B-lite). Args: { offer }. No idem_key.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, type MatchHandler } from '../_shared/match.ts';

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
  const { offer } = body as { offer?: string };
  if (!offer) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'offer required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'match_pass_offer', {
    p_actor: user.id,
    p_offer: offer,
  });
};

export const handler = withMatchHandler(matchHandler);

// Only bind the HTTP listener when run as the entrypoint (deploy/serve), not when
// imported by unit tests. Behavior-preserving: Supabase runs this file as main.
if (import.meta.main) serve(handler);

// supabase/functions/match-pass-offer/index.ts
// Wraps public.match_pass_offer (B-lite). Args: { offer }. No idem_key.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond } from '../_shared/match.ts';

serve(withMatchHandler(async ({ user, body, client }) => {
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
}));

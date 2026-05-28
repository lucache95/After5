// supabase/functions/match-accept-offer/index.ts
// Wraps public.match_accept_offer (A.5). Args: { offer, idem_key? }.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, mintIdemKey } from '../_shared/match.ts';

serve(withMatchHandler(async ({ user, body, client }) => {
  const { offer, idem_key } = body as { offer?: string; idem_key?: string };
  if (!offer) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'offer required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'match_accept_offer', {
    p_actor: user.id,
    p_offer: offer,
    p_idem_key: idem_key ?? mintIdemKey(),
  });
}));

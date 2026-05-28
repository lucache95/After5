// supabase/functions/match-cancel-lock/index.ts
// Wraps public.match_cancel_lock (B-complete). Args: { lock, reason, idem_key? }.
// reason ∈ {mutual, no_show, creator_pre_lock, safety}.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, mintIdemKey, type MatchHandler } from '../_shared/match.ts';

const VALID_REASONS = new Set(['mutual', 'no_show', 'creator_pre_lock', 'safety']);

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
  const { lock, reason, idem_key } = body as { lock?: string; reason?: string; idem_key?: string };
  if (!lock || !reason) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'lock and reason required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  if (!VALID_REASONS.has(reason)) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: `reason must be one of: ${[...VALID_REASONS].join(', ')}` }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'match_cancel_lock', {
    p_actor: user.id,
    p_lock: lock,
    p_reason: reason,
    p_idem_key: idem_key ?? mintIdemKey(),
  });
};

export const handler = withMatchHandler(matchHandler);

// Only bind the HTTP listener when run as the entrypoint (deploy/serve), not when
// imported by unit tests. Behavior-preserving: Supabase runs this file as main.
if (import.meta.main) serve(handler);

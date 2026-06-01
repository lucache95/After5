// supabase/functions/chat-report-message/index.ts
// Wraps public.report_message (Phase 7 minimal moderation). Args: { message_id, reason? }.
// report_message is SECURITY DEFINER and REVOKEd from authenticated, so it runs
// through the authed client (Authorization passed through) and re-checks
// auth.uid() = p_actor server-side. Errcode: P5001->401, P5012->403 cannot_report.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, type MatchHandler } from '../_shared/match.ts';

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
  const { message_id, reason } = body as { message_id?: string; reason?: string };
  if (!message_id) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'message_id required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'report_message', {
    p_actor: user.id,
    p_message: message_id,
    p_reason: reason ?? null,
  });
};

export const handler = withMatchHandler(matchHandler);

// Only bind the HTTP listener when run as the entrypoint (deploy/serve), not when
// imported by unit tests. Behavior-preserving: Supabase runs this file as main.
if (import.meta.main) serve(handler);

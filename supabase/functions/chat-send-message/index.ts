// supabase/functions/chat-send-message/index.ts
// Wraps public.chat_send_message (Phase 7). Args: { thread_id, body, idem_key? }.
// chat_send_message is SECURITY DEFINER and REVOKEd from authenticated, so it runs
// through the authed client (Authorization passed through) and re-checks
// auth.uid() = p_actor server-side. Errcodes: P5001->401, P5010->403, P5011->409.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { withMatchHandler, callRpcAndRespond, mintIdemKey, type MatchHandler } from '../_shared/match.ts';

export const matchHandler: MatchHandler = async ({ user, body, client }) => {
  const { thread_id, body: text, idem_key } = body as {
    thread_id?: string;
    body?: string;
    idem_key?: string;
  };
  if (!thread_id || !text || !text.trim()) {
    return new Response(JSON.stringify({ ok: false, code: 'bad_request', message: 'thread_id and body required.' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  return await callRpcAndRespond(client, 'chat_send_message', {
    p_actor: user.id,
    p_thread: thread_id,
    p_body: text,
    p_idem_key: idem_key ?? mintIdemKey(),
  });
};

export const handler = withMatchHandler(matchHandler);

// Only bind the HTTP listener when run as the entrypoint (deploy/serve), not when
// imported by unit tests. Behavior-preserving: Supabase runs this file as main.
if (import.meta.main) serve(handler);

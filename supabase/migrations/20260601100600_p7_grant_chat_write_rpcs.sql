-- 20260601100600_p7_grant_chat_write_rpcs.sql
-- Fix: chat_send_message / report_message were REVOKEd from `authenticated` in
-- 100200 / 100250, but the chat-send-message / chat-report-message edge functions
-- call them through the USER'S JWT client (role = authenticated), exactly like every
-- match-* edge function. With EXECUTE revoked, every real send/report was permission-
-- denied on prod (the read-only smoke missed it; the write-path proof + security
-- audit caught it). Grant EXECUTE to authenticated to mirror the match_* RPCs.
-- Safety is unchanged: each RPC re-checks auth.uid() = p_actor and asserts party
-- membership + (for send) Gate A messageability, so a direct PostgREST call can only
-- act as the caller within their own threads — identical posture to match_make_offer
-- / match_accept_offer, which are authenticated-executable.
grant execute on function chat_send_message(uuid, uuid, text, uuid) to authenticated;
grant execute on function report_message(uuid, uuid, text) to authenticated;

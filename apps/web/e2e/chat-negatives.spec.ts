// chat negatives (Phase 7): a non-party is fully walled off, and reporting is
// scoped to RECEIVED messages only. Party membership derives from the offer
// (creator_id + candidate_id); a third seeded user is party to nothing.
//   - non-party /messages: thread is NOT listed (chat_threads_party_read RLS).
//   - non-party /messages/[threadId]: server row is null under RLS -> "not your
//     conversation" (the page's not-a-party fallback).
//   - non-party direct reads/sends: messages REST select returns [] (messages_party_read
//     RLS); chat-send-message -> P5010 chat_not_party (chat_send_message gate).
//   - report: reporting your OWN message -> P5012 cannot_report; reporting the
//     counterpart's message -> ok (report_message gate, verified vs the RPC).
// Error-code facts verified against the migrations + _shared/errcode.ts:
// chat_not_party=P5010, cannot_report=P5012, auth_mismatch=P5001.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loginAs, accessToken } from './_helpers/auth';
import { seedChatThread, cleanupChat, type ChatSeedResult } from './_helpers/seed';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const PUBLISHABLE_KEY =
  process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

let seed: ChatSeedResult;
test.beforeAll(async () => {
  seed = await seedChatThread();
});
test.afterAll(async () => {
  if (seed) await cleanupChat(seed);
});

test('non-party is walled off the thread list, the conversation page, and direct message reads (RLS)', async ({
  browser,
}) => {
  // Seed one message from the host so there IS content the non-party must not read.
  const sb = admin();
  const { data: msg, error } = await sb
    .from('messages')
    .insert({ thread_id: seed.threadId, sender_id: seed.hostId, body: 'secret party-only message' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();

  const outsiderContext = await browser.newContext();
  const outsiderPage = await loginAs(outsiderContext, seed.outsiderEmail);

  // 1. /messages does NOT list this thread (no row for either party name, and the
  //    outsider has no threads of their own -> empty state).
  await outsiderPage.goto('/messages');
  await expect(
    outsiderPage.getByRole('link', { name: new RegExp(`chat with ${seed.candName}`, 'i') }),
  ).toHaveCount(0);
  await expect(
    outsiderPage.getByRole('link', { name: new RegExp(`chat with ${seed.hostName}`, 'i') }),
  ).toHaveCount(0);

  // 2. /messages/[threadId] for someone else's thread -> "not your conversation".
  await outsiderPage.goto(`/messages/${seed.threadId}`);
  await expect(outsiderPage.getByText(/not your conversation/i)).toBeVisible();
  await expect(outsiderPage.getByText('secret party-only message')).toHaveCount(0);

  // 3. Direct REST read of the thread's messages (messages_party_read RLS) -> empty.
  const token = await accessToken(outsiderContext);
  const readRes = await outsiderContext.request.get(
    `${SUPABASE_URL}/rest/v1/messages?thread_id=eq.${seed.threadId}&select=*`,
    { headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}` } },
  );
  expect(readRes.ok(), `messages read status ${readRes.status()}`).toBeTruthy();
  const rows = (await readRes.json()) as unknown[];
  expect(rows, 'a non-party must read ZERO messages under RLS').toHaveLength(0);

  await outsiderContext.close();
  await sb.from('messages').delete().eq('id', msg!.id);
});

// The grant that once blocked this landed in 20260601100600 (chat_send_message is
// now EXECUTE-able by `authenticated`, like match_make_offer / chat_mark_read), so the
// edge fn now reaches the in-function party check: a non-party send returns P5010
// (chat_not_party) instead of a 42501 permission-denied. Active again.
test('non-party send through the edge fn is denied (chat_not_party / P5010)', async ({ browser }) => {
  const outsiderContext = await browser.newContext();
  await loginAs(outsiderContext, seed.outsiderEmail);
  const token = await accessToken(outsiderContext);

  const sendRes = await outsiderContext.request.post(`${SUPABASE_URL}/functions/v1/chat-send-message`, {
    headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { thread_id: seed.threadId, body: 'let me in' },
  });
  const sendBody = JSON.stringify(await sendRes.json());
  expect([401, 403, 404, 409, 422], sendBody).toContain(sendRes.status());
  expect(sendBody).toMatch(/P5010|chat_not_party/i);

  await outsiderContext.close();
});

// Same grant (20260601100600) re-enabled report_message for `authenticated`, so
// chat-report-message now reaches its own-message / party checks: reporting your own
// message returns P5012 and a counterpart's message is accepted. Active again.
test('report: own message rejected (P5012), counterpart message accepted', async ({ browser }) => {
  // Seed one message from EACH party so the candidate can report their own (reject)
  // and the host's (accept).
  const sb = admin();
  const { data: candMsg, error: e1 } = await sb
    .from('messages')
    .insert({ thread_id: seed.threadId, sender_id: seed.candId, body: 'candidate own message' })
    .select('id')
    .single();
  expect(e1, e1?.message).toBeNull();
  const { data: hostMsg, error: e2 } = await sb
    .from('messages')
    .insert({ thread_id: seed.threadId, sender_id: seed.hostId, body: 'host message to report' })
    .select('id')
    .single();
  expect(e2, e2?.message).toBeNull();

  const candContext = await browser.newContext();
  await loginAs(candContext, seed.candEmail);
  const token = await accessToken(candContext);

  const report = (messageId: string) =>
    candContext.request.post(`${SUPABASE_URL}/functions/v1/chat-report-message`, {
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { message_id: messageId },
    });

  // Reporting your OWN message -> cannot_report (P5012).
  const ownRes = await report(candMsg!.id);
  const ownBody = JSON.stringify(await ownRes.json());
  expect([401, 403, 404, 409, 422], ownBody).toContain(ownRes.status());
  expect(ownBody).toMatch(/P5012|cannot_report/i);

  // Reporting the COUNTERPART's message -> ok, returns a report id.
  const otherRes = await report(hostMsg!.id);
  const otherBody = (await otherRes.json()) as { ok?: boolean; data?: { report_id?: string } };
  expect(otherRes.ok(), JSON.stringify(otherBody)).toBeTruthy();
  expect(otherBody.ok).toBe(true);
  expect(otherBody.data?.report_id, 'a report row id should come back').toBeTruthy();

  // The report landed (service-role read of the deny-by-default table).
  const { data: reports } = await sb
    .from('message_reports')
    .select('id, message_id, reporter_id')
    .eq('message_id', hostMsg!.id);
  expect(reports?.length, 'exactly one report for the host message').toBe(1);
  expect(reports?.[0]?.reporter_id).toBe(seed.candId);

  await candContext.close();
  await sb.from('messages').delete().in('id', [candMsg!.id, hostMsg!.id]);
});

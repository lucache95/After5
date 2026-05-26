// Persona Inquiry webhook → verifications rows. Service-role only; the client never
// writes a verified state. Verify Persona's HMAC, map the verdict to age+selfie rows,
// upsert them, write the parsed DOB into profiles_private (UPSERT — no row is auto-created),
// and notify on failure. The Task-5 trigger rolls rows up into profiles.verification.
// Deploy: verify_jwt OFF (Persona is not a Supabase user); auth is the HMAC header.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

export type VState = 'unverified' | 'pending' | 'verified' | 'failed' | 'appeal';
export interface VerificationRow {
  user_id: string; kind: 'age' | 'selfie'; state: VState; provider: 'persona';
  provider_ref: string; failure_reason: string | null; verified_at: string | null;
}
export function mapInquiryToVerification(eventName: string, inquiryId: string, userId: string): VerificationRow[] {
  let state: VState; let failure: string | null = null;
  switch (eventName) {
    case 'inquiry.approved': state = 'verified'; break;
    case 'inquiry.declined': state = 'failed'; failure = 'persona_declined'; break;
    case 'inquiry.marked-for-review': state = 'pending'; break;
    default: state = 'pending'; break;
  }
  const verifiedAt = state === 'verified' ? new Date().toISOString() : null;
  const base = { user_id: userId, provider: 'persona' as const, provider_ref: inquiryId, failure_reason: failure, verified_at: verifiedAt, state };
  return [{ ...base, kind: 'age' }, { ...base, kind: 'selfie' }];
}
export function extractPersonaDob(inquiryAttributes: Record<string, unknown>): string | null {
  const bd = inquiryAttributes?.['birthdate'];
  return typeof bd === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : null;
}
export async function verifyPersonaSignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.trim().split('=')));
  const t = parts['t']; const v1 = parts['v1'];
  if (!t || !v1) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`));
  const expected = [...new Uint8Array(sigBuf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const rawBody = await req.text();
  const secret = Deno.env.get('PERSONA_WEBHOOK_SECRET') ?? '';
  const ok = await verifyPersonaSignature(rawBody, req.headers.get('Persona-Signature'), secret);
  if (!ok) return json({ error: 'bad_signature' }, 401);
  let event: { data?: { attributes?: { name?: string; payload?: { data?: { id?: string; attributes?: Record<string, unknown> } } } } };
  try { event = JSON.parse(rawBody); } catch { return json({ error: 'invalid_json' }, 400); }
  const name = event.data?.attributes?.name ?? '';
  const inquiry = event.data?.attributes?.payload?.data;
  const inquiryId = inquiry?.id ?? '';
  const refId = (inquiry?.attributes?.['reference-id'] as string | undefined) ?? '';
  if (!name.startsWith('inquiry.') || !inquiryId || !refId) return json({ ignored: true }, 200);
  const rows = mapInquiryToVerification(name, inquiryId, refId);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  for (const row of rows) {
    const { error } = await supabase.from('verifications').upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id,kind' });
    if (error) { console.error('persona-webhook upsert error', error.message); return json({ error: error.message }, 500); }
  }
  if (name === 'inquiry.approved') {
    const dob = extractPersonaDob((inquiry?.attributes ?? {}) as Record<string, unknown>);
    if (dob) {
      const { error: dobErr } = await supabase.from('profiles_private').upsert({ user_id: refId, birthdate: dob }, { onConflict: 'user_id' });
      if (dobErr) console.error('persona-webhook DOB write error', dobErr.message);
    }
  }
  if (rows[0].state === 'failed') {
    await supabase.rpc('dispatch_notification', { p_user: refId, p_type: 'verification_failed', p_payload: { topic: 'verification', state: rows[0].state, reason: rows[0].failure_reason } });
  }
  return json({ ok: true, mapped: rows.length }, 200);
}
if (import.meta.main) serve(handler);
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

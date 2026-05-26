// confirm-phone — record a verified phone after the client completes auth.verifyOtp.
// The client proves phone ownership to Supabase Auth (phone_confirmed_at is set on the
// JWT user); this function trusts that signal and writes the verified phone row with a
// service-role client so the client can never forge a verified state directly.
// Deploy: verify_jwt ON.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

export function buildPhoneVerificationRow(uid: string) {
  return { user_id: uid, kind: 'phone' as const, state: 'verified' as const, provider: 'supabase_auth' as const, verified_at: new Date().toISOString() };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!user.phone_confirmed_at) return json({ error: 'phone_not_confirmed' }, 400);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await supabase.from('verifications').upsert(
    { ...buildPhoneVerificationRow(user.id), updated_at: new Date().toISOString() },
    { onConflict: 'user_id,kind' },
  );
  if (error) { console.error('confirm-phone upsert error', error.message); return json({ error: error.message }, 500); }

  return json({ ok: true }, 200);
}
if (import.meta.main) serve(handler);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

// start-verification — FRONT DOOR for identity verification.
// Resolve the caller's auth.uid() from their JWT, create a Persona Inquiry whose
// reference-id is that uid (so the webhook can map the verdict back to the user),
// seed a pending age verification row (service-role), and return the inquiry id and
// (when present) the embedded-flow session token.
// Deploy: verify_jwt ON — only authenticated Supabase users may start verification.
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

export function buildInquiryRequest(uid: string, templateId: string) {
  return { data: { attributes: { 'inquiry-template-id': templateId, 'reference-id': uid } } };
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const PERSONA_API_KEY = Deno.env.get('PERSONA_API_KEY')!;
  const PERSONA_TEMPLATE_ID = Deno.env.get('PERSONA_TEMPLATE_ID')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);
  const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await authed.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  // Defense-in-depth: never re-mint an inquiry / re-seed 'pending' for a user who is
  // already verified (that would un-verify them via the rollup trigger).
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: prof } = await svc.from('profiles').select('verification').eq('id', user.id).maybeSingle();
  if (prof?.verification === 'verified') return json({ error: 'already_verified' }, 409);

  const personaResp = await fetch('https://api.withpersona.com/api/v1/inquiries', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PERSONA_API_KEY}`,
      'Persona-Version': '2023-01-05',
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildInquiryRequest(user.id, PERSONA_TEMPLATE_ID)),
  });
  if (!personaResp.ok) {
    const detail = await personaResp.text();
    console.error('start-verification persona error', personaResp.status, detail);
    return json({ error: 'persona_error', status: personaResp.status }, 502);
  }
  const resp = await personaResp.json();
  const inquiryId: string = resp?.data?.id ?? '';
  const sessionToken: string | undefined = resp?.meta?.['session-token'];
  if (!inquiryId) return json({ error: 'persona_no_inquiry' }, 502);

  const { error } = await svc.from('verifications').upsert(
    { user_id: user.id, kind: 'age', state: 'pending', provider: 'persona', provider_ref: inquiryId, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,kind' },
  );
  if (error) { console.error('start-verification seed error', error.message); return json({ error: error.message }, 500); }

  return json({ inquiryId, sessionToken }, 200);
}
if (import.meta.main) serve(handler);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

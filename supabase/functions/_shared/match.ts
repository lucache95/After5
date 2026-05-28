// supabase/functions/_shared/match.ts
// Common handler scaffolding for the 8 match-* edge functions.
// Each function imports `withMatchHandler` and provides just the RPC name +
// payload shaper; this module handles JWT verification, body parsing,
// errcode mapping, idem-key minting, and CORS.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from './cors.ts';
import { pgErrorToResponse, ok, jsonResponse, type ErrorBody } from './errcode.ts';

export type MatchHandlerCtx = {
  user: { id: string };
  body: Record<string, unknown>;
  client: SupabaseClient;          // authed client (Authorization header passed through)
  serviceClient: SupabaseClient;   // service-role client (for server-only operations)
};

export type MatchHandler = (ctx: MatchHandlerCtx) => Promise<Response>;

// Mint a v4 UUID for idem_key when the caller didn't pass one.
// Edge Functions are stateless per-request; client should ideally pass its own
// idem_key so retries are coalesced, but for now we mint per-request.
export function mintIdemKey(): string {
  return crypto.randomUUID();
}

// Standard wrapper. Handles OPTIONS/POST, JWT verify, body parse, errcode mapping.
export function withMatchHandler(handler: MatchHandler): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    // CORS preflight
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, code: 'method_not_allowed', message: 'POST required.' } satisfies ErrorBody, 405, { headers: corsHeaders });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      console.error('match edge: missing env');
      return jsonResponse({ ok: false, code: 'server_error', message: 'Server misconfigured.' } satisfies ErrorBody, 500, { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ ok: false, code: 'auth_mismatch', message: 'Please sign in.' } satisfies ErrorBody, 401, { headers: corsHeaders });
    }

    const client = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify JWT → extract user
    const { data: userData, error: userErr } = await client.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ ok: false, code: 'auth_mismatch', message: 'Please sign in again.' } satisfies ErrorBody, 401, { headers: corsHeaders });
    }

    // Parse body (must be valid JSON)
    let body: Record<string, unknown> = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text);
    } catch (_) {
      return jsonResponse({ ok: false, code: 'bad_request', message: 'Invalid JSON.' } satisfies ErrorBody, 400, { headers: corsHeaders });
    }

    const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    try {
      const response = await handler({ user: { id: userData.user.id }, body, client, serviceClient });
      // Mirror CORS headers onto the response
      for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
      return response;
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: string; hint?: string };
      // PG errors from supabase-js have .code on the PostgrestError, but if a thrown
      // error has them we map. Otherwise it's a JS exception.
      if (e?.code) {
        const r = pgErrorToResponse(e);
        for (const [k, v] of Object.entries(corsHeaders)) r.headers.set(k, v);
        return r;
      }
      console.error('match edge handler threw', err);
      const r = jsonResponse({ ok: false, code: 'server_error', message: 'Something went wrong.' } satisfies ErrorBody, 500);
      for (const [k, v] of Object.entries(corsHeaders)) r.headers.set(k, v);
      return r;
    }
  };
}

// Convenience: call an RPC, return ok({...}) on success, mapped error on failure.
// Most match-* functions are just "call this RPC with these args."
export async function callRpcAndRespond<T = unknown>(
  client: SupabaseClient,
  rpcName: string,
  args: Record<string, unknown>,
): Promise<Response> {
  const { data, error } = await client.rpc(rpcName, args);
  if (error) return pgErrorToResponse(error);
  return ok<T>(data as T);
}

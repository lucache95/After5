// supabase/functions/generate-blur/index.ts
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image } from 'https://deno.land/x/imagescript@1.2.17/mod.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Heavy privacy downscale for the blind feed: longest side -> 64px (aspect preserved),
// then a Gaussian blur proportional to the downscaled size. Pure + unit-tested.
export function blurParams(width: number, height: number): { width: number; height: number; blurRadius: number } {
  const MAX = 64;
  const scale = Math.min(1, MAX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { width: w, height: h, blurRadius: Math.max(2, Math.round(Math.max(w, h) / 8)) };
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
  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const clearPath = `${user.id}/clear.jpg`;
  const blurredPath = `${user.id}/blurred.jpg`;
  const { data: file, error: dlErr } = await svc.storage.from('profile-photos').download(clearPath);
  if (dlErr || !file) return json({ error: 'clear_photo_not_found' }, 404);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let img;
  try {
    img = await Image.decode(bytes);
  } catch {
    return json({ error: 'unsupported_image_format' }, 400);
  }
  const p = blurParams(img.width, img.height);
  // imagescript has no gaussianBlur; we soften by downscaling to a tiny
  // intermediate (size driven by blurRadius) then scaling back up to the
  // target. The heavy resize is the primary privacy step for the blind feed;
  // the downscale/upscale round-trip removes high-frequency facial detail.
  const tinyW = Math.max(1, Math.round(p.width / p.blurRadius));
  const tinyH = Math.max(1, Math.round(p.height / p.blurRadius));
  img.resize(tinyW, tinyH);
  img.resize(p.width, p.height);
  const out = await img.encodeJPEG(70);
  const { error: upErr } = await svc.storage.from('profile-photos').upload(blurredPath, out, { contentType: 'image/jpeg', upsert: true });
  if (upErr) return json({ error: upErr.message }, 500);
  const { error: updErr } = await svc.from('profiles').update({ blurred_photo_url: blurredPath }).eq('id', user.id);
  if (updErr) return json({ error: updErr.message }, 500);
  return json({ ok: true, blurredPath }, 200);
}
if (import.meta.main) serve(handler);
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

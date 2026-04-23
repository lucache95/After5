// generate-cover — turns an itinerary into a deterministic Pinterest-style
// cover image via Replicate FLUX schnell. Uploads the result to Supabase
// Storage and writes the public URL back to itineraries.cover_image_url.
//
// Auth: requires service-role bearer (REPLICATE costs money — admin only).
//
// Invoke:
//   curl -X POST $URL/functions/v1/generate-cover \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"itinerary_id": "abc-..."}'
//
//   # Or batch over rows missing a cover:
//   -d '{"batch_size": 5}'

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

const STORAGE_BUCKET = 'itinerary-covers';
const REPLICATE_MODEL = 'black-forest-labs/flux-schnell';

interface ItineraryStop {
  place_name?: string;
  place_type?: string;
  neighborhood?: string;
}

interface ItineraryRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  template_id: string | null;
  stops: ItineraryStop[] | unknown;
  inputs?: { vibe?: string[]; intent?: string } | null;
  season: string | null;
  cover_image_url: string | null;
}

function buildPrompt(it: ItineraryRow): string {
  const stops = (Array.isArray(it.stops) ? it.stops : []) as ItineraryStop[];
  const types = stops.map((s) => s.place_type).filter(Boolean).slice(0, 3);
  const neighborhoods = Array.from(new Set(stops.map((s) => s.neighborhood).filter(Boolean))).slice(0, 2);
  const vibe = (it.inputs?.vibe ?? []).slice(0, 2).join(', ');
  const season = it.season || 'spring';

  // Compose a Pinterest editorial-photography style prompt. Avoid people
  // (faces are the hardest thing to get right + we don't want stock-couple
  // vibes). Lean into objects + scene + light. Warm cream + terra-cotta
  // palette to match the brand. Always Kelowna BC for grounding.
  const sceneBits: string[] = [];
  if (types.includes('winery') || types.includes('cocktail_bar') || types.includes('brewery')) {
    sceneBits.push('two glasses on a wooden table');
  }
  if (types.includes('restaurant')) {
    sceneBits.push('a candlelit bistro table set for two');
  }
  if (types.includes('cafe') || types.includes('bakery')) {
    sceneBits.push('a steaming espresso and pastry on a warm cafe table');
  }
  if (types.includes('hike') || types.includes('viewpoint') || types.includes('sunset_spot')) {
    sceneBits.push('a winding trail overlooking Okanagan Lake');
  }
  if (types.includes('beach') || types.includes('park') || types.includes('walk')) {
    sceneBits.push('a quiet wooden boardwalk near the lake');
  }
  if (sceneBits.length === 0) {
    sceneBits.push('a peaceful Okanagan Valley scene');
  }

  const seasonHint =
    season === 'winter' ? 'crisp winter light, bare trees, soft snow on distant mountains' :
    season === 'summer' ? 'lush green vineyards, warm summer dusk light' :
    season === 'fall'   ? 'golden autumn vines, amber leaves, soft afternoon haze' :
                          'fresh spring foliage, light blue lake, gentle pink sunset';

  return [
    'Editorial Pinterest-style photograph,',
    sceneBits[0] + ',',
    `Kelowna British Columbia, ${neighborhoods.length ? neighborhoods.join(' / ') + ', ' : ''}${vibe ? vibe + ' mood,' : ''}`,
    `${seasonHint},`,
    'cinematic golden-hour atmosphere, warm cream and terra-cotta color palette,',
    'shallow depth of field, soft natural light, magazine-quality composition,',
    'no people visible, no text, no logos, square format',
  ].join(' ');
}

async function callReplicate(apiToken: string, prompt: string): Promise<string | null> {
  // Create prediction
  const create = await fetch('https://api.replicate.com/v1/models/' + REPLICATE_MODEL + '/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Prefer: 'wait',
    },
    body: JSON.stringify({
      input: {
        prompt,
        aspect_ratio: '1:1',
        output_format: 'webp',
        output_quality: 85,
        num_inference_steps: 4,
        go_fast: true,
      },
    }),
  });

  if (!create.ok) {
    console.error('replicate create failed', create.status, await create.text());
    return null;
  }

  const data = await create.json() as { output?: string | string[]; status?: string; error?: string };
  if (data.error) {
    console.error('replicate error', data.error);
    return null;
  }

  const out = Array.isArray(data.output) ? data.output[0] : data.output;
  return out ?? null;
}

async function uploadToStorage(
  supabase: ReturnType<typeof createClient>,
  imageUrl: string,
  itineraryId: string,
): Promise<string | null> {
  const imgResp = await fetch(imageUrl);
  if (!imgResp.ok) {
    console.error('image fetch failed', imgResp.status);
    return null;
  }
  const bytes = new Uint8Array(await imgResp.arrayBuffer());
  const path = `${itineraryId}.webp`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, bytes, { contentType: 'image/webp', upsert: true });

  if (error) {
    console.error('upload failed', error.message);
    return null;
  }

  const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return urlData.publicUrl;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Service-role bearer required.
  const auth = req.headers.get('Authorization');
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (auth !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({})) as {
    itinerary_id?: string;
    batch_size?: number;
    force?: boolean;
  };

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const replicateToken = Deno.env.get('REPLICATE_API_TOKEN');
  if (!replicateToken) {
    return new Response(JSON.stringify({ error: 'REPLICATE_API_TOKEN missing' }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  // Resolve target itineraries.
  let targets: ItineraryRow[] = [];
  if (body.itinerary_id) {
    const { data } = await supabase
      .from('itineraries')
      .select('id, slug, title, hook, template_id, stops, inputs, season, cover_image_url')
      .eq('id', body.itinerary_id)
      .limit(1);
    targets = (data ?? []) as ItineraryRow[];
  } else {
    const limit = Math.min(20, Math.max(1, body.batch_size ?? 5));
    let q = supabase
      .from('itineraries')
      .select('id, slug, title, hook, template_id, stops, inputs, season, cover_image_url')
      .eq('is_public', true)
      .not('title', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(limit);
    if (!body.force) q = q.is('cover_image_url', null);
    const { data } = await q;
    targets = (data ?? []) as ItineraryRow[];
  }

  if (targets.length === 0) {
    return new Response(JSON.stringify({ message: 'no targets', processed: 0 }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const it of targets) {
    if (it.cover_image_url && !body.force) {
      results.push({ id: it.id, skipped: 'already has cover' });
      continue;
    }

    const prompt = buildPrompt(it);
    const replicateUrl = await callReplicate(replicateToken, prompt);
    if (!replicateUrl) {
      results.push({ id: it.id, error: 'replicate_failed' });
      continue;
    }

    const publicUrl = await uploadToStorage(supabase, replicateUrl, it.id);
    if (!publicUrl) {
      results.push({ id: it.id, error: 'upload_failed' });
      continue;
    }

    const { error: updateErr } = await supabase
      .from('itineraries')
      .update({
        cover_image_url: publicUrl,
        cover_image_generated_at: new Date().toISOString(),
        cover_image_prompt: prompt,
      })
      .eq('id', it.id);

    if (updateErr) {
      results.push({ id: it.id, error: updateErr.message });
      continue;
    }

    results.push({ id: it.id, cover: publicUrl });

    // Light pacing — Replicate is happy at this rate, also keeps us inside
    // the function timeout if the batch is larger.
    await new Promise((r) => setTimeout(r, 500));
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
});

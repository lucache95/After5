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

  // Build a scene pool — list ALL relevant scene options (not just the first
  // matching type). Then deterministically pick one based on the itinerary
  // id so the same plan stays stable across re-renders, but different plans
  // diverge instead of all converging on "wine glasses on a table".
  //
  // Categories ordered by VISUAL DISTINCTIVENESS: distinctive activities
  // contribute multiple options at the top, generic drinks contribute fewer
  // at the bottom. The id-based pick still draws from the whole pool.
  const scenes: string[] = [];

  // Distinctive activities — escape rooms, axe throwing, ranges, galleries
  if (types.includes('activity') || types.includes('gallery')) {
    scenes.push(
      'a wooden axe-throwing target with chalk score marks',
      'a moody dim-lit escape-room hallway with vintage props',
      'a quiet downtown art studio with soft lamps and brushes on a table',
      'an arcade neon sign reflecting on a polished bartop',
    );
  }

  // Outdoor — hikes, viewpoints, sunset spots
  if (types.includes('hike') || types.includes('viewpoint') || types.includes('sunset_spot')) {
    scenes.push(
      'a winding bunchgrass trail above Okanagan Lake at golden hour',
      'a sage-and-pine ridgeline overlooking Kelowna with distant blue mountains',
      'an empty wooden bench at a hilltop viewpoint, warm dusk light',
    );
  }

  // Lake-side parks, beaches, walks
  if (types.includes('beach') || types.includes('park') || types.includes('walk') || types.includes('garden')) {
    scenes.push(
      'a quiet wooden boardwalk along the Okanagan lakefront',
      'soft evening light across a small public garden in spring',
      'an empty pier with two beach chairs at golden hour',
    );
  }

  // Markets and shops — distinctive scene
  if (types.includes('market') || types.includes('shop')) {
    scenes.push(
      'a colorful farmers market stall with crates of fresh produce in afternoon light',
      'a vintage record-shop window backlit by warm interior lamps',
    );
  }

  // Sweets — desserts, ice cream, bakeries
  if (types.includes('dessert') || types.includes('ice_cream') || types.includes('bakery')) {
    scenes.push(
      'two ice-cream cones held against a soft sunset sky',
      'a window-lit pastry counter with croissants and tarts',
      'a candlelit dessert plate with a single fork on a marble counter',
    );
  }

  // Cafés — only if cafe is a real anchor (not paired with above)
  if (types.includes('cafe')) {
    scenes.push(
      'a steaming espresso on a warm wooden cafe table with a folded book',
      'a sunlit cafe corner with a single ceramic cup and morning shadows',
    );
  }

  // Restaurants — sit-down dining
  if (types.includes('restaurant')) {
    scenes.push(
      'a candlelit bistro table for two with linen napkins',
      'warm pendant lights through a restaurant window at dusk',
      'an intimate corner table with bread and butter and a single tealight',
    );
  }

  // Drinks — wine, cocktails, beer (LAST priority because over-represented)
  if (types.includes('winery')) {
    scenes.push(
      'a sunlit vineyard row with grape leaves catching golden light',
      'a wine barrel and a single glass on a stone patio',
    );
  }
  if (types.includes('cocktail_bar')) {
    scenes.push(
      'a copper-pendant-lit cocktail bar with two coupes on dark wood',
      'a single negroni glowing under a vintage Edison bulb',
    );
  }
  if (types.includes('brewery')) {
    scenes.push(
      'two pints on a sunlit patio table with green leaves above',
      'a dim brewery taproom with rows of taps in soft focus',
    );
  }

  if (scenes.length === 0) {
    scenes.push(
      'a quiet Okanagan vineyard at golden hour',
      'a soft pastel sunset over Okanagan Lake from a hilltop',
    );
  }

  // Deterministic pick — sum char codes of itinerary id, mod scenes.length.
  // Same plan always renders the same scene; different plans diverge.
  const seed = (it.id || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const scene = scenes[seed % scenes.length];

  const seasonHint =
    season === 'winter' ? 'crisp winter light, bare trees, soft snow on distant mountains' :
    season === 'summer' ? 'lush green vineyards, warm summer dusk light' :
    season === 'fall'   ? 'golden autumn vines, amber leaves, soft afternoon haze' :
                          'fresh spring foliage, light blue lake, gentle pink sunset';

  return [
    'Editorial Pinterest-style photograph,',
    scene + ',',
    `Kelowna British Columbia, ${neighborhoods.length ? neighborhoods.join(' / ') + ', ' : ''}${vibe ? vibe + ' mood,' : ''}`,
    `${seasonHint},`,
    'cinematic golden-hour atmosphere, warm cream and terra-cotta color palette,',
    'shallow depth of field, soft natural light, magazine-quality composition,',
    'no people visible, no text, no logos, square format',
  ].join(' ');
}

async function callReplicate(apiToken: string, prompt: string): Promise<string | null> {
  // Create prediction. We poll instead of relying on Prefer:wait alone, since
  // wait returns 200 with output:null when the model is still warming up
  // (single-call works, batches of 5+ hit this and report `replicate_failed`).
  const create = await fetch('https://api.replicate.com/v1/models/' + REPLICATE_MODEL + '/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=30',
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

  type Prediction = {
    id?: string;
    status?: string;
    output?: string | string[] | null;
    error?: string | null;
    urls?: { get?: string };
  };
  let pred = await create.json() as Prediction;
  if (pred.error) {
    console.error('replicate error', pred.error);
    return null;
  }

  // Already done in the first response (Prefer:wait worked) — short-circuit.
  if (pred.status === 'succeeded' && pred.output) {
    return Array.isArray(pred.output) ? pred.output[0] : pred.output;
  }

  // Otherwise poll until terminal. flux-schnell finishes in 1-3s typically;
  // we cap at 60 polls × 1s = 60s before giving up on a single prediction.
  const pollUrl = pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!r.ok) {
      console.error('replicate poll failed', r.status);
      return null;
    }
    pred = await r.json() as Prediction;
    if (pred.status === 'succeeded' && pred.output) {
      return Array.isArray(pred.output) ? pred.output[0] : pred.output;
    }
    if (pred.status === 'failed' || pred.status === 'canceled') {
      console.error('replicate prediction', pred.status, pred.error);
      return null;
    }
  }
  console.error('replicate poll timeout');
  return null;
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

  // Admin-only (REPLICATE costs money). Two accepted credentials:
  //   * x-jobs-secret matching JOBS_RUNNER_SECRET (the process-jobs pattern —
  //     what the /api/generate-cover proxy sends), or
  //   * legacy: Authorization bearer string-equal to the runtime's
  //     SUPABASE_SERVICE_ROLE_KEY. NOTE this broke once already: the project
  //     migrated to the new API-key system, so the injected value no longer
  //     matches the legacy JWT a caller holds. Prefer the shared secret.
  const auth = req.headers.get('Authorization');
  const jobsSecret = Deno.env.get('JOBS_RUNNER_SECRET');
  const secretOk = !!jobsSecret && req.headers.get('x-jobs-secret') === jobsSecret;
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (!secretOk && auth !== expected) {
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
    // Replicate's free/default tier rate-limits at ~1 prediction every 2s
    // (429 if you fire faster). Sleep BEFORE every call so we never exceed
    // it, then let the polling helper do its thing.
    await new Promise((r) => setTimeout(r, 2500));
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
    // Pacing happens at the top of the loop now (sleep BEFORE each Replicate
    // call) so we never trip the 1-prediction/~2s rate limit.
  }

  return new Response(
    JSON.stringify({ processed: results.length, results }),
    { status: 200, headers: { ...corsHeaders, 'content-type': 'application/json' } },
  );
});

// classify-photos — AI batch photo time-of-day classifier.
//
// For each place with a photo_url and no photo_time_of_day yet, asks Claude
// vision to label the photo as day | dusk | evening | any. Writes the verdict
// to places.photo_time_of_day and an audit row to place_reviews.
//
// Auth: service-role bearer required (admin-only). Verify_jwt is OFF on the
// deploy (we authenticate manually so we can use a non-user secret).
//
// Invoke:
//   curl -X POST $URL/functions/v1/classify-photos \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"batch_size": 25}'

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

interface ClassifyResult {
  time_of_day: 'day' | 'dusk' | 'evening' | 'any';
  confidence: number;
  notes: string;
}

async function classifyPhoto(
  apiKey: string,
  photoUrl: string,
  placeName: string,
  placeType: string,
): Promise<ClassifyResult | null> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: photoUrl } },
          {
            type: 'text',
            text: `Photo of "${placeName}" (a ${placeType}). Classify by visible time of day.

Return JSON only, no prose:
{
  "time_of_day": "day" | "dusk" | "evening" | "any",
  "confidence": 0.0-1.0,
  "notes": "brief reason, 15 words max"
}

Rules:
- "day": clearly daytime, blue sky or bright sunlight
- "dusk": golden hour, sunset, twilight, magic hour
- "evening": after dark, artificial lighting, night sky, lit interior at night
- "any": no time-of-day signal — interior close-up, food shot, product shot, abstract texture`,
          },
        ],
      }],
    }),
  });

  if (!response.ok) {
    console.error('claude error', response.status, await response.text());
    return null;
  }

  const data = await response.json() as { content?: Array<{ text?: string }> };
  const text = data.content?.[0]?.text;
  if (!text) return null;

  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned) as ClassifyResult;
    if (!['day', 'dusk', 'evening', 'any'].includes(parsed.time_of_day)) return null;
    return parsed;
  } catch {
    console.error('parse error', text);
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Admin gate: require service-role bearer. Verify_jwt is off on this fn so
  // we authenticate manually here. The service role key is only on our boxes.
  const auth = req.headers.get('Authorization');
  const expected = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (auth !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => ({})) as { batch_size?: number; force?: boolean };
  const batchSize = Math.min(50, Math.max(1, body.batch_size ?? 10));
  const force = body.force === true;

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let query = supabase
    .from('places')
    .select('id, name, type, photo_url')
    .not('photo_url', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(batchSize);
  if (!force) query = query.is('photo_time_of_day', null);

  const { data: places, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
  if (!places || places.length === 0) {
    return new Response(JSON.stringify({ message: 'nothing to classify', processed: 0 }), {
      status: 200,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')!;
  const results: Array<Record<string, unknown>> = [];

  for (const place of places) {
    if (!place.photo_url) continue;

    const result = await classifyPhoto(apiKey, place.photo_url, place.name, place.type);
    if (!result) {
      results.push({ id: place.id, name: place.name, error: 'classify failed' });
      continue;
    }

    const { error: updateErr } = await supabase
      .from('places')
      .update({
        photo_time_of_day: result.time_of_day,
        last_ai_review_at: new Date().toISOString(),
        last_ai_review_confidence: result.confidence,
      })
      .eq('id', place.id);

    if (updateErr) {
      results.push({ id: place.id, name: place.name, error: updateErr.message });
      continue;
    }

    await supabase.from('place_reviews').insert({
      place_id: place.id,
      reviewer_type: 'ai',
      reviewer_id: 'photo-classifier-v1',
      action: 'enrich',
      after_data: { photo_time_of_day: result.time_of_day },
      notes: result.notes,
      confidence: result.confidence,
    });

    results.push({
      id: place.id,
      name: place.name,
      time_of_day: result.time_of_day,
      confidence: result.confidence,
    });

    // Light pacing to avoid rate limits.
    await new Promise((r) => setTimeout(r, 250));
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 200,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
});

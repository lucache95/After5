import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { browseFeed, type FeedFilters, type FeedNight } from '@after5/api-client';
import { feedColdStartTier } from '@after5/business';
import { signBlurredUrls } from '@/lib/after5/photos';
import { SwipeDeck } from './SwipeDeck';

export const dynamic = 'force-dynamic';

export default async function FeedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/feed');
  // Seed feed_filters alongside the gate read so SwipeDeck knows whether a HARD
  // filter is active (filtered-empty vs genuinely-empty) and the chips reflect values.
  const { data: p } = await supabase
    .from('profiles').select('dating_enabled, verification, feed_filters').eq('id', user.id).maybeSingle();
  if (!p?.dating_enabled || p.verification !== 'verified') redirect('/onboarding');

  // feed_filters is jsonb; the inclusive default is an empty object.
  const filters = (p.feed_filters ?? {}) as FeedFilters;
  const nights = await browseFeed(supabase, { limit: 20 }).catch(() => []);

  // E15 (REQ-E15 / D-01): sign the host blurred-photo PATHS server-side (the RPC returns
  // relative paths; only the app can mint signed urls). PRIVACY INVARIANT: we sign ONLY
  // the blurred path here; the clear-photo signer is never reachable from the feed. A
  // signing failure degrades to a null avatar (no host hint), never crashes the feed
  // (mirrors the browseFeed .catch resilience above).
  const revealed = await revealHostHints(supabase, nights);

  const tier = feedColdStartTier({ compatibleOpen: nights.length, totalOpen: nights.length });
  return <SwipeDeck initial={revealed} tier={tier} userId={user.id} filters={filters} />;
}

// Replace each FeedNight's host_blurred_photo_url RELATIVE PATH with a signed url, using
// the viewer's RLS'd session client. Batch-sign the distinct paths once, then map back.
// Signing is resilient: any failure drops the avatar (null) for every row rather than
// throwing — the night + plan are still browsable. Clear photos are NEVER signed here.
async function revealHostHints(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nights: FeedNight[],
): Promise<FeedNight[]> {
  const paths = Array.from(
    new Set(nights.map((n) => n.host_blurred_photo_url).filter((p): p is string => !!p)),
  );
  if (paths.length === 0) return nights;

  const signedByPath = new Map<string, string>();
  try {
    const urls = await signBlurredUrls(supabase, paths);
    // signBlurredUrls drops null signed urls, so positional path↔url alignment only
    // holds when every path signed. If any dropped, skip the by-index map (a mis-pair
    // would show one host's blurred avatar under another's hint) and degrade to no
    // avatar — the name+age hint still renders, just without the face.
    if (urls.length === paths.length) {
      paths.forEach((path, idx) => signedByPath.set(path, urls[idx]!));
    }
  } catch {
    // Degrade to no host avatar — never crash the feed over a signing hiccup.
    return nights.map((n) => ({ ...n, host_blurred_photo_url: null }));
  }

  return nights.map((n) => ({
    ...n,
    host_blurred_photo_url: n.host_blurred_photo_url
      ? signedByPath.get(n.host_blurred_photo_url) ?? null
      : null,
  }));
}

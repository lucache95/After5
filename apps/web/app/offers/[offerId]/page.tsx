// apps/web/app/offers/[offerId]/page.tsx
// Server entry for the candidate's offer screen (spec §4.2). Mirrors the host
// interested page: createClient() → getUser() → flag → recipient check → own
// account gate → render the client child. Every read runs under the candidate's
// SSR (RLS-bound) client:
//   - offers: offers_party_read lets the candidate read an offer addressed to them.
//   - profiles (host): match_reveal_allowed exposes the host's Tier-3 reveal.
//   - date_instances: the offer-recipient read policy (migration 127500) lets the
//     candidate read the offered night; if it's still hidden the embed comes back
//     null and OfferDetail degrades to "details unlock when you accept".
//   - feature_config: client-readable (migration 127300).
// The offers embeds are FK-hinted (bug class 3): offers has two FKs to profiles
// (creator_id + candidate_id) and one to date_instances, so an unhinted embed
// errors PGRST201. instanceId comes from the offers.date_instance_id COLUMN (always
// readable) so withdraw works even when the embedded instance row is RLS-hidden.
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ComingSoonBanner } from '@/components/ComingSoonBanner';
import { OfferDetail } from './OfferDetail';
import { AccountGate, deriveGateReason } from './AccountGate';

export const dynamic = 'force-dynamic';

export default async function OfferPage({
  params,
}: {
  params: Promise<{ offerId: string }>;
}) {
  const { offerId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/offers/${offerId}`);

  const { data: flagRow } = await supabase
    .from('feature_config').select('value').eq('key', 'match_v2_enabled').maybeSingle();
  if (flagRow?.value !== true) return <ComingSoonBanner />;

  const { data: offer } = await supabase
    .from('offers')
    .select(`id, status, expires_at, candidate_id, creator_id, date_instance_id,
      host:profiles!offers_creator_id_fkey ( first_name, age, city, clear_photo_url, bio ),
      instance:date_instances!offers_date_instance_id_fkey ( starts_at )`)
    .eq('id', offerId)
    .maybeSingle();

  if (!offer || offer.candidate_id !== user.id) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-shell-base px-8 text-center">
        <div className="mx-auto max-w-[420px]">
          <h1 className="font-heading text-5xl lowercase leading-[1.05] text-shell-ink">not your offer</h1>
          <p className="mt-4 font-body text-lg text-shell-ink/70">this one was sent to someone else.</p>
        </div>
      </main>
    );
  }

  const { data: me } = await supabase
    .from('profiles')
    .select('dating_enabled, verification, standing, account_state')
    .eq('id', user.id)
    .maybeSingle();
  const reason = me ? deriveGateReason(me) : null;
  if (reason) return <AccountGate reason={reason} />;

  const host = (offer.host ?? {}) as {
    first_name?: string | null; age?: number | null; city?: string | null; clear_photo_url?: string | null; bio?: string | null;
  };
  const instance = (offer.instance ?? null) as { starts_at?: string | null } | null;

  return (
    <OfferDetail
      offerId={offer.id}
      instanceId={offer.date_instance_id ?? null}
      expiresAt={offer.expires_at}
      status={offer.status}
      host={{
        first_name: host.first_name ?? 'someone',
        age: host.age ?? null,
        city: host.city ?? null,
        photo_url: host.clear_photo_url ?? null,
        bio: host.bio ?? null,
      }}
      date={instance?.starts_at ? { startsAt: instance.starts_at } : null}
    />
  );
}

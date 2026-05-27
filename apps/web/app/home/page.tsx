// FirstSessionHome — the post-onboarding destination. State is reconstructed from
// server state on every visit. The gallery + explainer ALWAYS render (never a dead
// end); one primary action per state.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { badgeFor } from '@after5/business';
import type { VerificationState } from '@after5/validators';
import { homeState, primaryActionFor, itineraryToTeaser, type ItineraryRow } from '@/lib/onboarding/teaser';
import { HomeStateBanner } from './HomeStateBanner';
import { MechanicExplainer } from './MechanicExplainer';
import { TeaserGallery } from './TeaserGallery';
import { RegisterDeviceOnLoad } from './RegisterDeviceOnLoad';

export const dynamic = 'force-dynamic';

export default async function FirstSessionHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/home');

  const [{ data: profile }, { data: itineraries }] = await Promise.all([
    supabase.from('profiles').select('first_name, verification, dating_enabled, reliability_score, onboarding_step').eq('id', user.id).maybeSingle(),
    supabase.from('itineraries')
      .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, cover_image_url')
      .eq('is_public', true).not('slug', 'is', null).order('generated_at', { ascending: false }).limit(6),
  ]);

  if ((profile?.onboarding_step ?? 'age_gate') !== 'done') redirect('/onboarding');

  const verification = (profile?.verification ?? 'unverified') as VerificationState;
  const state = homeState({ verification, dating_enabled: profile?.dating_enabled ?? false });
  const action = primaryActionFor(state);
  const badge = badgeFor({ verification, reliability_score: profile?.reliability_score ?? null });
  const cards = ((itineraries ?? []) as unknown as ItineraryRow[]).map(itineraryToTeaser);
  const firstName = profile?.first_name || 'there';

  return (
    <main className="min-h-screen bg-background">
      <RegisterDeviceOnLoad />
      <header className="border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">After5</Link>
        </nav>
      </header>

      <div className="mx-auto max-w-content px-6 pb-24 pt-12 md:px-10">
        <section>
          {badge.verified && (
            <div className="mb-4 inline-flex items-center gap-2 rounded-pill bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-800">
              Verified{badge.isNew ? ' · New' : ''}
            </div>
          )}
          <h1 className="font-display text-3xl font-bold leading-tight text-text md:text-5xl">
            Welcome to After5, <span className="italic text-accent">{firstName}</span>.
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-secondary md:text-base">
            We&apos;re warming up your first Kelowna nights. We&apos;ll text you the moment matches are ready.
          </p>

          <div className="mt-7">
            <HomeStateBanner state={state} />
            {/* Exactly one primary action per state: for pending/failed/dating_off
                the banner carries it, so the page CTA shows only when verified
                (the only state whose action is 'explore'). */}
            {action.kind === 'explore' && (
              <Link href={action.href}
                className="inline-flex items-center justify-center rounded-pill bg-text px-7 py-3.5 text-[15px] font-medium text-background transition-all hover:-translate-y-0.5">
                {action.label}
              </Link>
            )}
          </div>
        </section>

        <MechanicExplainer />
        <TeaserGallery cards={cards} />

        <section className="mt-14 rounded-card border border-border bg-surface p-6 text-center">
          <p className="text-sm text-secondary">Know someone who&apos;d love this? <Link href="/" className="font-medium text-accent underline underline-offset-4">Invite a friend</Link> to help us light up Kelowna faster.</p>
        </section>
      </div>
    </main>
  );
}

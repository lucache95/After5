// FirstSessionHome — the post-onboarding destination. State is reconstructed from
// server state on every visit. The gallery + explainer ALWAYS render (never a dead
// end); one primary action per state.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { badgeFor, canEnableDating } from '@after5/business';
import type { VerificationState } from '@after5/validators';
import { homeState, primaryActionFor, itineraryToTeaser, type ItineraryRow } from '@/lib/onboarding/teaser';
import { HomeStateBanner } from './HomeStateBanner';
import { MechanicExplainer } from './MechanicExplainer';
import { TeaserGallery } from './TeaserGallery';
import { RegisterDeviceOnLoad } from './RegisterDeviceOnLoad';
import { BottomTabShell } from '@/components/BottomTabShell';

export const dynamic = 'force-dynamic';

export default async function FirstSessionHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/home');

  const [{ data: profile }, { data: itineraries }, { data: priv }] = await Promise.all([
    supabase.from('profiles').select('first_name, verification, dating_enabled, reliability_score, onboarding_step').eq('id', user.id).maybeSingle(),
    supabase.from('itineraries')
      .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, cover_image_url')
      .eq('is_public', true).not('slug', 'is', null).order('generated_at', { ascending: false }).limit(6),
    supabase.from('profiles_private').select('birthdate').eq('user_id', user.id).maybeSingle(),
  ]);

  if ((profile?.onboarding_step ?? 'age_gate') !== 'done') redirect('/onboarding');

  const verification = (profile?.verification ?? 'unverified') as VerificationState;
  const state = homeState({ verification, dating_enabled: profile?.dating_enabled ?? false });
  const action = primaryActionFor(state);
  const badge = badgeFor({ verification, reliability_score: profile?.reliability_score ?? null });
  const gate = canEnableDating({
    birthdate: (priv?.birthdate as string | null) ?? null,
    verification,
    onboarding_step: profile?.onboarding_step ?? 'age_gate',
  });
  const cards = ((itineraries ?? []) as unknown as ItineraryRow[]).map(itineraryToTeaser);
  const firstName = profile?.first_name || 'there';

  return (
    <main className="min-h-dvh bg-shell-base">
      <RegisterDeviceOnLoad />
      <header className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav aria-label="masthead" className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 py-3.5">
          <Link href="/" className="font-heading text-2xl lowercase text-shell-accent">after5</Link>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[420px] px-5 pb-28 pt-8">
        <section>
          {badge.verified && (
            <div className="mb-5 inline-flex items-center gap-1.5 rounded-full bg-shell-pink px-3 py-1 font-body text-[12px] font-semibold lowercase text-shell-ink ring-1 ring-shell-accent/15">
              verified{badge.isNew ? ' · new here' : ''}
            </div>
          )}
          <h1 className="font-heading text-5xl lowercase leading-[1.02] text-shell-ink">
            hey {firstName}
          </h1>
          <p className="mt-3 max-w-sm font-body text-[15px] leading-relaxed text-shell-ink/65">
            we&apos;re warming up your first nights nearby. check back as matches open up.
          </p>

          <div className="mt-6">
            <HomeStateBanner state={state} gate={{ ok: gate.ok, reason: gate.reason }} />
            {/* Exactly one primary action per state: for pending/failed/dating_off
                the banner carries it, so the page CTA shows only when verified
                (the only state whose action is 'explore'). Pink lives on the
                primary CTA only; the secondary is outlined ink. */}
            {action.kind === 'explore' && (
              <div className="mt-5 flex flex-wrap gap-3">
                <a
                  href="/feed"
                  className="rounded-full bg-shell-accent px-6 py-3 font-body text-[15px] font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
                >
                  browse tonight&apos;s nights
                </a>
                <a
                  href="/nights/new"
                  className="rounded-full border-2 border-shell-ink/15 px-6 py-3 font-body text-[15px] font-semibold lowercase text-shell-ink transition hover:border-shell-ink/30 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/60 motion-reduce:transition-none"
                >
                  post a night
                </a>
              </div>
            )}
          </div>
        </section>

        <MechanicExplainer />
        <TeaserGallery cards={cards} />

        <section className="mt-14 rounded-3xl bg-shell-pink/60 p-6 text-center ring-1 ring-shell-accent/10">
          <p className="font-body text-sm leading-relaxed text-shell-ink/70">
            know someone who&apos;d get it?{' '}
            <Link href="/" className="font-semibold text-shell-accent underline decoration-2 underline-offset-4">drag a friend in</Link>{' '}
            and light up your city faster.
          </p>
        </section>
      </div>

      <BottomTabShell />
    </main>
  );
}

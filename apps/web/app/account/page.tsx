// Authenticated dating account / home surface (Barbiecore — DESIGN-SYSTEM §1–4).
// Reframed from the legacy planner dashboard: shell.* tokens, font-heading/body,
// lowercase dry copy, phone-width 420px, BottomTabShell. The dating loop is the
// primary IA (your nights / matches / messages / post a night); saved plans +
// the planner picks live below as the discreet wedge so this is never a
// planner-only dead-end. Links all still work.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Heart, Compass, CalendarPlus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Polaroid } from '@/components/Polaroid';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationBell } from '@/components/NotificationBell';
import { coverImageFor } from '@/lib/place-image';
import { relativeTime } from '@/lib/relative-time';
import type { Stop } from '@/lib/itinerary-types';

export const dynamic = 'force-dynamic';

interface SavedRow {
  id: string;
  saved_at: string;
  itinerary: {
    id: string;
    slug: string | null;
    title: string | null;
    total_cost_pp: number | null;
    total_duration_min: number | null;
    stops: unknown;
    cover_image_url: string | null;
  } | null;
}

// Primary dating loop — these are the live surfaces, matching BottomTabShell.
const LOOP: { href: string; label: string; desc: string; Icon: typeof Heart }[] = [
  { href: '/feed', label: 'browse nights', desc: "see who's out", Icon: Compass },
  { href: '/matches', label: 'your matches', desc: 'locked-in plans', Icon: Heart },
  { href: '/my-nights', label: 'your nights', desc: 'nights you posted', Icon: CalendarPlus },
];

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/account');
  }

  const [profileRes, savedRes, savedCountRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('first_name')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('saved_plans')
      .select('id, saved_at, itinerary:itineraries(id, slug, title, total_cost_pp, total_duration_min, stops, cover_image_url)')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })
      .limit(6),
    supabase
      .from('saved_plans')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ]);

  const profile = profileRes.data;
  const saved = (savedRes.data ?? []) as unknown as SavedRow[];
  const savedTotal = savedCountRes.count ?? saved.length;

  const firstName = (profile?.first_name || user.email?.split('@')[0] || 'you').toLowerCase();

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav aria-label="masthead" className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 py-3.5">
          <Link href="/" className="font-heading text-2xl lowercase text-shell-accent">after5</Link>
          <NotificationBell />
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[420px] px-5 pb-28 pt-8">
        {/* HELLO */}
        <h1 className="font-heading text-4xl lowercase leading-[1.05] text-shell-ink">
          hey {firstName}
        </h1>
        <p className="mt-2 font-body text-sm text-shell-ink/60">
          your dating home. pick up where you left off.
        </p>

        {/* DATING LOOP — primary IA */}
        <section aria-label="your dating loop" className="mt-7 space-y-3">
          {LOOP.map(({ href, label, desc, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-4 transition hover:border-shell-ink/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-shell-pink">
                <Icon className="h-5 w-5 text-shell-accent" strokeWidth={2.25} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-heading text-xl lowercase leading-tight text-shell-ink">{label}</p>
                <p className="mt-0.5 font-body text-xs text-shell-ink/60">{desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-shell-ink/40" strokeWidth={2.25} aria-hidden />
            </Link>
          ))}
        </section>

        {/* POST A NIGHT — primary CTA */}
        <Link
          href="/nights/new"
          className="mt-4 flex items-center justify-center gap-2 rounded-full bg-shell-accent px-6 py-3.5 font-body font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 motion-reduce:transition-none motion-reduce:hover:scale-100"
        >
          post a night
          <ArrowRight className="h-4 w-4" strokeWidth={2.5} aria-hidden />
        </Link>

        {/* SAVED PLANS — the planner wedge, secondary */}
        <section aria-label="saved plans" className="mt-12">
          <div className="flex items-end justify-between gap-3">
            <h2 className="font-heading text-2xl lowercase text-shell-ink">saved plans</h2>
            {savedTotal > 0 && (
              <span className="font-body text-xs text-shell-ink/50 [font-variant-numeric:tabular-nums]">
                {savedTotal}
              </span>
            )}
          </div>
          <p className="mt-1 font-body text-xs text-shell-ink/60">
            ideas you tucked away. turn one into a night.
          </p>

          {saved.length === 0 ? (
            <div className="mt-5 rounded-3xl border-2 border-dashed border-shell-ink/15 bg-white/60 p-6 text-center">
              <p className="font-heading text-xl lowercase text-shell-ink">nothing saved yet</p>
              <p className="mt-1.5 font-body text-sm text-shell-ink/60">
                build a plan, hit the heart, and it lands here.
              </p>
              <Link
                href="/create"
                className="mt-4 inline-block rounded-full border-2 border-shell-ink/15 px-5 py-2.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-accent/50 hover:text-shell-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
              >
                plan a date
              </Link>
            </div>
          ) : (
            <>
              <div className="mt-5 grid grid-cols-2 gap-x-3 gap-y-8">
                {saved.map((s, i) => {
                  if (!s.itinerary) return null;
                  const stops = (Array.isArray(s.itinerary.stops) ? s.itinerary.stops : []) as Stop[];
                  const cover = coverImageFor(stops, { itineraryCover: s.itinerary.cover_image_url });
                  const hr = Math.round(((s.itinerary.total_duration_min ?? 0) / 60) * 10) / 10;
                  return (
                    <article key={s.id} className="min-w-0">
                      <Polaroid
                        src={cover}
                        alt={s.itinerary.title ?? 'saved plan'}
                        label={(s.itinerary.title ?? 'saved').toLowerCase().slice(0, 18)}
                        size="md"
                        tone="dating"
                        rotation={(i % 2 === 0 ? -1 : 1) * (2 + (i % 3))}
                        href={s.itinerary.slug ? `/dates/${s.itinerary.slug}` : `/plan/i/${s.itinerary.id}`}
                      />
                      <div className="mt-2 px-1">
                        <p className="line-clamp-2 font-body text-[13px] font-medium text-shell-ink">
                          {s.itinerary.title}
                        </p>
                        <p className="mt-0.5 font-body text-[11px] text-shell-ink/50 [font-variant-numeric:tabular-nums]">
                          ${Math.round(s.itinerary.total_cost_pp ?? 0)} · {hr} hr · {relativeTime(s.saved_at)}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </div>
              {savedTotal > saved.length && (
                <Link
                  href="/account/saved"
                  className="mt-6 flex items-center justify-center gap-2 rounded-full border-2 border-shell-ink/15 px-5 py-3 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-accent/50 hover:text-shell-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
                >
                  see all {savedTotal} saved
                  <ArrowRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                </Link>
              )}
            </>
          )}
        </section>

        {/* SETTINGS / SIGNED-IN AS */}
        <section aria-label="account" className="mt-12 border-t border-shell-ink/10 pt-8">
          <h2 className="font-heading text-2xl lowercase text-shell-ink">your account</h2>
          <p className="mt-2 font-body text-sm text-shell-ink/60">
            signed in as <span className="text-shell-ink">{user.email}</span>.
          </p>
          {/* profile edit lives on its own surface (owned elsewhere) */}
          <Link
            href="/account/profile"
            className="mt-4 inline-flex items-center gap-2 font-body text-sm lowercase text-shell-accent underline decoration-shell-accent/30 underline-offset-4 transition hover:decoration-shell-accent"
          >
            edit profile
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
          </Link>
          <form action="/auth/signout" method="post" className="mt-6">
            <button
              type="submit"
              className="rounded-full border-2 border-shell-ink/15 px-5 py-2.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-ink/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
            >
              sign out
            </button>
          </form>
        </section>
      </div>

      <BottomTabShell />
    </main>
  );
}

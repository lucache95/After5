// Authenticated dashboard. Warm-cream canvas with polaroid accents;
// the "your home" page after signing in.
//
// Sections:
//   - Hero greeting (italic accent) + tonight sub-line + primary CTA
//   - Your Dates: polaroid grid of saved plans (or empty state)
//   - Picks for this week: recent public itineraries
//   - Inspiration board: themes
//   - Your spot block + settings sub-section

import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Polaroid } from '@/components/Polaroid';
import { UserMenu } from '@/components/UserMenu';
import { ProfileForm } from './ProfileForm';
import { coverImageFor } from '@/lib/place-image';
import { PLAN_THEMES } from '@/lib/themes';
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
  } | null;
}

interface PickRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  stops: unknown;
  generated_at: string;
}

const EARLY_ACCESS_CAP = 100;

// Per-theme background swatch — pulls from the existing /vibes images
// so themes get real Okanagan photography in their preview tiles.
const THEME_IMAGE: Record<string, string> = {
  first_date_safe:    '/vibes/vibe-chill.jpg',
  rom_com_night:      '/vibes/vibe-cozy.jpg',
  main_character_day: '/vibes/vibe-boujee.jpg',
  slow_sunday:        '/vibes/vibe-chill.jpg',
  no_phones:          '/vibes/vibe-adventurous.jpg',
};

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/account');
  }

  // Subscribers count needs the admin client — RLS on subscribers only
  // permits INSERT for anon/authed users, so a user-context SELECT
  // returns 0 (which made "Your spot" misalign with the banner).
  const admin = createAdminClient();

  // Parallel data fetch — profile, saved plans, picks, total signups.
  const [profileRes, savedRes, picksRes, countRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('first_name, city, neighborhood, created_at')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('saved_plans')
      .select('id, saved_at, itinerary:itineraries(id, slug, title, total_cost_pp, total_duration_min, stops)')
      .eq('user_id', user.id)
      .order('saved_at', { ascending: false })
      .limit(12),
    supabase
      .from('itineraries')
      .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops, generated_at')
      .eq('is_public', true)
      .not('slug', 'is', null)
      .order('generated_at', { ascending: false })
      .limit(4),
    admin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .neq('source', 'seed_demo'),
  ]);

  const profile = profileRes.data;
  const saved = (savedRes.data ?? []) as unknown as SavedRow[];
  const picks = (picksRes.data ?? []) as unknown as PickRow[];
  const claimed = countRes.count ?? 0;
  const remaining = Math.max(0, EARLY_ACCESS_CAP - claimed);

  const firstName = profile?.first_name || user.email?.split('@')[0] || 'there';
  const totalSavedCount = saved.length;

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      {/* Ambient warm gradient */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-32 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-amber-200/45 via-orange-200/25 to-transparent blur-3xl" />
        <div className="absolute -right-40 top-72 h-[520px] w-[520px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <header className="relative z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">
            After5
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/plan"
              className="hidden items-center gap-2 rounded-pill bg-text px-5 py-2 text-sm font-medium text-background transition-transform hover:-translate-y-0.5 sm:inline-flex"
            >
              Plan a date
            </Link>
            <UserMenu variant="on-light" />
          </div>
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-content px-6 pb-20 pt-12 md:px-10 md:pb-28 md:pt-16">
        {/* HERO GREETING */}
        <section className="grid grid-cols-1 gap-10 md:grid-cols-[1.3fr_1fr] md:gap-14">
          <div>
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Your home
            </p>
            <h1 className="font-display text-[44px] font-bold leading-[1.02] tracking-[-0.03em] text-text md:text-[60px]">
              Hello,{' '}
              <span className="italic font-semibold text-accent">{firstName}</span>
              .
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-secondary md:text-base">
              {totalSavedCount > 0
                ? `You've saved ${totalSavedCount} ${totalSavedCount === 1 ? 'plan' : 'plans'}. Tonight in Kelowna is wide open — want to add one more?`
                : "You haven't saved any plans yet. Let's fix that."}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href="/plan"
                className="inline-flex items-center gap-2 rounded-pill bg-text px-7 py-3.5 text-base font-medium text-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]"
              >
                Plan tonight
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
              </Link>
              <Link
                href="/dates"
                className="text-sm font-medium text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
              >
                Browse what others built
              </Link>
            </div>
          </div>

          {/* Polaroid stack accent */}
          <div className="relative hidden min-h-[280px] md:block">
            <div className="absolute right-12 top-0">
              <Polaroid
                src="/pins/couple-trail.jpg"
                alt="Okanagan trail"
                label="KELOWNA · 26"
                size="lg"
                rotation={-6}
              />
            </div>
            <div className="absolute right-0 top-32">
              <Polaroid
                src="/pins/couple-lake-kiss.jpg"
                alt="Lake Okanagan"
                label="LAKESIDE"
                size="md"
                rotation={8}
              />
            </div>
          </div>
        </section>

        {/* YOUR DATES */}
        <section className="mt-20 md:mt-28">
          <div className="mb-8 flex items-end justify-between gap-4">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                Your collection
              </p>
              <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-text md:text-3xl">
                Saved dates
              </h2>
            </div>
            {saved.length > 0 && (
              <p className="text-xs text-muted [font-variant-numeric:tabular-nums]">
                {saved.length} {saved.length === 1 ? 'plan' : 'plans'}
              </p>
            )}
          </div>

          {saved.length === 0 ? (
            <EmptyDates />
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
              {saved.map((s, i) => {
                if (!s.itinerary) return null;
                const stops = (Array.isArray(s.itinerary.stops) ? s.itinerary.stops : []) as Stop[];
                const cover = coverImageFor(stops);
                const hr = Math.round(((s.itinerary.total_duration_min ?? 0) / 60) * 10) / 10;
                return (
                  <article key={s.id} className="group relative">
                    <Polaroid
                      src={cover}
                      alt={s.itinerary.title ?? 'Saved plan'}
                      label={(s.itinerary.title ?? 'KELOWNA').toUpperCase().slice(0, 18)}
                      size="lg"
                      rotation={(i % 2 === 0 ? -1 : 1) * (3 + (i % 4))}
                      href={s.itinerary.slug ? `/dates/${s.itinerary.slug}` : `/plan/i/${s.itinerary.id}`}
                    />
                    <div className="mt-3 px-2">
                      <p className="line-clamp-2 text-[13px] font-medium text-text">
                        {s.itinerary.title}
                      </p>
                      <p className="mt-1 text-[11px] text-muted [font-variant-numeric:tabular-nums]">
                        ${Math.round(s.itinerary.total_cost_pp ?? 0)} · {hr} hr · saved {relativeTime(s.saved_at)}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* PICKS FOR THIS WEEK */}
        {picks.length > 0 && (
          <section className="mt-20 md:mt-28">
            <div className="mb-8">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                Curated by After5
              </p>
              <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-text md:text-3xl">
                Picks for this week
              </h2>
              <p className="mt-3 max-w-prose text-sm leading-relaxed text-secondary">
                Fresh plans we loved. New ones every Sunday.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-6">
              {picks.slice(0, 4).map((p) => {
                const stops = (Array.isArray(p.stops) ? p.stops : []) as Stop[];
                const cover = coverImageFor(stops);
                const hr = Math.round(((p.total_duration_min ?? 0) / 60) * 10) / 10;
                return (
                  <Link
                    key={p.id}
                    href={p.slug ? `/dates/${p.slug}` : '/dates'}
                    className="group flex gap-5 rounded-[16px] border border-amber-100/80 bg-white/85 p-3 backdrop-blur-md transition-all hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-[0_16px_40px_-16px_rgba(80,40,20,0.22)]"
                  >
                    <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[10px] bg-surface md:h-32 md:w-32">
                      <Image
                        src={cover}
                        alt=""
                        fill
                        sizes="128px"
                        className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.04]"
                      />
                    </div>
                    <div className="min-w-0 flex-1 py-1">
                      <h3 className="line-clamp-2 font-display text-base font-semibold leading-tight text-text">
                        {p.title}
                      </h3>
                      {p.hook && (
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-secondary">
                          {p.hook}
                        </p>
                      )}
                      <p className="mt-3 text-[11px] text-muted [font-variant-numeric:tabular-nums]">
                        ${Math.round(p.total_cost_pp ?? 0)} · {hr} hr · {stops.length} stops
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* INSPIRATION BOARD */}
        <section className="mt-20 md:mt-28">
          <div className="mb-8">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Inspiration board
            </p>
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-text md:text-3xl">
              Pick a vibe.{' '}
              <span className="italic font-semibold text-accent">We&apos;ll do the rest.</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
            {PLAN_THEMES.map((t) => {
              const img = THEME_IMAGE[t.id] ?? '/vibes/vibe-chill.jpg';
              return (
                <Link
                  key={t.id}
                  href={`/plan?theme=${t.id}`}
                  className="group block overflow-hidden rounded-[14px] border border-amber-100/60 bg-white/80 transition-all hover:-translate-y-0.5 hover:border-amber-200 hover:shadow-[0_16px_36px_-16px_rgba(80,40,20,0.25)]"
                >
                  <div className="relative aspect-[5/4] overflow-hidden bg-surface">
                    <Image
                      src={img}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 50vw, 20vw"
                      className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.04]"
                    />
                  </div>
                  <div className="p-4">
                    <p className="font-display text-sm font-semibold leading-tight text-text">
                      {t.label}
                    </p>
                    <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-secondary">
                      {t.desc}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* YOUR SPOT */}
        <section className="mt-20 md:mt-28">
          <div className="rounded-[20px] border border-amber-100 bg-gradient-to-br from-amber-50/90 via-white/80 to-rose-50/70 p-7 backdrop-blur-md md:p-10">
            <div className="grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto] md:gap-10">
              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-amber-900/80">
                  Your spot
                </p>
                <h2 className="font-display text-2xl font-bold leading-tight text-text md:text-3xl">
                  You&apos;re #{Math.min(claimed, EARLY_ACCESS_CAP)} of the first 100.
                </h2>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-secondary">
                  Forever free. We&apos;ll never charge you for plans, ever. Thanks for being early.
                </p>
                <div className="mt-5 h-2 w-full max-w-md overflow-hidden rounded-full bg-amber-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 via-rose-400 to-amber-500 transition-all"
                    style={{ width: `${Math.min(100, (claimed / EARLY_ACCESS_CAP) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] font-medium tracking-wide text-amber-900/70 [font-variant-numeric:tabular-nums]">
                  {claimed} claimed · {remaining} {remaining === 1 ? 'spot' : 'spots'} remaining
                </p>
              </div>
              {/* Polaroid accent */}
              <div className="hidden md:block">
                <Polaroid
                  src="/pins/couple-wakeboard.jpg"
                  alt="Okanagan sunset"
                  label="EARLY · CIRCLE"
                  size="md"
                  rotation={5}
                />
              </div>
            </div>
          </div>
        </section>

        {/* SETTINGS / PROFILE */}
        <section className="mt-20 md:mt-28">
          <div className="mb-8">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
              Profile
            </p>
            <h2 className="font-display text-2xl font-bold tracking-[-0.02em] text-text md:text-3xl">
              How we know you.
            </h2>
            <p className="mt-3 text-sm text-secondary">
              Signed in as <span className="text-text">{user.email}</span>.
            </p>
          </div>

          <div className="max-w-xl">
            <ProfileForm
              initial={{
                first_name: profile?.first_name ?? '',
                city: profile?.city ?? '',
                neighborhood: profile?.neighborhood ?? '',
              }}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function EmptyDates() {
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-amber-100/80 bg-white/70 p-8 backdrop-blur-md md:p-12">
      <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[auto_1fr] md:gap-12">
        <div className="flex justify-center">
          <Polaroid
            src="/pins/couple-field.jpg"
            alt="Saved plans land here"
            label="YOUR FIRST"
            size="lg"
            rotation={-4}
          />
        </div>
        <div>
          <p className="font-display text-xl font-semibold leading-snug text-text md:text-2xl">
            Your saved dates will live here.
          </p>
          <p className="mt-3 max-w-md text-[14px] leading-relaxed text-secondary">
            Built a plan you like? Hit the heart on the plan page and it&apos;ll appear in this collection — like polaroids tucked into a journal.
          </p>
          <Link
            href="/plan"
            className="mt-6 inline-flex items-center gap-2 rounded-pill bg-text px-6 py-3 text-sm font-medium text-background transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-10px_rgba(0,0,0,0.4)]"
          >
            Build your first
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </div>
      </div>
    </div>
  );
}

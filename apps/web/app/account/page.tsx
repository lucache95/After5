// Authenticated dating account / home surface (Barbiecore — DESIGN-SYSTEM §1–4).
// Reframed from the legacy planner dashboard: shell.* tokens, font-heading/body,
// lowercase dry copy, phone-width 420px, BottomTabShell. The dating loop is the
// primary IA (your nights / matches / messages / post a night); legacy saved-plans +
// the planner picks live below as the discreet wedge so this is never a
// planner-only dead-end. Links all still work.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Heart, Compass, CalendarPlus, Pencil, SlidersHorizontal, Bell, BadgeCheck, ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { Polaroid } from '@/components/Polaroid';
import { BottomTabShell } from '@/components/BottomTabShell';
import { NotificationToast } from '@/components/NotificationToast';
import { SelfViewTrigger } from '@/components/SelfViewTrigger';
import { listMyPhotos, signClearUrls } from '@/lib/after5/photos';
import type { DynamicPromptAnswer } from '@after5/validators';

export const dynamic = 'force-dynamic';

// Secondary settings links — equal-weight rows reusing the hub icon-well visual.
const SECONDARY: { href: string; label: string; desc: string; Icon: typeof Pencil }[] = [
  { href: '/account/profile', label: 'edit profile', desc: 'photos, bio, prompts', Icon: Pencil },
  { href: '/account/preferences', label: 'preferences', desc: 'who we line up for you', Icon: SlidersHorizontal },
  { href: '/account/notifications', label: 'notifications', desc: 'what pings you', Icon: Bell },
];

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

  const [profileRes, privRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('first_name, age, city, neighborhood, verification, clear_photo_url, vibe_tags, prompt_answers, pronouns, height_cm, occupation')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles_private')
      .select('bio')
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);

  const profile = profileRes.data;
  const bio = (privRes.data?.bio as string | null) ?? null;

  const firstName = (profile?.first_name || user.email?.split('@')[0] || 'you').toLowerCase();

  // Identity values for the header + self-view.
  const age = (profile?.age as number | null) ?? null;
  const city = (profile?.city as string | null) ?? null;
  const neighborhood = (profile?.neighborhood as string | null) ?? null;
  const place = neighborhood ?? city;
  const pronouns = (profile?.pronouns as string | null) ?? null;
  const occupation = (profile?.occupation as string | null) ?? null;
  const heightCm = (profile?.height_cm as number | null) ?? null;
  const verification = (profile?.verification as string | null) ?? 'unverified';
  const isVerified = verification === 'verified';
  const vibeTags = ((profile?.vibe_tags as string[] | null) ?? []).filter(Boolean);

  // Owner photo gallery for the self-view (gallery first, legacy single-photo
  // fallback) — owner read passes RLS. Same block as /account/profile.
  // width 400 ≈ the self-view ProfileCard slot at 2x; the sm identity polaroid
  // reuses the same (cached, stable) url so the bytes download once.
  let selfPhotos: string[] = [];
  try {
    const rows = await listMyPhotos(supabase, user.id);
    selfPhotos = await signClearUrls(supabase, rows.map((r) => r.clear_path), { width: 400 });
    if (selfPhotos.length === 0 && profile?.clear_photo_url) {
      selfPhotos = await signClearUrls(supabase, [profile.clear_photo_url as string], { width: 400 });
    }
  } catch {
    selfPhotos = [];
  }

  // Join prompt_answers to active prompt labels (same shape as the lock page).
  const promptAnswers = ((profile?.prompt_answers as DynamicPromptAnswer[] | null) ?? [])
    .filter((a) => a.answer?.trim());
  let prompts: { label: string; answer: string }[] = [];
  if (promptAnswers.length > 0) {
    const { data: defs } = await supabase
      .from('profile_prompts')
      .select('id, label')
      .in('id', promptAnswers.map((a) => a.prompt_id));
    const labelById = new Map((defs ?? []).map((d) => [d.id, d.label]));
    prompts = promptAnswers.map((a) => ({ label: labelById.get(a.prompt_id) ?? a.prompt_id, answer: a.answer }));
  }

  const profileIsBare = !bio?.trim() && prompts.length === 0 && vibeTags.length === 0;
  const primaryPhoto = selfPhotos[0] ?? null;

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-30 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav aria-label="masthead" className="mx-auto flex w-full max-w-[420px] items-center justify-between px-5 py-3.5">
          <Link href="/" className="font-heading text-2xl lowercase text-shell-accent">after5</Link>
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

        {/* IDENTITY — who you are, leading the hub */}
        <section aria-label="your identity" className="mt-7 flex items-center gap-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-4">
          <Polaroid
            src={primaryPhoto}
            alt={firstName}
            label={primaryPhoto ? undefined : firstName}
            size="sm"
            tone="dating"
            priority
          />
          <div className="min-w-0 flex-1">
            <p className="font-heading text-2xl lowercase leading-tight text-shell-ink">
              {age != null ? `${firstName}, ${age}` : firstName}
            </p>
            {(place || pronouns) && (
              <p className="mt-0.5 font-body text-sm lowercase text-shell-ink/60">
                {[place, pronouns].filter(Boolean).join(' · ')}
              </p>
            )}
            {isVerified ? (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-shell-pink px-2.5 py-1 font-body text-[12px] font-semibold lowercase text-shell-accent">
                <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                verified
              </span>
            ) : (
              <Link
                href="/onboarding/verify"
                className="mt-2 inline-flex items-center gap-1 rounded-full border border-shell-ink/15 px-2.5 py-1 font-body text-[12px] font-semibold lowercase text-shell-ink/60 transition hover:text-shell-ink focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
              >
                <ShieldAlert className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                unverified
              </Link>
            )}
          </div>
        </section>

        {/* DATING PROFILE SUMMARY — bio / prompts / vibe, or an authored empty-state */}
        <section aria-label="your dating profile" className="mt-4">
          {profileIsBare ? (
            <div className="rounded-3xl border-2 border-dashed border-shell-ink/15 bg-white/60 p-6 text-center">
              <p className="font-heading text-xl lowercase text-shell-ink">your profile&apos;s a little bare</p>
              <p className="mt-1.5 font-body text-sm text-shell-ink/60">
                add a bio and a couple prompts so people get the vibe.
              </p>
              <Link
                href="/account/profile"
                className="mt-4 inline-block rounded-full border-2 border-shell-ink/15 px-5 py-2.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-accent/50 hover:text-shell-accent focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
              >
                edit profile
              </Link>
            </div>
          ) : (
            <div className="space-y-4 rounded-3xl border-2 border-shell-ink/10 bg-white p-4">
              {bio?.trim() && (
                <p className="line-clamp-3 font-body text-base leading-relaxed text-shell-ink">{bio}</p>
              )}
              {vibeTags.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="your vibe tags">
                  {vibeTags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full bg-shell-ink/[0.06] px-3 py-1 font-body text-[13px] lowercase text-shell-ink/80"
                    >
                      {tag.toLowerCase()}
                    </li>
                  ))}
                </ul>
              )}
              {prompts.slice(0, 2).map((p) => (
                <div key={p.label} className="rounded-2xl bg-shell-ink/[0.04] p-4">
                  <p className="font-body text-[12px] font-semibold uppercase tracking-wide text-shell-ink/45">{p.label}</p>
                  <p className="mt-1.5 font-body text-[16px] leading-relaxed text-shell-ink">{p.answer}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SELF-VIEW — "as others see it". SelfViewTrigger is the thin client
            boundary that owns the open state and renders SelfViewSheet (which
            reuses ProfileCard); the page stays a server component and passes the
            owner's signed photos + fields down. */}
        <div className="mt-4">
          <SelfViewTrigger
            name={firstName}
            age={age}
            place={place}
            pronouns={pronouns}
            occupation={occupation}
            height_cm={heightCm}
            photos={selfPhotos}
            vibe_tags={vibeTags}
            prompts={prompts}
          />
        </div>

        {/* SECONDARY LINKS — edit / preferences / notifications */}
        <section aria-label="manage your account" className="mt-4 space-y-3">
          {SECONDARY.map(({ href, label, desc, Icon }) => (
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

        {/* saved-plans collection RETIRED (audit P2-F13): bookmarking is collection
            behavior, not going-out behavior — the loop is generate → publish → browse. */}

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

      <NotificationToast userId={user.id} />
      <BottomTabShell userId={user.id} />
    </main>
  );
}

// /about — the founder story + principles, in the dating-app Barbiecore
// language (shell tokens, Caprasimo/Fredoka, lowercase, dating-tone polaroids).

import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { Polaroid } from '@/components/Polaroid';
import { UserMenu } from '@/components/UserMenu';

export const metadata: Metadata = {
  title: 'about',
  description:
    'after5 is the dating app where you match on the night, not the face — built by people who actually go out.',
};

const PRINCIPLES = [
  {
    title: 'real places, sequenced honestly',
    body: 'we list a spot if we\'d send our friends. hours, travel time, and order matter — nothing closes mid-date on our watch.',
  },
  {
    title: 'the night comes first',
    body: 'you swipe on an actual plan, not a face. less small talk, more showing up. the experience is the hero.',
  },
  {
    title: 'everyone\'s verified',
    body: 'id-checked, every one. the person who shows up is the person from the photos. no catfish, no surprises.',
  },
];

export default function AboutPage() {
  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">
            after5
          </Link>
          <div className="flex items-center gap-3">
            <UserMenu variant="on-light" />
            <Link
              href="/onboarding"
              className="rounded-full bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
            >
              let&apos;s go
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[480px] px-6 pb-20 pt-12">
        {/* hero */}
        <section className="text-center">
          <div className="mb-8 flex items-end justify-center gap-2">
            <Polaroid tone="dating" src="/gallery/pottery-wheel.jpg" alt="two people laughing at a pottery wheel" size="sm" rotation={-7} className="-mr-2 translate-y-3" />
            <Polaroid tone="dating" src="/gallery/couple-dance-sunset.jpg" alt="a couple dancing against an orange sunset" label="real nights" size="md" rotation={2} />
            <Polaroid tone="dating" src="/gallery/rooftop-pizza-sunset.jpg" alt="friends sharing pizza on a rooftop at golden hour" size="sm" rotation={7} className="-ml-2 translate-y-4" />
          </div>
          <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
            about
          </p>
          <h1 className="font-heading text-4xl lowercase leading-[1.04] text-shell-ink md:text-5xl">
            dates built by people who go out
          </h1>
          <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70">
            after5 started with one frustration: dating apps make you match on a face, then figure out the night later. we flipped it. swipe on an actual plan, match on the vibe, show up to something real.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/onboarding"
              className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-8 py-3.5 font-body text-[15px] font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
            >
              let&apos;s go
              <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
            </Link>
            <Link
              href="/feed"
              className="font-body text-sm lowercase text-shell-ink/55 underline decoration-shell-ink/25 underline-offset-4 transition hover:text-shell-ink"
            >
              see what others posted
            </Link>
          </div>
        </section>

        {/* principles */}
        <section className="mt-16">
          <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
            how we work
          </p>
          <h2 className="font-heading text-2xl lowercase text-shell-ink">
            three things we won&apos;t compromise on
          </h2>

          <div className="mt-8 space-y-5">
            {PRINCIPLES.map((p, i) => (
              <div key={p.title} className="rounded-3xl border-2 border-shell-ink/10 bg-white p-6 shadow-fun">
                <p className="font-heading text-sm lowercase text-shell-accent [font-variant-numeric:tabular-nums]">
                  0{i + 1}
                </p>
                <h3 className="mt-2 font-heading text-lg lowercase leading-tight text-shell-ink">
                  {p.title}
                </h3>
                <p className="mt-2 font-body text-sm leading-relaxed text-shell-ink/65">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* the curator */}
        <section className="mt-16">
          <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
            who&apos;s behind it
          </p>
          <h2 className="font-heading text-2xl lowercase text-shell-ink">
            one person who&apos;s done every stop
          </h2>
          <p className="mt-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
            after5 is just me right now. every spot in the feed is one i&apos;d send a friend to. as we grow the plan is to bring on locals who actually know their scene — but until then, &quot;built by people who go out&quot; means me, with a notebook, on a tuesday night.
          </p>

          <div className="mt-8 flex justify-center">
            <TeamCard initial="l" name="lucas" role="founder" />
          </div>
        </section>

        {/* contact */}
        <section className="mt-16">
          <div className="rounded-3xl bg-shell-pink/60 p-6 ring-1 ring-shell-accent/10">
            <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
              questions, ideas, spots we&apos;re missing
            </p>
            <h2 className="font-heading text-2xl lowercase leading-tight text-shell-ink">
              email{' '}
              <a
                href="mailto:hello@tryafter5.app"
                className="text-shell-accent underline decoration-shell-accent/30 underline-offset-4 transition hover:decoration-shell-accent"
              >
                hello@tryafter5.app
              </a>
            </h2>
            <p className="mt-3 font-body text-sm leading-relaxed text-shell-ink/70">
              we read everything. especially: what you wished a night included, and which spots we should add.
            </p>
          </div>
        </section>
      </div>

      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-2">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-body text-xs lowercase text-shell-ink/45">
          <Link href="/roadmap" className="hover:text-shell-ink">roadmap</Link>
          <Link href="/privacy" className="hover:text-shell-ink">privacy</Link>
          <Link href="/terms" className="hover:text-shell-ink">terms</Link>
          <a href="mailto:hello@tryafter5.app" className="hover:text-shell-ink">hello@tryafter5.app</a>
        </div>
      </footer>
    </main>
  );
}

function TeamCard({
  initial,
  name,
  role,
}: {
  initial: string;
  name: string;
  role: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-shell-accent font-heading text-xl lowercase text-white shadow-fun ring-4 ring-white">
        {initial}
      </span>
      <p className="mt-4 font-heading text-base lowercase text-shell-ink">{name}</p>
      <p className="mt-1 font-body text-xs leading-relaxed text-shell-ink/65">{role}</p>
    </div>
  );
}

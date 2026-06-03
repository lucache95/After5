// /roadmap — radical-transparency page. what after5 is today, what's coming
// next, where money fits in, and an open invite for spots who want in.
// Dating-app Barbiecore language (shell tokens, Caprasimo/Fredoka, lowercase).

import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Check, Clock, Sparkles } from 'lucide-react';
import { Polaroid } from '@/components/Polaroid';
import { UserMenu } from '@/components/UserMenu';

export const metadata: Metadata = {
  title: 'roadmap · after5',
  description:
    'where after5 is today, what\'s coming next, and how we\'ll handle pricing. built in the open.',
};

interface Item {
  title: string;
  body: string;
}

const LIVE: Item[] = [
  {
    title: 'swipe on the night',
    body: 'browse real plans people posted for the week. match on the night, not the face.',
  },
  {
    title: 'match + lock in',
    body: 'you like a night, they like you back, you\'re locked in. then you actually plan it together.',
  },
  {
    title: 'in-app chat',
    body: 'once you match, sort the details right here. no number swap until you want to.',
  },
  {
    title: 'verified everyone',
    body: 'id-checked, every one. the person who shows up is the person from the photos.',
  },
];

const NEXT: Item[] = [
  {
    title: 'experience detail',
    body: 'tap a card for the full read before you swipe — hero photo, what to expect, host preview, vibe chips.',
  },
  {
    title: 'richer profiles',
    body: 'voice notes, prompts, opt-in pills. group-chat energy, not a resume.',
  },
  {
    title: 'more cities',
    body: 'same engine, local feed. tell us which one you want first.',
  },
  {
    title: 'the planner layer',
    body: 'just want to plan a night, no dating? that door stays open. build a plan, keep it private or post it to the feed.',
  },
];

export default function RoadmapPage() {
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
              href="/create"
              className="rounded-full bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
            >
              plan a night
            </Link>
          </div>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[480px] px-6 pb-20 pt-12">
        {/* hero */}
        <section className="text-center">
          <div className="mb-8 flex items-end justify-center gap-2">
            <Polaroid tone="dating" src="/gallery/bouldering-kiss.jpg" alt="two climbers kissing at a bouldering gym" size="sm" rotation={-7} className="-mr-2 translate-y-3" />
            <Polaroid tone="dating" src="/gallery/couple-dance-sunset.jpg" alt="a couple dancing against an orange sunset" label="what's next" size="md" rotation={2} />
            <Polaroid tone="dating" src="/gallery/ramen-couple.jpg" alt="a couple sharing ramen at a counter" size="sm" rotation={7} className="-ml-2 translate-y-4" />
          </div>
          <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
            building in the open
          </p>
          <h1 className="font-heading text-4xl lowercase leading-[1.04] text-shell-ink md:text-5xl">
            where after5 is going
          </h1>
          <p className="mx-auto mt-5 max-w-[420px] font-body text-[15px] leading-relaxed text-shell-ink/70">
            i&apos;m building this in public. here&apos;s what works today, what&apos;s coming next, and where money fits in. ideas?{' '}
            <a href="mailto:hello@tryafter5.app" className="text-shell-accent underline decoration-shell-accent/40 underline-offset-4 transition hover:decoration-shell-accent">
              email me
            </a>
            {' '}— i read everything.
          </p>
        </section>

        {/* live today */}
        <section className="mt-16">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 font-body text-[11px] font-semibold lowercase tracking-[0.12em] text-emerald-900 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> live now
          </span>
          <h2 className="mt-4 font-heading text-2xl lowercase text-shell-ink">
            what you can do today
          </h2>
          <div className="mt-7 space-y-4">
            {LIVE.map((item, i) => (
              <div
                key={item.title}
                className="rounded-3xl border-2 border-shell-ink/10 bg-white p-6 shadow-fun"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-4 w-4" strokeWidth={2.5} />
                  </span>
                  <p className="font-body text-[11px] font-semibold lowercase tracking-[0.12em] text-emerald-900 [font-variant-numeric:tabular-nums]">
                    shipped · 0{i + 1}
                  </p>
                </div>
                <h3 className="mt-3 font-heading text-lg lowercase leading-tight text-shell-ink">
                  {item.title}
                </h3>
                <p className="mt-2 font-body text-sm leading-relaxed text-shell-ink/65">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* what's next */}
        <section className="mt-16">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 font-body text-[11px] font-semibold lowercase tracking-[0.12em] text-amber-900 ring-1 ring-amber-200">
            <Clock className="h-3 w-3" strokeWidth={2.5} /> coming up
          </span>
          <h2 className="mt-4 font-heading text-2xl lowercase text-shell-ink">
            what i&apos;m building next
          </h2>
          <p className="mt-3 font-body text-sm leading-relaxed text-shell-ink/65">
            order subject to feedback. want one of these now?{' '}
            <a href="mailto:hello@tryafter5.app" className="text-shell-accent underline decoration-shell-accent/40 underline-offset-4 transition hover:decoration-shell-accent">
              say so
            </a>
            {' '}and it moves up.
          </p>
          <div className="mt-7 space-y-4">
            {NEXT.map((item, i) => (
              <div
                key={item.title}
                className="rounded-3xl border-2 border-shell-ink/10 bg-white p-6 shadow-fun"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950">
                    <Sparkles className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                  <p className="font-body text-[11px] font-semibold lowercase tracking-[0.12em] text-amber-900 [font-variant-numeric:tabular-nums]">
                    next · 0{i + 1}
                  </p>
                </div>
                <h3 className="mt-3 font-heading text-lg lowercase leading-tight text-shell-ink">
                  {item.title}
                </h3>
                <p className="mt-2 font-body text-sm leading-relaxed text-shell-ink/65">{item.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* money */}
        <section className="mt-16">
          <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
            money
          </p>
          <h2 className="font-heading text-2xl lowercase text-shell-ink">
            free now. probably not forever.
          </h2>
          <div className="mt-5 space-y-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
            <p>
              right now after5 costs you nothing. no card, no upsell, no &quot;trial.&quot; i&apos;m focused on building something people actually want to use — pricing comes after that.
            </p>
            <p>
              eventually i&apos;ll charge for something — probably a small subscription for premium features. the free tier will always exist.
            </p>
            <p>
              <span className="text-shell-ink">the deal for early users:</span> sign up while we&apos;re small and you get every future feature on the house, forever. a promise — written here so you can hold me to it.
            </p>
          </div>
        </section>

        {/* for business owners */}
        <section className="mt-16">
          <div className="rounded-3xl bg-shell-pink/60 p-6 ring-1 ring-shell-accent/10">
            <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
              for spot owners
            </p>
            <h2 className="font-heading text-2xl lowercase leading-tight text-shell-ink">
              want your spot in the feed?
            </h2>
            <div className="mt-4 space-y-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
              <p>
                a lot of people suggest i chase venues for paid placements. <span className="text-shell-ink">i&apos;m not doing that.</span> the whole point is after5 only surfaces spots a real local would actually go to — paid placements would break that.
              </p>
              <p>
                but if you run a place i&apos;d love and we haven&apos;t added it yet — or you want your hours and booking link right — email me. i&apos;ll add it (or fix it) myself, no money involved.
              </p>
            </div>
            <div className="mt-6">
              <a
                href="mailto:hello@tryafter5.app?subject=after5%20%E2%80%94%20our%20spot"
                className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-6 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
              >
                email me about your spot
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
              </a>
            </div>
          </div>
        </section>

        {/* help wanted */}
        <section className="mt-12">
          <div className="rounded-3xl border-2 border-shell-ink/10 bg-white p-6 shadow-fun">
            <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
              help wanted
            </p>
            <h2 className="font-heading text-2xl lowercase leading-tight text-shell-ink">
              want to help build this?
            </h2>
            <div className="mt-4 space-y-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
              <p>
                i&apos;m looking for a few locals who care about this. no formal role, no commitment — just people who want to make the feed better. specifically:
              </p>
              <ul className="ml-5 list-disc space-y-2 marker:text-shell-accent">
                <li>going on a night and telling me what was off</li>
                <li>spotting spots we&apos;re missing — coffee, hikes, hidden patios</li>
                <li>cute date ideas, conversation games, small rituals we ship as a twist</li>
                <li>photo runs — better shots of places with weak ones</li>
              </ul>
              <p>open to a coffee. email me if any of that sounds fun.</p>
            </div>
            <div className="mt-6">
              <a
                href="mailto:hello@tryafter5.app?subject=after5%20%E2%80%94%20want%20to%20help"
                className="inline-flex items-center gap-2 rounded-full bg-shell-accent px-6 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition hover:scale-[1.02] active:scale-95"
              >
                email me
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
              </a>
            </div>
          </div>
        </section>

        {/* final note */}
        <section className="mt-16">
          <p className="mb-3 font-body text-xs font-semibold lowercase tracking-[0.18em] text-shell-accent">
            final note
          </p>
          <h2 className="font-heading text-2xl lowercase leading-tight text-shell-ink">
            this is built by one person
          </h2>
          <p className="mt-4 font-body text-[15px] leading-relaxed text-shell-ink/70">
            things will break. photos will be wrong. a plan will surface a spot that closed last week. when that happens, tell me — i&apos;ll fix it the same day. email{' '}
            <a
              href="mailto:hello@tryafter5.app"
              className="text-shell-accent underline decoration-shell-accent/30 underline-offset-4 transition hover:decoration-shell-accent"
            >
              hello@tryafter5.app
            </a>
            {' '}with anything: a bug, a spot we&apos;re missing, an idea, a feature you&apos;d pay for. the roadmap above is mostly your inbox in disguise.
          </p>
        </section>
      </div>

      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-2">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-body text-xs lowercase text-shell-ink/45">
          <Link href="/about" className="hover:text-shell-ink">about</Link>
          <Link href="/privacy" className="hover:text-shell-ink">privacy</Link>
          <Link href="/terms" className="hover:text-shell-ink">terms</Link>
          <a href="mailto:hello@tryafter5.app" className="hover:text-shell-ink">hello@tryafter5.app</a>
        </div>
      </footer>
    </main>
  );
}

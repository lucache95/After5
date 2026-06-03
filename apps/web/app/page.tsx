import Link from 'next/link';
import { LandingHero } from '@/components/LandingHero';
import { Polaroid } from '@/components/Polaroid';
import { UserMenu } from '@/components/UserMenu';

// after5 dating front door. Static/presentational — no DB fetches. The
// planner is kept as the wedge: one low-emphasis "plan a night" door → /plan.
// Motion lives in the LandingHero client child so this stays a server
// component. Primary CTA → /onboarding (correct cold-start door).

const STEPS = [
  { n: '01', head: 'pick a night, not a face', body: 'browse real plans people posted for the week.' },
  { n: '02', head: 'match on the plan', body: 'you like a night, they like you back, you’re locked in.' },
  { n: '03', head: 'show up', body: 'everyone’s verified, so the date is the date.' },
] as const;

export default function HomePage() {
  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="absolute inset-x-0 top-0 z-50">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-5">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">after5</Link>
          <div className="flex items-center gap-3">
            <UserMenu variant="on-light" />
            <Link href="/onboarding" className="rounded-full bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun">let&apos;s go</Link>
          </div>
        </nav>
      </header>

      <LandingHero />

      {/* how it works */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <h2 className="font-heading text-2xl lowercase text-shell-ink">how it works</h2>
        <div className="mt-6 space-y-5">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-4">
              <span className="font-heading text-2xl lowercase text-shell-accent [font-variant-numeric:tabular-nums]">{s.n}</span>
              <div>
                <h3 className="font-body text-base font-semibold lowercase text-shell-ink">{s.head}</h3>
                <p className="mt-1 font-body text-sm leading-relaxed text-shell-ink/65">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* scrapbook of real nights */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Polaroid tone="dating" src="/gallery/bouldering-kiss.jpg" alt="two climbers kissing at a bouldering gym" label="active" size="sm" rotation={-5} />
          <Polaroid tone="dating" src="/gallery/ramen-couple.jpg" alt="a couple sharing ramen at a counter" label="foodie" size="sm" rotation={4} />
          <Polaroid tone="dating" src="/gallery/vinyl-records-filmic.jpg" alt="two people flipping through vinyl records" label="chill" size="sm" rotation={-3} />
          <Polaroid tone="dating" src="/gallery/beach-cards-sunset.jpg" alt="a couple playing cards on a beach at sunset" label="evening" size="sm" rotation={6} />
        </div>
      </section>

      {/* verified reassurance — only allowed pink wash */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <div className="rounded-3xl bg-shell-pink/60 p-6 text-center ring-1 ring-shell-accent/10">
          <p className="font-body text-sm leading-relaxed text-shell-ink/75">
            everyone&apos;s id-verified. the person who shows up is the person from the photos.
          </p>
        </div>
      </section>

      {/* planner wedge */}
      <section className="mx-auto w-full max-w-[480px] px-6 py-10">
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-shell-ink/10 p-6 text-center">
          <p className="font-body text-sm text-shell-ink/70">just want to plan a date? we still do that.</p>
          <Link href="/create" className="rounded-full border-2 border-shell-ink/15 px-6 py-2.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-ink/30 active:scale-95">plan a night</Link>
        </div>
      </section>

      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-6">
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

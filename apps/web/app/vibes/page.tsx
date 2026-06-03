import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { VIBES } from '@/lib/taxonomy';

const SITE = 'https://tryafter5.app';

export const metadata: Metadata = {
  title: 'date vibes in kelowna · after5',
  description: 'browse kelowna date plans and places by vibe: romantic, chill, adventurous, boujee, cozy, spontaneous.',
  alternates: { canonical: `${SITE}/vibes` },
};

export default function VibesIndexPage() {
  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="sticky top-0 z-50 border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">after5</Link>
          <Link href="/create" className="inline-flex items-center gap-1.5 rounded-pill bg-shell-accent px-5 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun transition active:scale-95">
            build a date here
            <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
          </Link>
        </nav>
      </header>

      <section className="mx-auto w-full max-w-[480px] px-6 pb-8 pt-10">
        <p className="mb-3 font-body text-xs font-semibold uppercase tracking-[0.18em] text-shell-accent">by vibe</p>
        <h1 className="font-heading text-4xl lowercase leading-[1.02] text-shell-ink">pick the vibe</h1>
        <p className="mt-5 font-body text-base leading-relaxed text-shell-ink/70">
          each vibe pulls every spot and date plan that fits the energy. start with a feeling, we handle the rest.
        </p>
      </section>

      <section className="mx-auto w-full max-w-[480px] px-6 pb-12">
        <div className="grid grid-cols-1 gap-4">
          {VIBES.map((v) => (
            <Link
              key={v.slug}
              href={`/vibes/${v.slug}`}
              className="group flex flex-col rounded-3xl border border-shell-ink/10 bg-white/60 p-6 transition active:scale-[0.98] hover:border-shell-accent/40"
            >
              <h2 className="font-heading text-2xl lowercase leading-tight text-shell-ink">{v.label.toLowerCase()}</h2>
              <p className="mt-2 font-body text-sm leading-relaxed text-shell-ink/70">{v.blurb}</p>
              <span className="mt-5 inline-flex items-center gap-1.5 font-body text-sm lowercase text-shell-accent">
                explore {v.label.toLowerCase()}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
            </Link>
          ))}
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

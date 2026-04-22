import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { NEIGHBORHOODS } from '@/lib/taxonomy';

const SITE = 'https://after5.app';

export const metadata: Metadata = {
  title: 'Kelowna neighborhoods — places + dates by area | After5',
  description: 'Browse Kelowna by neighborhood — downtown, Mission, Pandosy, West Kelowna, Lake Country, Peachland.',
  alternates: { canonical: `${SITE}/neighborhoods` },
};

export default function NeighborhoodsIndexPage() {
  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-[2px]">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-5 md:px-10">
          <Link href="/" className="font-display text-xl font-semibold tracking-tight text-text">After5</Link>
          <Link href="/plan" className="inline-flex items-center gap-2 rounded-pill bg-primary px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85">
            Plan my date — free
            <ArrowRight className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-content px-6 pb-10 pt-16 md:px-10 md:pb-14 md:pt-24">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">By area · Kelowna</p>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl">
          Pick the neighborhood.
        </h1>
        <p className="mt-6 max-w-prose text-base text-secondary md:text-lg">
          Every spot grouped by where it lives, with date plans that stay close. Helpful when you don't want to drive across town.
        </p>
      </section>

      <section className="mx-auto max-w-content px-6 pb-24 md:px-10 md:pb-32">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
          {NEIGHBORHOODS.map((n) => (
            <Link
              key={n.slug}
              href={`/neighborhoods/${n.slug}`}
              className="group flex flex-col rounded-card border border-border bg-surface p-7 transition-colors hover:border-text/30"
            >
              <h2 className="font-display text-2xl font-semibold leading-tight text-text">{n.label}</h2>
              <p className="mt-3 text-base text-secondary">{n.blurb}</p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm text-accent">
                Explore {n.label}
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-content flex-col items-center gap-6 px-6 py-12 md:flex-row md:justify-between md:px-10 md:py-16">
          <p className="text-xs text-muted">Built in Kelowna. Coming to Kamloops, Vernon, Penticton.</p>
          <div className="flex items-center gap-6 text-xs text-muted">
            <Link href="/privacy" className="transition-colors hover:text-text">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-text">Terms</Link>
            <a href="mailto:lucas@lucassenechal.com" className="transition-colors hover:text-text">lucas@lucassenechal.com</a>
          </div>
        </div>
      </footer>
    </main>
  );
}

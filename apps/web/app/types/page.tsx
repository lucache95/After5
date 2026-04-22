import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { PLACE_TYPES } from '@/lib/taxonomy';

const SITE = 'https://tryafter5.app';

export const metadata: Metadata = {
  title: 'Kelowna places by category — restaurants, wineries, hikes, and more | After5',
  description: 'Browse Kelowna by category — best restaurants, wineries, breweries, escape rooms, hikes, viewpoints, and more.',
  alternates: { canonical: `${SITE}/types` },
};

export default function TypesIndexPage() {
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
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">By category · Kelowna</p>
        <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl">
          Pick a category.
        </h1>
        <p className="mt-6 max-w-prose text-base text-secondary md:text-lg">
          Every spot we plan dates around, grouped by what it is. Useful when you know you want a winery or a hike.
        </p>
      </section>

      <section className="mx-auto max-w-content px-6 pb-24 md:px-10 md:pb-32">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
          {PLACE_TYPES.map((t) => (
            <Link
              key={t.slug}
              href={`/types/${t.slug}`}
              className="group flex flex-col items-start rounded-card border border-border bg-surface px-5 py-4 transition-colors hover:border-text/30"
            >
              <h2 className="font-display text-base font-semibold text-text md:text-lg">{t.label}</h2>
              <span className="mt-2 inline-flex items-center gap-1 text-xs text-accent">
                Browse
                <ArrowRight className="h-3 w-3" strokeWidth={2} />
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

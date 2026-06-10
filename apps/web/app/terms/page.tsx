import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'terms',
  description: 'terms of using after5.',
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-content px-6 py-16 md:px-10 md:py-24">
      <Link
        href="/"
        className="text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
      >
        ← After5
      </Link>

      <p className="mt-12 mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
        Last updated · 2026-04-19
      </p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        Terms
      </h1>

      <div className="mt-12 max-w-prose space-y-6 text-base text-secondary">
        <p>
          By using After5 you agree to the following. The short version: use it
          honestly, the plans are suggestions not guarantees, and we reserve the
          right to remove abuse.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Use</h2>
        <p>
          After5 is a free-to-use planning tool. You can generate, save, and share
          plans for personal use. Don't scrape the site or hit the generation API
          programmatically without asking.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">No warranty</h2>
        <p>
          Plans are suggestions. Restaurants close. Hours change. Weather happens.
          Always check open hours and reservations before driving to a place. We're
          not responsible for closed kitchens, sold-out wineries, or surprise rain.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Your content</h2>
        <p>
          Feedback you submit (loved/skipped, free-text) may be used in aggregate to
          rank places and improve the product. We don't display individual user
          feedback publicly without consent.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Removal</h2>
        <p>
          We can remove accounts that abuse the service (scraping, spam, anything
          that breaks the experience for other users). If your account gets
          removed unfairly, email{' '}
          <a className="text-text underline decoration-border decoration-1 underline-offset-[4px] hover:decoration-text" href="mailto:hello@tryafter5.app">
            hello@tryafter5.app
          </a>.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Jurisdiction</h2>
        <p>
          Disputes are governed by the laws of British Columbia, Canada, and
          adjudicated in Kelowna courts.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Changes</h2>
        <p>
          If we update these terms, the date at the top changes. Continued use means
          you accept the updated version.
        </p>
      </div>
    </main>
  );
}

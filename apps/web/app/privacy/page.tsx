import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How After5 handles your data.',
};

export default function PrivacyPage() {
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
        Privacy
      </h1>

      <div className="prose-styles mt-12 max-w-prose space-y-6 text-base text-secondary">
        <p>
          After5 is built and operated by Lucas Senechal in Kelowna, BC. This page
          explains what we collect and why. If anything here is unclear, email
          <a className="ml-1 text-text underline decoration-border decoration-1 underline-offset-[4px] hover:decoration-text" href="mailto:lucas@lucassenechal.com">
            lucas@lucassenechal.com
          </a>.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">What we collect</h2>
        <p>
          When you generate a plan, we store the inputs you gave us (occasion, time,
          vibe, budget, must-includes) and the itinerary we built for you, so we can
          show it to you again and learn which combinations worked.
        </p>
        <p>
          When you save a plan, we store your email address so we can send you the
          plan link and (with your permission) follow up after the date to ask how
          it went.
        </p>
        <p>
          We use anonymous analytics (PostHog) to understand which pages get visited
          and where users drop off. We do not use third-party advertising trackers.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">What we don't do</h2>
        <p>
          We don't sell your data. We don't share it with advertisers. We don't share
          your email address with the places we recommend.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Service providers we use</h2>
        <p>
          <strong className="text-text">Supabase</strong> hosts our database in the
          United States.{' '}
          <strong className="text-text">Anthropic</strong> processes your itinerary
          inputs to generate the writing in each plan; we send only the structured
          inputs and a fixed list of places, never personal information.{' '}
          <strong className="text-text">Resend</strong> delivers our follow-up
          emails.{' '}
          <strong className="text-text">Vercel</strong> hosts this site.{' '}
          <strong className="text-text">PostHog</strong> handles analytics.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Deleting your data</h2>
        <p>
          Email{' '}
          <a className="text-text underline decoration-border decoration-1 underline-offset-[4px] hover:decoration-text" href="mailto:lucas@lucassenechal.com">
            lucas@lucassenechal.com
          </a>{' '}
          and we'll delete every row associated with your account within 7 days.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Changes</h2>
        <p>
          If we update this policy, the date at the top changes. Material changes get
          announced to saved-plan users by email.
        </p>
      </div>
    </main>
  );
}

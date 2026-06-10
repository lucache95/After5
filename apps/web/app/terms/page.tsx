{/* Drafted from the live product 2026-06-09 — needs review by a real lawyer before any funding/scale milestone. */}
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'terms',
  description: 'terms of using after5.',
};

const linkClass =
  'text-text underline decoration-border decoration-1 underline-offset-[4px] hover:decoration-text';

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
        Last updated: June 9, 2026
      </p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        Terms
      </h1>

      <div className="mt-12 max-w-prose space-y-6 text-base text-secondary">
        <p>
          After5 is a dating app. You post or join a planned night out, match
          with another member, and meet in person. By creating an account you
          agree to these terms. If you disagree with any of them, don&apos;t use
          After5.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Who can use After5</h2>
        <p>
          You must be 18 or older. You confirm this when you sign up, and the ID
          check verifies it. One account per person. Your profile must describe
          you: your real first name, your real age, recent photos of you. Accounts
          that impersonate someone else or misstate age get removed.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Verification</h2>
        <p>
          Dating features require two checks: a government-ID verification run by
          Persona, our verification partner, and a phone number confirmed by SMS
          code. You can browse without them, but you cannot post nights, apply to
          nights, or chat until both pass.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">How matching works</h2>
        <p>
          Other members see a blurred version of your photo until you and a match
          both lock in a night together; after a mutual lock, your clear photo and
          first name are revealed to each other.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Conduct</h2>
        <p>
          No harassment, threats, or hate. No sexual content in chat that the
          other person hasn&apos;t welcomed. No saving, screenshotting, or sharing
          other members&apos; photos or personal details outside the app. No
          solicitation, spam, or commercial use of the service. No scraping or
          automated access. We remove accounts that break these rules.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Showing up</h2>
        <p>
          A locked night is a commitment to a real person. If you need to cancel,
          do it in the app so the other person knows. No-shows and last-minute
          cancellations are recorded and affect your reliability rating, which
          other members can see. We don&apos;t fine you or pursue you for a missed
          date; the consequence is your reputation inside the app.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Safety</h2>
        <p>
          Meet in public places. Tell someone where you&apos;re going. The app
          sends a check-in after the date; use it. We verify identity, but we
          can&apos;t guarantee anyone&apos;s behavior. Report members who make you
          uncomfortable using the in-chat report button or by email, and we will
          investigate.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Your content</h2>
        <p>
          You own what you submit: photos, messages, date plans, ratings. You give
          us a license to store, process, and display that content as needed to
          run the service, for example showing your blurred photo in the feed,
          generating the blurred version of your photo, or showing your plan to
          applicants. We don&apos;t use your photos or messages for marketing
          without asking you first.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Date plans</h2>
        <p>
          Plans and itineraries are suggestions built from venue data and AI-written
          copy. Venues close, hours change, prices move. Check before you go. We
          aren&apos;t responsible for a closed kitchen or a sold-out show.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Termination</h2>
        <p>
          We can suspend or remove accounts that violate these terms, including
          for failed verification, harassment reports, fake profiles, or misuse of
          other members&apos; information. You can delete your account at any time
          by emailing{' '}
          <a className={linkClass} href="mailto:hello@tryafter5.app">
            hello@tryafter5.app
          </a>
          . If you think we removed your account unfairly, email us and we&apos;ll
          look at it.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">As-is</h2>
        <p>
          After5 is provided as-is, without warranties. We work to keep it
          available and accurate, but we don&apos;t guarantee uptime, matches, or
          outcomes. To the extent the law allows, our liability to you is limited
          to the amount you paid us, which today is zero.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Changes</h2>
        <p>
          If we change these terms, the date at the top changes, and we&apos;ll
          flag material changes in the app. Continued use after a change means you
          accept the new version.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Contact and jurisdiction</h2>
        <p>
          Questions go to{' '}
          <a className={linkClass} href="mailto:hello@tryafter5.app">
            hello@tryafter5.app
          </a>
          . These terms are governed by the laws of British Columbia, Canada, and
          disputes are resolved in the courts of British Columbia.
        </p>
      </div>
    </main>
  );
}

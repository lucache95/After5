{/* Drafted from the live product 2026-06-09 — needs review by a real lawyer before any funding/scale milestone. */}
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'privacy',
  description: 'how after5 handles your data.',
};

const linkClass =
  'text-text underline decoration-border decoration-1 underline-offset-[4px] hover:decoration-text';

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
        Last updated: June 9, 2026
      </p>
      <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
        Privacy
      </h1>

      <div className="prose-styles mt-12 max-w-prose space-y-6 text-base text-secondary">
        <p>
          After5 is a dating app built and operated by Lucas Senechal in Kelowna,
          BC. This page lists what we collect, why, who processes it, and what
          other members can see. Questions:{' '}
          <a className={linkClass} href="mailto:hello@tryafter5.app">
            hello@tryafter5.app
          </a>
          .
        </p>

        <h2 className="font-display text-xl font-semibold text-text">What we collect</h2>
        <p>
          Your account email. Your profile: first name, age, photos. When you
          upload a photo we store the clear version and generate a blurred
          version for the blind feed. Your phone number, verified by SMS. Your
          ID-verification result and date of birth from the ID check (we never
          see or store the ID document itself; Persona handles it). Your city
          and neighborhood. Your dating preferences and dealbreakers. Your chat
          messages with matches. Your match history, post-date ratings, and
          reliability signals such as no-shows and cancellations. Date plans you
          save or generate, plus the inputs you gave the generator (occasion,
          time, vibe, budget). Basic usage data: pages visited and feature
          events.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Why we collect it</h2>
        <p>
          Three reasons. Matching: preferences, city, and plans decide what shows
          up in your feed and who you can match with. Safety: ID and phone
          verification keep fake profiles out, and ratings plus reliability
          signals keep no-shows visible. Running the service: email for login and
          notifications, messages so chat works, usage data so we can see what
          breaks.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">What other members see</h2>
        <p>
          Before a match: your blurred photo, first name, age, neighborhood, and
          your night&apos;s plan. If you host a night, you see the profiles of
          members who apply, with their photos still blurred. After you and a
          match both lock a night: your clear photo and first name are revealed
          to each other, and only to each other. Your post-date ratings feed an
          aggregate reliability score visible to other members; individual
          ratings are never shown. Your email, phone number, date of birth, and
          verification details are never visible to anyone.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Who processes your data</h2>
        <p>
          <strong className="text-text">Supabase</strong> hosts our database,
          authentication, and photo storage.{' '}
          <strong className="text-text">Vercel</strong> hosts the website.{' '}
          <strong className="text-text">Persona</strong> runs the government-ID
          check; your ID document and selfie go to Persona, and we receive the
          verdict and your date of birth.{' '}
          <strong className="text-text">Twilio</strong> delivers the SMS
          verification code, so it receives your phone number.{' '}
          <strong className="text-text">Resend</strong> delivers our emails, so
          it receives your email address.{' '}
          <strong className="text-text">PostHog</strong> handles product
          analytics, configured cookieless, with no session recording.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">AI in the product</h2>
        <p>
          The date-plan generator uses{' '}
          <strong className="text-text">Anthropic</strong> (Claude) to write
          itinerary copy. We send it your plan inputs (occasion, time, vibe,
          budget) and venue data, never your name, photos, or messages. Venue
          data comes from <strong className="text-text">Foursquare</strong>.
          Plan maps are rendered by{' '}
          <strong className="text-text">Mapbox</strong>, so your browser requests
          map images for venue locations.{' '}
          <strong className="text-text">Replicate</strong> generates cover
          artwork for plans from venue names; no personal information is sent.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">What we don&apos;t do</h2>
        <p>
          We don&apos;t sell your personal data. We don&apos;t share it with
          advertisers. We don&apos;t show your clear photo to anyone before a
          mutual lock. We don&apos;t use your photos or messages to train AI
          models.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Cookies and sessions</h2>
        <p>
          We use the cookies required to keep you signed in, and nothing else.
          Analytics runs without cookies. No advertising trackers.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Retention</h2>
        <p>
          We keep your data while your account exists. When you delete your
          account, we delete your profile, photos, preferences, plans, and
          verification records. Chat messages and reports may be retained where
          needed to handle an open safety report, then deleted.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Your rights</h2>
        <p>
          You can ask for a copy of your data, ask us to correct it, or ask us to
          delete your account and everything tied to it. Email{' '}
          <a className={linkClass} href="mailto:hello@tryafter5.app">
            hello@tryafter5.app
          </a>{' '}
          and we&apos;ll act within 7 days.
        </p>

        <h2 className="font-display text-xl font-semibold text-text">Changes</h2>
        <p>
          If we update this policy, the date at the top changes, and we announce
          material changes by email to active accounts.
        </p>
      </div>
    </main>
  );
}

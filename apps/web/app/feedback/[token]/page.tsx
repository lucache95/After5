import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { verifyFeedbackToken } from '@/lib/email/feedback-token';
import { createAdminClient } from '@/lib/supabase/admin';
import { FeedbackForm } from './FeedbackForm';
import type { Stop } from '@/lib/itinerary-types';

export const metadata: Metadata = {
  title: 'How was your date?',
  robots: { index: false, follow: false },
};

interface ItineraryRow {
  id: string;
  title: string | null;
  stops: unknown;
  cover_image_url: string | null;
}

export default async function FeedbackPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const result = verifyFeedbackToken(decodeURIComponent(token));

  // Invalid signature — redirect home (no information leak)
  if (result.status === 'invalid') return redirect('/');

  // Expired token — friendly dead-end
  if (result.status === 'expired') {
    return (
      <FeedbackMessage
        title="This link has expired"
        body="Feedback links are valid for 72 hours after your date. We hope you had a great time!"
      />
    );
  }

  const { savedPlanId, itineraryId } = result;
  const admin = createAdminClient();

  // Check one-time use: if feedback was already submitted, show a thank-you
  const { data: savedPlan } = await (admin as any)
    .from('saved_plans')
    .select('feedback_completed_at')
    .eq('id', savedPlanId)
    .maybeSingle();

  if (savedPlan?.feedback_completed_at) {
    return (
      <FeedbackMessage
        title="Already submitted"
        body="You've already shared your feedback — thank you! Your input helps us build better dates for everyone."
      />
    );
  }

  const { data: itinerary } = await admin
    .from('itineraries')
    .select('id, title, stops, cover_image_url')
    .eq('id', itineraryId)
    .maybeSingle();

  if (!itinerary) return notFound();

  const row = itinerary as unknown as ItineraryRow;
  const stops: Stop[] = Array.isArray(row.stops) ? (row.stops as Stop[]) : [];

  return (
    <FeedbackForm
      token={token}
      itineraryId={row.id}
      dateTitle={row.title ?? 'Your date'}
      coverImageUrl={row.cover_image_url}
      stops={stops.map((s) => ({
        place_id: s.place_id,
        place_name: s.place_name,
        place_type: s.place_type ?? null,
        photo_url: s.photo_url ?? null,
        what_to_do: s.what_to_do ?? null,
      }))}
    />
  );
}

/** Friendly full-page message for expired / already-submitted tokens. */
function FeedbackMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-gradient-to-br from-amber-200/45 via-orange-200/25 to-transparent blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-[560px] w-[560px] rounded-full bg-gradient-to-tl from-rose-200/45 via-amber-100/25 to-transparent blur-3xl" />
      </div>

      <header className="relative z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4 md:px-10 md:py-5">
          <Link
            href="/"
            className="font-display text-xl font-semibold tracking-tight text-text"
          >
            After5
          </Link>
        </nav>
      </header>

      <div className="relative z-10 mx-auto max-w-2xl px-6 pb-24 pt-16 text-center md:px-10 md:pb-32 md:pt-24">
        <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
          {title}
        </h1>
        <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-secondary md:text-lg">
          {body}
        </p>
        <div className="mt-10">
          <Link
            href="/dates"
            className="inline-flex items-center gap-2 rounded-pill bg-text px-6 py-2.5 text-sm font-medium text-background transition-transform hover:-translate-y-0.5"
          >
            Browse dates
          </Link>
        </div>
      </div>
    </main>
  );
}

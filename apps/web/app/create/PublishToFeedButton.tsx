'use client';

// Publish-to-feed CTA on a created date. F#4 convergence (E11): this no longer
// posts with a hardcoded date — it routes to the real post form
// (/nights/new?itinerary=<id>) where the host sets the time + full creator
// controls (who-pays / targeting / why / cover). One publish path, not two.
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PendingButtonContent } from '@/components/PendingButtonContent';

export function PublishToFeedButton({
  itineraryId,
  canPublish,
}: {
  itineraryId: string;
  canPublish: boolean;
  // Accepted for back-compat with existing callers (CreateFlow); the date is now
  // chosen on the post form, so this prop is no longer used.
  startsAt?: string;
}) {
  const router = useRouter();
  const [opening, setOpening] = useState(false);

  if (!canPublish) {
    return (
      <a
        href="/onboarding"
        className="font-body text-sm lowercase text-shell-accent underline decoration-shell-accent/40 underline-offset-4 transition-colors hover:decoration-shell-accent"
      >
        create a profile to publish this to the feed
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={opening}
      onClick={() => {
        setOpening(true);
        router.push(`/nights/new?itinerary=${itineraryId}`);
      }}
      className="rounded-pill bg-shell-accent px-6 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition-opacity hover:opacity-90"
    >
      <PendingButtonContent pending={opening} pendingLabel="opening…" accessibilityLabel="opening publish form" size={14}>
        publish to the feed
      </PendingButtonContent>
    </button>
  );
}

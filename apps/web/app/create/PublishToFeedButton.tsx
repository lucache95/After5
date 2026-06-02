'use client';

// Publish-to-feed CTA on a created date. Shown only to verified dating users
// (canPublish) with a persisted itinerary id. Posts the night WITHOUT a pinned
// venue — post_night's curated-venue restriction only fires when p_venue is set,
// so a landing-built date publishes fine, it just carries no pinned venue.
import { useState } from 'react';
import { postNight } from '@after5/api-client';
import { browserAfter5Client } from '@/lib/after5/client';
import { toast } from 'sonner';

export function PublishToFeedButton({
  itineraryId,
  canPublish,
  startsAt,
}: {
  itineraryId: string;
  canPublish: boolean;
  startsAt: string;
}) {
  const [busy, setBusy] = useState(false);

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

  async function publish() {
    setBusy(true);
    try {
      await postNight(browserAfter5Client(), { itinerary_id: itineraryId, starts_at: startsAt });
      toast.success('posted to the feed');
    } catch {
      toast.error('could not publish — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={publish}
      disabled={busy}
      className="rounded-pill bg-shell-accent px-6 py-3 font-body text-sm font-semibold lowercase text-white shadow-fun transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {busy ? 'posting…' : 'publish to the feed'}
    </button>
  );
}

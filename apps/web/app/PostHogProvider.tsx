'use client';

// PostHog is wired but no-ops gracefully when NEXT_PUBLIC_POSTHOG_KEY is unset
// (which it is until launch). That way local dev and CI never spam analytics.

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';

const KEY  = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';

let initialised = false;

function ensureInit(): boolean {
  if (initialised) return true;
  if (!KEY) return false;
  if (typeof window === 'undefined') return false;
  posthog.init(KEY, {
    api_host: HOST,
    capture_pageview: false,         // we capture manually below for App Router
    persistence: 'localStorage',     // cookieless — saves us a banner
    autocapture: false,              // explicit events only
    disable_session_recording: true, // off by default; flip on once we have a real privacy review
  });
  initialised = true;
  return true;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (!ensureInit()) return;
    const url = pathname + (search?.toString() ? `?${search.toString()}` : '');
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, search]);

  return <>{children}</>;
}

// Typed event helpers — use these instead of posthog.capture directly so the
// event taxonomy stays consistent.
export const track = {
  planStarted:        () => safeCapture('plan_started'),
  planStepAdvanced:   (step: number) => safeCapture('plan_step_advanced', { step }),
  planGenerated:      (props: { template_id: string; vibe: string[]; budget: number }) =>
                        safeCapture('plan_generated', props),
  planSaved:          (id: string) => safeCapture('plan_saved', { itinerary_id: id }),
  planShared:         (id: string) => safeCapture('plan_shared', { itinerary_id: id }),
  feedbackSubmitted:  (id: string, rating: string) =>
                        safeCapture('feedback_submitted', { itinerary_id: id, pacing_rating: rating }),
};

function safeCapture(event: string, props?: Record<string, unknown>) {
  if (!ensureInit()) return;
  posthog.capture(event, props);
}

'use client';

// PostHog no-ops gracefully when NEXT_PUBLIC_POSTHOG_KEY is unset, so local dev
// and CI never spam analytics. Autocapture + heatmaps are ON (founder call,
// 2026-06-20) to explore how early users behave; the typed `track` helpers below
// still record the dating-loop funnel events autocapture can't infer.

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
    capture_pageview: false,         // we capture manually below (App Router client nav)
    persistence: 'localStorage',     // cookieless — saves us a banner
    autocapture: true,               // capture all clicks/inputs — "explore everything" while early
                                     // (founder 2026-06-20). Watch the 1M/mo free-tier event count;
                                     // revisit + privacy pass before the Sept launch (CASL deferred).
    enable_heatmaps: true,           // landing-page CRO; creates no extra events
    capture_performance: { web_vitals: true }, // perf data (LCP/CLS/…)
    disable_session_recording: true, // still off — bigger privacy call; flip on after a privacy review
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

// Tie events to a stable user across sessions. UUID only — never email/PII.
// Idempotent: posthog dedupes repeat identify calls for the same id.
export function identifyUser(userId: string) {
  if (!ensureInit()) return;
  posthog.identify(userId);
}

// Drop the identity link on logout so the next user isn't merged into this one.
export function resetUser() {
  if (!ensureInit()) return;
  posthog.reset();
}

// Typed event helpers — use these instead of posthog.capture directly so the
// event taxonomy stays consistent. Props are non-PII ids/enums only.
export const track = {
  // ── AI planner ──
  planStarted:        () => safeCapture('plan_started'),
  planStepAdvanced:   (step: number) => safeCapture('plan_step_advanced', { step }),
  planGenerated:      (props: { template_id: string; vibe: string[]; budget: number }) =>
                        safeCapture('plan_generated', props),
  planSaved:          (id: string) => safeCapture('plan_saved', { itinerary_id: id }),
  planShared:         (id: string) => safeCapture('plan_shared', { itinerary_id: id }),
  feedbackSubmitted:  (id: string, rating: string) =>
                        safeCapture('feedback_submitted', { itinerary_id: id, pacing_rating: rating }),

  // ── Activation / verification ──
  onboardingCompleted: (props: { dating_enabled: boolean }) =>
                        safeCapture('onboarding_completed', props),
  verificationStarted: (inquiryId: string) =>
                        safeCapture('verification_started', { inquiry_id: inquiryId }),

  // ── Dating loop (the launch funnel) ──
  offerSent:          (props: { instance_id: string; candidate_id: string; offer_id?: string }) =>
                        safeCapture('offer_sent', props),
  offerAccepted:      (props: { offer_id: string; lock_id?: string }) =>
                        safeCapture('offer_accepted', props),
  offerDeclined:      (props: { offer_id?: string; instance_id?: string }) =>
                        safeCapture('offer_declined', props),
  matchCreated:       (props: { lock_id: string }) =>
                        safeCapture('match_created', props),
  photosRevealed:     (props: { lock_id?: string; offer_id?: string; counterpart_id?: string }) =>
                        safeCapture('photos_revealed', props),
  chatOpened:         (threadId: string) =>
                        safeCapture('chat_opened', { thread_id: threadId }),
  messageSent:        (props: { thread_id: string; message_id?: string }) =>
                        safeCapture('message_sent', props),
  dateRated:          (props: { lock_id: string; ratee_id: string }) =>
                        safeCapture('date_rated', props),

  // ── Waitlist (launch funnel) ──
  waitlistViewed:     () => safeCapture('waitlist_viewed'),
  waitlistJoined:     (props: { referred: boolean }) => safeCapture('waitlist_joined', props),
  waitlistShared:     (method: 'native' | 'copy') => safeCapture('waitlist_shared', { method }),
};

function safeCapture(event: string, props?: Record<string, unknown>) {
  if (!ensureInit()) return;
  posthog.capture(event, props);
}

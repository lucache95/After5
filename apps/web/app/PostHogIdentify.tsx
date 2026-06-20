'use client';

// Ties PostHog events to the signed-in user (UUID only) and clears the link on
// logout. Driven by Supabase auth state so it works regardless of which route
// the user landed on — the auth callback is server-side, so we can't identify
// there. No-ops gracefully when PostHog has no key (identifyUser/resetUser guard
// on init).

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { identifyUser, resetUser } from './PostHogProvider';

export function PostHogIdentify() {
  useEffect(() => {
    const supabase = createClient();
    // onAuthStateChange fires INITIAL_SESSION on mount with the current session,
    // so we don't need a separate getUser() round-trip.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (
        session?.user &&
        (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
      ) {
        identifyUser(session.user.id);
      }
      if (event === 'SIGNED_OUT') resetUser();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}

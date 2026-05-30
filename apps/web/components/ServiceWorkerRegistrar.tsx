'use client';

// Registers the app-shell service worker (/sw.js) once on mount.
// Renders nothing. Mounted once in the root layout so registration runs on
// every entry point without pulling the SW into individual pages.
//
// Skips non-production by default so the SW doesn't shadow the dev server's
// HMR/asset responses. Push subscription is intentionally NOT done here — the
// worker only registers; subscribing to push is a later, permission-gated step.

import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failures are non-fatal: the app works without the SW.
    });
  }, []);

  return null;
}

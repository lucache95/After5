'use client';
// Auto re-engagement: register this browser for push once on first home load so
// verification_passed / future "matches ready" notifications can reach back here.
// Best-effort: failures are swallowed (no permission, unsupported browser).
import { useEffect, useRef } from 'react';
import { browserAfter5Client, registerDevice } from '@/lib/after5/client';

export function RegisterDeviceOnLoad() {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      try {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        await registerDevice(browserAfter5Client(), `web:${navigator.userAgent.slice(0, 64)}`, 'web', null);
      } catch { /* best-effort */ }
    })();
  }, []);
  return null;
}

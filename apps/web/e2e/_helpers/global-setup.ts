// Fails fast (with remediation text) if the local stack or functions-serve is down.
// Reality #1: `supabase start` does NOT serve edge functions — the match-* calls 503
// until `supabase functions serve` is running, and the E2E drives real match RPCs.
import type { FullConfig } from '@playwright/test';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const PUBLISHABLE_KEY =
  process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

async function assertReachable(name: string, url: string, init?: RequestInit) {
  try {
    const res = await fetch(url, init);
    return res;
  } catch (e) {
    throw new Error(
      `[5b-e2e global-setup] ${name} not reachable at ${url}. ` +
        `Start the local stack: \`supabase start\`. Error: ${(e as Error).message}`,
    );
  }
}

export default async function globalSetup(_config: FullConfig) {
  // 1. REST API up (stack running).
  await assertReachable('Supabase REST', `${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: PUBLISHABLE_KEY },
  });

  // 2. Mailpit up (PKCE login needs it).
  await assertReachable('Mailpit', 'http://127.0.0.1:54324/api/v1/messages?limit=1');

  // 3. functions-serve up: a POST to a match-* function must NOT 503/connection-refuse.
  //    Unauthed it should return 401 (verify_jwt) — anything but 503/network error means served.
  const res = await assertReachable('edge functions-serve', `${SUPABASE_URL}/functions/v1/match-shortlist`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: '{}',
  });
  if (res.status === 503) {
    throw new Error(
      '[5b-e2e global-setup] match-shortlist returned 503 — edge functions are NOT served. ' +
        'Run `supabase functions serve` (with SUPABASE_URL, SUPABASE_ANON_KEY/PUBLISHABLE_KEY, ' +
        'SUPABASE_SERVICE_ROLE_KEY in env) before the E2E. _all_5b.sh does this automatically.',
    );
  }
}

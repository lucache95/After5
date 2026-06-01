import { defineConfig, devices } from '@playwright/test';

// Forced-local: .env.local points at PROD (NEXT_PUBLIC_SUPABASE_URL=https://…supabase.co).
// We MUST override URL + key inline so the spawned Next process talks to the local stack.
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_PUBLISHABLE_KEY =
  process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

export default defineConfig({
  testDir: './e2e',
  // 5b-* = the dating loop suite; chat-* = the Phase 7 chat suite.
  testMatch: /(5b-|chat-).*\.spec\.ts$/,
  // Shared DB state across the two-context flow → run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/_helpers/global-setup.ts',
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    // Use localhost (not 127.0.0.1) to match supabase config.toml site_url —
    // signInWithOtp sets the PKCE code-verifier cookie on this app origin, and
    // the verify→callback redirect lands on site_url. A host mismatch splits the
    // cookie across origins and the session is lost on the next protected nav.
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Set PW_SLOWMO=<ms> to watch the run in slow motion (e.g. PW_SLOWMO=900 --headed).
        // Zero by default → no impact on normal/CI runs.
        launchOptions: { slowMo: process.env.PW_SLOWMO ? Number(process.env.PW_SLOWMO) : 0 },
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @after5/web dev',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_PUBLISHABLE_KEY,
    },
  },
});

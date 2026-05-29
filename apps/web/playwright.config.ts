import { defineConfig, devices } from '@playwright/test';

// Forced-local: .env.local points at PROD (NEXT_PUBLIC_SUPABASE_URL=https://…supabase.co).
// We MUST override URL + key inline so the spawned Next process talks to the local stack.
const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_PUBLISHABLE_KEY =
  process.env.LOCAL_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

export default defineConfig({
  testDir: './e2e',
  testMatch: '5b-*.spec.ts',
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
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @after5/web dev',
    url: 'http://127.0.0.1:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_PUBLISHABLE_KEY,
    },
  },
});

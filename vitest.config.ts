// vitest.config.ts — repo-wide test runner (P1 establishes this; later phases extend it)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Pin root to this file's dir so the include globs resolve against the repo
  // root regardless of cwd. Without this, `pnpm --filter <pkg> test` / `turbo run
  // test` run vitest from a package dir and the `packages/*` globs match nothing.
  root: import.meta.dirname,
  test: {
    // Node environment — packages are pure TS (no DOM). The web app can add
    // its own jsdom project later without changing this root config.
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/__tests__/**/*.test.ts'],
    // Edge Functions are Deno and tested with `deno test`, not vitest.
    exclude: ['**/node_modules/**', 'supabase/functions/**', 'apps/web/.next/**'],
    passWithNoTests: false,
  },
});

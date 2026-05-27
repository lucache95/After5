// vitest.workspace.ts — two projects: node (packages/*) + jsdom (apps/web).
// The node project keeps the existing root vitest.config.ts behavior unchanged;
// the web project adds jsdom so component + route tests under apps/web can run.
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './vitest.config.ts',        // node env — packages/*/src/**/*.test.ts (unchanged)
  './apps/web/vitest.config.ts', // jsdom env — apps/web/**/*.test.{ts,tsx}
]);

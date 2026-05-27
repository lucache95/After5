// apps/web/vitest.config.ts — jsdom project for web component + route tests.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" → apps/web/* path alias so test imports resolve.
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['app/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '.next/**'],
    passWithNoTests: false,
  },
});

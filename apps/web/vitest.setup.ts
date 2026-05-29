// apps/web/vitest.setup.ts — register @testing-library/jest-dom matchers.
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';
import { vi } from 'vitest';

expect.extend(toHaveNoViolations);

// jsdom doesn't implement object URLs; PhotoCropper (onboarding) uses them. Polyfill so
// the full suite — which H's _all_5b.sh + CI gate run — is green on a clean main.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
}

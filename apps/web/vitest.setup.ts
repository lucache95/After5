// apps/web/vitest.setup.ts — register @testing-library/jest-dom matchers.
import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

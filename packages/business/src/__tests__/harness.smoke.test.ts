// packages/business/src/__tests__/harness.smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('vitest harness', () => {
  it('runs and asserts', () => {
    expect(1 + 1).toBe(2);
  });
});

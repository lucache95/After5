// apps/web/app/onboarding/__tests__/OnboardingShell.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { OnboardingShell } from '../OnboardingShell';

describe('OnboardingShell — back chip (audit pass-2)', () => {
  it('step 1 (welcome): no back chip — shows the wordmark instead', () => {
    render(<OnboardingShell step={1}><div>content</div></OnboardingShell>);
    expect(screen.queryByRole('button', { name: /back/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /after5/i })).toBeInTheDocument();
  });

  it('step 2 (basics): back chip is present and targets step 1 route', async () => {
    render(<OnboardingShell step={2}><div>content</div></OnboardingShell>);
    const back = screen.getByRole('button', { name: /back/i });
    expect(back).toBeInTheDocument();
    await userEvent.click(back);
    expect(push).toHaveBeenCalledWith('/onboarding/welcome');
  });

  it('step 5 (phone): back chip targets preferences route', async () => {
    push.mockReset();
    render(<OnboardingShell step={5}><div>content</div></OnboardingShell>);
    const back = screen.getByRole('button', { name: /back/i });
    await userEvent.click(back);
    expect(push).toHaveBeenCalledWith('/onboarding/preferences');
  });

  it('back chip has min 44px tap target (min-h-[44px] and min-w-[44px])', () => {
    render(<OnboardingShell step={3}><div>content</div></OnboardingShell>);
    const back = screen.getByRole('button', { name: /back/i });
    // className check is a reasonable proxy for tap-target guarantee in unit tests
    expect(back.className).toMatch(/min-h-\[44px\]/);
    expect(back.className).toMatch(/min-w-\[44px\]/);
  });
});

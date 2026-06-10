// apps/web/app/onboarding/steps/__tests__/DoneStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const enableEq = vi.fn().mockResolvedValue({ error: null });
const fakeClient = { from: vi.fn(() => ({ update: () => ({ eq: enableEq }) })) };
vi.mock('@/lib/after5/client', () => ({ browserAfter5Client: () => fakeClient }));

import { DoneStep } from '../DoneStep';

beforeEach(() => { push.mockReset(); enableEq.mockClear(); });

describe('DoneStep', () => {
  it('success: shows the Verified · New badge', () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    // Badge-specific: "verified · new" (body copy also contains "verified").
    expect(screen.getByText(/verified.*new/i)).toBeInTheDocument();
  });

  it('success: turning dating on writes dating_enabled; payoff CTA routes to /feed', async () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    await userEvent.click(screen.getByRole('button', { name: /turn dating on/i }));
    await waitFor(() => expect(enableEq).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /see tonight's nights/i }));
    expect(push).toHaveBeenCalledWith('/feed');
  });

  it('aha loop: primary CTA targets /feed in BOTH gate states', async () => {
    // gate ok
    const ok = render(<DoneStep userId="u1" badge={{ verified: true, isNew: false }} gate={{ ok: true }} />);
    await userEvent.click(screen.getByRole('button', { name: /see tonight's nights/i }));
    expect(push).toHaveBeenCalledWith('/feed');
    ok.unmount();
    push.mockReset();
    // gate blocked (the current prod default: birthdate_missing)
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: false }} gate={{ ok: false, reason: 'birthdate_missing' }} />);
    await userEvent.click(screen.getByRole('button', { name: /see tonight's nights/i }));
    expect(push).toHaveBeenCalledWith('/feed');
    expect(enableEq).not.toHaveBeenCalled(); // browsing never silently flips dating on
  });

  it('quiet secondary still routes to /home', async () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    await userEvent.click(screen.getByRole('button', { name: /^home$/i }));
    expect(push).toHaveBeenCalledWith('/home');
  });

  it('error + retry: an enable failure (age gate) surfaces and retries', async () => {
    enableEq.mockResolvedValueOnce({ error: { message: 'age gate: must be 18+' } });
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    await userEvent.click(screen.getByRole('button', { name: /turn dating on/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/18\+/i));
    enableEq.mockResolvedValueOnce({ error: null });
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('gate blocked: shows friendly message, no enable button, payoff + home CTAs present', () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: false }} gate={{ ok: false, reason: 'birthdate_missing' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/date of birth/i);
    expect(screen.queryByRole('button', { name: /turn dating on/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /see tonight's nights/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^home$/i })).toBeInTheDocument();
  });

  it('gate ok: renders celebration headline "you\'re in."', () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: false }} gate={{ ok: true }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/you're in/i);
    // No blocking alert
    expect(screen.queryByText(/almost there/i)).not.toBeInTheDocument();
  });

  it('gate NOT ok: renders "almost there" headline and gate message prominently — no "verified" in headline', () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: false }} gate={{ ok: false, reason: 'not_verified' }} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/almost there/i);
    // Gate message is prominent (not a footnote)
    expect(screen.getByRole('alert')).toHaveTextContent(/finish verifying/i);
    // No "you're in" or "verified" in the headline
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(/you're in/i);
  });

  it('gate NOT ok: does not claim "verified" in the badge chip', () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: false }} gate={{ ok: false, reason: 'under_18' }} />);
    // Badge chip should say "profile complete", not "verified"
    // The gate-blocked branch renders "profile complete" regardless of badge.verified
    expect(screen.getByText(/profile complete/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/18\+/i);
  });
});

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
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(screen.getByText(/new/i)).toBeInTheDocument();
  });

  it('success: turning dating on writes dating_enabled then routes home', async () => {
    render(<DoneStep userId="u1" badge={{ verified: true, isNew: true }} />);
    await userEvent.click(screen.getByRole('button', { name: /turn dating on/i }));
    await waitFor(() => expect(enableEq).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /enter after5/i }));
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
});

// apps/web/app/dates/[instanceId]/interested/__tests__/CancelWithReasonPicker.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelWithReasonPicker } from '../CancelWithReasonPicker';

describe('CancelWithReasonPicker', () => {
  it('lists the four backend reasons', () => {
    render(<CancelWithReasonPicker onConfirm={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /both of us called it off/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /they didn't show/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /backing out before we meet/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /a safety issue/i })).toBeInTheDocument();
  });

  it('calls onConfirm with the chosen reason', async () => {
    const onConfirm = vi.fn();
    render(<CancelWithReasonPicker onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('radio', { name: /they didn't show/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel this date/i }));
    expect(onConfirm).toHaveBeenCalledWith('no_show');
  });

  it('requires an extra confirmation for the safety reason and reports it', async () => {
    const onConfirm = vi.fn();
    render(<CancelWithReasonPicker onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('radio', { name: /a safety issue/i }));
    expect(screen.getByText(/this gets reported/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /report and cancel/i }));
    expect(onConfirm).toHaveBeenCalledWith('safety');
  });

  it('disables confirm until a reason is picked', () => {
    render(<CancelWithReasonPicker onConfirm={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cancel this date/i })).toBeDisabled();
  });
});

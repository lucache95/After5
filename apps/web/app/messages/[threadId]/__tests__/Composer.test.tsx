// apps/web/app/messages/[threadId]/__tests__/Composer.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const sendMessage = vi.fn();
vi.mock('@/lib/after5/chat', () => ({ sendMessage: (...a: unknown[]) => sendMessage(...a) }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));

import { Composer } from '../Composer';
import { MatchError } from '@/lib/after5/match';

beforeEach(() => { sendMessage.mockReset(); toastError.mockReset(); });

const onOptimistic = vi.fn();
const onSettled = vi.fn();
beforeEach(() => { onOptimistic.mockReset(); onSettled.mockReset(); });

describe('Composer', () => {
  it('sends a trimmed body and reconciles via onSettled with the real id', async () => {
    sendMessage.mockResolvedValue({ kind: 'message', message_id: 'm-real', both_ready: true });
    render(<Composer threadId="t-1" onOptimistic={onOptimistic} onSettled={onSettled} />);
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), '  hey there  ');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('t-1', 'hey there'));
    expect(onOptimistic).toHaveBeenCalledTimes(1);
    const tempId = onOptimistic.mock.calls[0][0];
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith(tempId, 'm-real'));
  });

  it('does nothing for empty / whitespace-only input', async () => {
    render(<Composer threadId="t-1" onOptimistic={onOptimistic} onSettled={onSettled} />);
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), '   ');
    // send button disabled for whitespace; force a submit attempt anyway
    expect(screen.getByRole('button', { name: /send it/i })).toBeDisabled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('toasts and rolls back (onSettled null) when sendMessage throws a MatchError', async () => {
    sendMessage.mockRejectedValue(new MatchError('chat_closed'));
    render(<Composer threadId="t-1" onOptimistic={onOptimistic} onSettled={onSettled} />);
    await userEvent.type(screen.getByRole('textbox', { name: /message/i }), 'hi');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const tempId = onOptimistic.mock.calls[0][0];
    expect(onSettled).toHaveBeenCalledWith(tempId, null);
  });

  it('clears the textarea after sending', async () => {
    sendMessage.mockResolvedValue({ kind: 'message', message_id: 'm-1' });
    render(<Composer threadId="t-1" onOptimistic={onOptimistic} onSettled={onSettled} />);
    const box = screen.getByRole('textbox', { name: /message/i });
    await userEvent.type(box, 'hello');
    await userEvent.click(screen.getByRole('button', { name: /send it/i }));
    await waitFor(() => expect(box).toHaveValue(''));
  });
});

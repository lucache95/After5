// apps/web/app/messages/[threadId]/__tests__/Conversation.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageRow } from '../../thread-view';

// Capture the realtime callback so tests can drive an insert.
let insertCb: ((row: MessageRow) => void) | null = null;
const unsub = vi.fn();
const subscribeThreadMessages = vi.fn((_t: string, cb: (row: MessageRow) => void) => { insertCb = cb; return unsub; });
vi.mock('@/lib/after5/realtime', () => ({ subscribeThreadMessages: (...a: [string, (r: MessageRow) => void]) => subscribeThreadMessages(...a) }));

const markRead = vi.fn(() => Promise.resolve(0));
const reportMessage = vi.fn(() => Promise.resolve({ kind: 'report', report_id: 'r-1' }));
vi.mock('@/lib/after5/chat', () => ({
  markRead: (...a: unknown[]) => markRead(...a),
  reportMessage: (...a: unknown[]) => reportMessage(...a),
  // Composer imports sendMessage from chat; keep it inert here (composer has its own test).
  sendMessage: vi.fn(() => Promise.resolve({ kind: 'message', message_id: 'm-new' })),
}));
const toastPlain = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: Object.assign((...a: unknown[]) => toastPlain(...a), { error: (...a: unknown[]) => toastError(...a), success: vi.fn() }) }));

import { Conversation } from '../Conversation';

const msg = (over: Partial<MessageRow>): MessageRow => ({
  id: 'm', thread_id: 't-1', sender_id: 'them', body: 'hi', read_at: null,
  created_at: '2026-06-01T00:00:00.000Z', ...over,
});

const base = {
  threadId: 't-1', viewerId: 'me', counterpartName: 'robin',
  messageable: true, bothReady: false,
};

beforeEach(() => {
  insertCb = null;
  subscribeThreadMessages.mockClear();
  unsub.mockClear();
  markRead.mockClear();
  reportMessage.mockClear();
  toastPlain.mockClear();
  toastError.mockClear();
  // jsdom lacks scrollIntoView + matchMedia
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList));
});

describe('Conversation', () => {
  it('renders initial messages with own vs counterpart alignment', () => {
    render(<Conversation {...base} initialMessages={[
      msg({ id: '1', sender_id: 'me', body: 'mine' }),
      msg({ id: '2', sender_id: 'them', body: 'theirs' }),
    ]} />);
    expect(screen.getByText('mine').closest('[data-own]')).toHaveAttribute('data-own', 'true');
    expect(screen.getByText('theirs').closest('[data-own]')).toHaveAttribute('data-own', 'false');
  });

  it('marks the thread read on mount', () => {
    render(<Conversation {...base} initialMessages={[]} />);
    expect(markRead).toHaveBeenCalledWith('t-1');
  });

  it('exposes the message list as an aria-live log', () => {
    render(<Conversation {...base} initialMessages={[]} />);
    const log = screen.getByRole('log', { name: /messages/i });
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('appends a realtime insert and does NOT duplicate one already present by id', async () => {
    render(<Conversation {...base} initialMessages={[msg({ id: '1', body: 'first' })]} />);
    // a brand-new insert appends
    insertCb?.(msg({ id: '2', body: 'second', created_at: '2026-06-01T00:01:00Z' }));
    await waitFor(() => expect(screen.getByText('second')).toBeInTheDocument());
    // the echo of an existing id must not duplicate
    insertCb?.(msg({ id: '1', body: 'first' }));
    await waitFor(() => expect(screen.getAllByText('first')).toHaveLength(1));
  });

  it('shows the soft nudge but it never blocks the composer', () => {
    render(<Conversation {...base} bothReady={false} initialMessages={[]} />);
    expect(screen.getByText(/say hi before you lock in/i)).toBeInTheDocument();
    // composer is present regardless of rapport state
    expect(screen.getByRole('button', { name: /send it/i })).toBeInTheDocument();
  });

  it('switches the nudge to "both said hi" once each party has sent', () => {
    render(<Conversation {...base} bothReady={false} initialMessages={[
      msg({ id: '1', sender_id: 'me' }),
      msg({ id: '2', sender_id: 'them' }),
    ]} />);
    expect(screen.getByText(/you’ve both said hi/i)).toBeInTheDocument();
  });

  it('respects bothReady=true from the server', () => {
    render(<Conversation {...base} bothReady={true} initialMessages={[]} />);
    expect(screen.getByText(/you’ve both said hi/i)).toBeInTheDocument();
  });

  it('hides the composer and shows a closed notice when not messageable', () => {
    render(<Conversation {...base} messageable={false} initialMessages={[]} />);
    expect(screen.queryByRole('button', { name: /send it/i })).not.toBeInTheDocument();
    expect(screen.getByText(/this chat is closed/i)).toBeInTheDocument();
  });

  it('reports a received message through a confirm dialog', async () => {
    render(<Conversation {...base} initialMessages={[msg({ id: '1', sender_id: 'them', body: 'creepy' })]} />);
    await userEvent.click(screen.getByRole('button', { name: /report this message/i }));
    await userEvent.click(screen.getByRole('dialog').querySelector('button:last-child') as HTMLElement);
    await waitFor(() => expect(reportMessage).toHaveBeenCalledWith('1'));
    expect(toastPlain).toHaveBeenCalled();
  });

  it('offers no report affordance on the viewer\'s own messages', () => {
    render(<Conversation {...base} initialMessages={[msg({ id: '1', sender_id: 'me', body: 'mine' })]} />);
    expect(screen.queryByRole('button', { name: /report this message/i })).not.toBeInTheDocument();
  });
});

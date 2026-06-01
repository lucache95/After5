// apps/web/app/messages/__tests__/ThreadList.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ThreadList } from '../ThreadList';
import type { ThreadSummary } from '../thread-view';

const thread = (over: Partial<ThreadSummary>): ThreadSummary => ({
  threadId: 't1', counterpartName: 'robin', counterpartPhotoUrl: null,
  dateLabel: 'fri · pottery', lastMessage: 'see you there', lastAt: '2026-06-01T00:00:00Z',
  unread: 0, messageable: true, ...over,
});

describe('ThreadList', () => {
  it('renders the empty state when there are no threads', () => {
    render(<ThreadList threads={[]} />);
    expect(screen.getByText(/no chats yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /browse dates/i })).toHaveAttribute('href', '/feed');
  });

  it('renders a row per thread with name + preview, linking to the conversation', () => {
    render(<ThreadList threads={[thread({ threadId: 't1', counterpartName: 'robin' }), thread({ threadId: 't2', counterpartName: 'sam', lastMessage: 'hey' })]} />);
    const list = screen.getByRole('list', { name: /conversations/i });
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);
    // name appears in both the row heading and the Polaroid fallback label, so use getAllByText
    expect(screen.getAllByText('robin').length).toBeGreaterThan(0);
    expect(screen.getByText('see you there')).toBeInTheDocument();
    expect(screen.getByText('hey')).toBeInTheDocument();
    expect(links[0]).toHaveAttribute('href', '/messages/t1');
    expect(links[1]).toHaveAttribute('href', '/messages/t2');
  });

  it('shows an unread indicator only when unread > 0', () => {
    const { rerender } = render(<ThreadList threads={[thread({ unread: 0, counterpartName: 'robin' })]} />);
    // accessible name carries the unread count; none when zero
    expect(screen.getByRole('link', { name: 'chat with robin' })).toBeInTheDocument();

    rerender(<ThreadList threads={[thread({ unread: 3, counterpartName: 'robin' })]} />);
    expect(screen.getByRole('link', { name: /chat with robin, 3 unread/i })).toBeInTheDocument();
  });

  it('falls back to dry copy when a thread has no messages', () => {
    render(<ThreadList threads={[thread({ lastMessage: null })]} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });
});

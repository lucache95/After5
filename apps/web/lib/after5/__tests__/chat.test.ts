// apps/web/lib/after5/__tests__/chat.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
const rpc = vi.fn();
const order = vi.fn();
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/after5/client', () => ({
  browserAfter5Client: () => ({ functions: { invoke }, rpc, from }),
}));

import { sendMessage, reportMessage, markRead, fetchMessages } from '../chat';

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  order.mockReset();
  eq.mockClear();
  select.mockClear();
  from.mockClear();
});

describe('sendMessage', () => {
  it('posts thread_id/body and mints an idem_key, returns the discriminated result', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, data: { kind: 'message', message_id: 'm-1', both_ready: false } },
      error: null,
    });
    const res = await sendMessage('t-1', 'hey');
    const [name, opts] = invoke.mock.calls[0];
    expect(name).toBe('chat-send-message');
    expect(opts.body.thread_id).toBe('t-1');
    expect(opts.body.body).toBe('hey');
    expect(typeof opts.body.idem_key).toBe('string');
    expect(opts.body.idem_key.length).toBeGreaterThan(10);
    expect(res).toEqual({ kind: 'message', message_id: 'm-1', both_ready: false });
  });

  it('passes a caller-supplied idem_key through unchanged', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { kind: 'message', message_id: 'm-1' } }, error: null });
    await sendMessage('t-1', 'hey', 'idem-fixed');
    expect(invoke.mock.calls[0][1].body.idem_key).toBe('idem-fixed');
  });

  it('throws MatchError keyed on chat_closed for a P5011 ok:false body', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, code: 'chat_closed', message: 'this chat is closed.', errcode: 'P5011' },
      error: null,
    });
    await expect(sendMessage('t-1', 'hey')).rejects.toMatchObject({ code: 'chat_closed', errcode: 'P5011' });
  });

  it('throws MatchError keyed on chat_not_party for a P5010 body (even via FunctionsHttpError)', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, code: 'chat_not_party', message: "this conversation isn't yours.", errcode: 'P5010' },
      error: { name: 'FunctionsHttpError', message: 'non-2xx' },
    });
    await expect(sendMessage('t-1', 'hey')).rejects.toMatchObject({ code: 'chat_not_party' });
  });
});

describe('reportMessage', () => {
  it('posts message_id/reason and returns the report result', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { kind: 'report', report_id: 'r-1' } }, error: null });
    const res = await reportMessage('m-1', 'creepy');
    expect(invoke).toHaveBeenCalledWith('chat-report-message', { body: { message_id: 'm-1', reason: 'creepy' } });
    expect(res).toEqual({ kind: 'report', report_id: 'r-1' });
  });

  it('omits reason when not provided', async () => {
    invoke.mockResolvedValue({ data: { ok: true, data: { kind: 'report', report_id: 'r-1' } }, error: null });
    await reportMessage('m-1');
    expect(invoke.mock.calls[0][1].body).toEqual({ message_id: 'm-1', reason: undefined });
  });

  it('throws MatchError keyed on cannot_report for a P5012 body', async () => {
    invoke.mockResolvedValue({
      data: { ok: false, code: 'cannot_report', message: "you can't report that message.", errcode: 'P5012' },
      error: null,
    });
    await expect(reportMessage('m-1')).rejects.toMatchObject({ code: 'cannot_report', errcode: 'P5012' });
  });
});

describe('markRead', () => {
  it('calls chat_mark_read RPC directly with p_thread and returns the count', async () => {
    rpc.mockResolvedValue({ data: 3, error: null });
    const n = await markRead('t-1');
    expect(rpc).toHaveBeenCalledWith('chat_mark_read', { p_thread: 't-1' });
    expect(n).toBe(3);
  });

  it('returns 0 when the RPC yields null', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await markRead('t-1')).toBe(0);
  });

  it('throws MatchError on an RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    await expect(markRead('t-1')).rejects.toMatchObject({ code: 'server_error' });
  });
});

describe('fetchMessages', () => {
  it('selects messages for the thread ordered oldest -> newest', async () => {
    order.mockResolvedValue({ data: [{ id: 'm-1' }], error: null });
    const rows = await fetchMessages('t-1');
    expect(from).toHaveBeenCalledWith('messages');
    expect(eq).toHaveBeenCalledWith('thread_id', 't-1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: true });
    expect(rows).toEqual([{ id: 'm-1' }]);
  });

  it('throws MatchError on a query error', async () => {
    order.mockResolvedValue({ data: null, error: { code: 'PGRST', message: 'boom' } });
    await expect(fetchMessages('t-1')).rejects.toMatchObject({ code: 'server_error' });
  });
});

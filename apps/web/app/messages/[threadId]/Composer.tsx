'use client';
// Phase 7 composer. A textarea (mirrors the DB 1..2000 char check) + a "send it"
// button. Optimistic: the parent appends a temp row immediately, then we call
// sendMessage and reconcile on the result (the realtime echo replaces the temp row
// by message id; on failure the parent rolls the temp row back). Enter sends,
// Shift+Enter inserts a newline. ≥44px tap target. Errors → sonner toast keyed on
// the MatchError code.
import { useState } from 'react';
import { toast } from 'sonner';
import { sendMessage } from '@/lib/after5/chat';
import { MatchError, messageForCode } from '@/lib/after5/match';
import { cn } from '@/lib/cn';

const MAX = 2000;

export function Composer({
  threadId,
  onOptimistic,
  onSettled,
}: {
  threadId: string;
  onOptimistic: (tempId: string, body: string) => void;
  onSettled: (tempId: string, messageId: string | null) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    const tempId = crypto.randomUUID();
    setBusy(true);
    onOptimistic(tempId, body);
    setText('');
    try {
      const r = await sendMessage(threadId, body);
      onSettled(tempId, r.message_id);
    } catch (e) {
      const code = e instanceof MatchError ? e.code : 'server_error';
      toast.error(messageForCode(code));
      onSettled(tempId, null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="message"
        rows={1}
        maxLength={MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="say something"
        className="min-h-[44px] flex-1 resize-none rounded-3xl border-2 border-shell-ink/15 bg-white px-4 py-2.5 font-body text-shell-ink placeholder:text-shell-ink/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
      />
      <button
        type="submit"
        disabled={busy || text.trim().length === 0}
        className={cn(
          'min-h-[44px] shrink-0 rounded-full bg-shell-accent px-5 py-2.5 font-body font-semibold lowercase text-white transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
          'disabled:opacity-50',
        )}
      >
        send it
      </button>
    </form>
  );
}

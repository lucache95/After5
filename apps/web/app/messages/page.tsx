// apps/web/app/messages/page.tsx
// The messages tab was absorbed into the unified inbox (#84): chat threads now
// live as zone 2 of /inbox. This route stays only to redirect any lingering
// /messages deep-link (bookmark, old push payload) to its new home. The thread
// list query + ThreadList rendering moved into /inbox/page.tsx; the conversation
// view at /messages/[threadId] still works and is re-homed at /inbox/[threadId].
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function MessagesRedirect() {
  redirect('/inbox');
}

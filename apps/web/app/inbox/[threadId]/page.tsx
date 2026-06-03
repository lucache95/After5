// apps/web/app/inbox/[threadId]/page.tsx
// Re-home of the conversation view under the inbox tab (#84). The inbox replaces
// the messages tab, so a thread tapped from /inbox lands here and back-nav stays
// in-tab. The logic is identical to the standalone /messages/[threadId] page —
// re-export it rather than fork the RLS/reveal-safe read, so the two paths can't
// drift. force-dynamic is inherited from the re-exported module.
export { default, dynamic } from '../../messages/[threadId]/page';

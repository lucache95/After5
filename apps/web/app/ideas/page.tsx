// /ideas — the public feature-request board. Admin-curated items from
// user_feedback (is_public), upvotable by logged-in users, top floats up.
// Shipped items drop to a "recently shipped" section. Submission reuses /tell-us.

import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { IdeaVoteButton } from '@/components/ideas/IdeaVoteButton';

export const dynamic = 'force-dynamic';

interface Idea {
  id: string;
  public_title: string | null;
  subject: string | null;
  status: string;
  vote_count: number;
  published_at: string | null;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  planned: { label: 'planned', cls: 'bg-shell-accent/15 text-shell-accent' },
  shipped: { label: 'shipped', cls: 'bg-emerald-100 text-emerald-800' },
  done: { label: 'shipped', cls: 'bg-emerald-100 text-emerald-800' },
};

// Public-facing "shipped" covers both the explicit roadmap state and internal 'done'.
const SHIPPED = new Set(['shipped', 'done']);

export default async function IdeasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Public read (RLS allows select). Loose-typed: generated types lack the board columns.
  const db = supabase as unknown as { from: (t: string) => any };

  const { data } = await db
    .from('user_feedback')
    .select('id, public_title, subject, status, vote_count, published_at')
    .eq('is_public', true)
    .order('vote_count', { ascending: false })
    .order('published_at', { ascending: false });

  const ideas: Idea[] = data ?? [];

  // The signed-in user's existing votes, to pre-fill the buttons.
  const votedIds = new Set<string>();
  if (user && ideas.length) {
    const { data: votes } = await db
      .from('feature_votes')
      .select('feedback_id')
      .eq('user_id', user.id)
      .in('feedback_id', ideas.map((i) => i.id));
    for (const v of votes ?? []) votedIds.add(v.feedback_id);
  }

  const active = ideas.filter((i) => !SHIPPED.has(i.status));
  const shipped = ideas.filter((i) => SHIPPED.has(i.status));

  return (
    <main className="min-h-dvh bg-shell-base">
      <header className="mx-auto flex w-full max-w-[560px] items-center justify-between px-6 py-5">
        <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">after5</Link>
        <Link href="/tell-us" className="rounded-full bg-shell-accent px-4 py-2 font-body text-sm font-semibold lowercase text-white shadow-fun">got an idea?</Link>
      </header>

      <section className="mx-auto w-full max-w-[560px] px-6 pb-16 pt-4">
        <h1 className="font-heading text-4xl lowercase text-shell-ink">what we&apos;re building</h1>
        <p className="mt-3 font-body text-[15px] leading-relaxed text-shell-ink/70">
          the stuff you&apos;ve asked for, ranked by votes. upvote what you want next — the top ones get built first.{' '}
          <Link href="/tell-us" className="text-shell-accent underline">got something else? tell us.</Link>
        </p>

        {ideas.length === 0 ? (
          <p className="mt-10 rounded-3xl border border-shell-ink/10 p-8 text-center font-body text-shell-ink/55">
            no ideas on the board yet — <Link href="/tell-us" className="text-shell-accent underline">be the first to suggest one.</Link>
          </p>
        ) : (
          <ul className="mt-8 space-y-3">
            {active.map((idea) => (
              <IdeaRow key={idea.id} idea={idea} voted={votedIds.has(idea.id)} isAuthed={!!user} />
            ))}
          </ul>
        )}

        {shipped.length > 0 && (
          <>
            <h2 className="mt-12 font-heading text-2xl lowercase text-shell-ink">recently shipped</h2>
            <ul className="mt-5 space-y-3">
              {shipped.map((idea) => (
                <IdeaRow key={idea.id} idea={idea} voted={votedIds.has(idea.id)} isAuthed={!!user} />
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function IdeaRow({ idea, voted, isAuthed }: { idea: Idea; voted: boolean; isAuthed: boolean }) {
  const badge = STATUS_BADGE[idea.status];
  const title = idea.public_title || idea.subject || 'untitled idea';
  return (
    <li className="flex items-center gap-3 rounded-3xl border border-shell-ink/10 bg-white/60 p-3">
      <IdeaVoteButton id={idea.id} initialCount={idea.vote_count} initialVoted={voted} isAuthed={isAuthed} />
      <div className="min-w-0 flex-1">
        <p className="font-body text-[15px] font-semibold lowercase leading-snug text-shell-ink">{title}</p>
        {badge && (
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 font-body text-[11px] font-semibold lowercase ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
    </li>
  );
}

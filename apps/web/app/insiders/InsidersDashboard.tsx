'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  MapPin,
  Star,
  Camera,
  Pencil,
  Megaphone,
  Trophy,
  ChevronDown,
} from 'lucide-react';
import type { InsiderTask, LeaderboardEntry } from './page';
import { HeartLoader } from '@/components/HeartLoader';
import { LocalTime } from '@/components/LocalTime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TASK_ICONS: Record<string, typeof MapPin> = {
  visit_venue: MapPin,
  rate_date: Star,
  take_photo: Camera,
  improve_copy: Pencil,
  business_outreach: Megaphone,
};

const TASK_LABELS: Record<string, string> = {
  visit_venue: 'visit venue',
  rate_date: 'rate date',
  take_photo: 'take photo',
  improve_copy: 'improve copy',
  business_outreach: 'business outreach',
};

function roleBadge(role: string | null) {
  const colors: Record<string, string> = {
    scout: 'bg-blue-100 text-blue-900 ring-blue-200',
    tester: 'bg-amber-100 text-amber-950 ring-amber-200',
    curator: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
    ambassador: 'bg-violet-100 text-violet-900 ring-violet-200',
  };
  const tone = colors[role ?? ''] ?? 'bg-shell-pink text-shell-ink ring-shell-accent/20';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold lowercase tracking-[0.12em] ring-1 ${tone}`}
    >
      {role ?? 'insider'}
    </span>
  );
}

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    assigned: 'bg-blue-50 text-blue-800',
    submitted: 'bg-amber-50 text-amber-800',
    approved: 'bg-emerald-50 text-emerald-800',
    rejected: 'bg-rose-50 text-rose-800',
    open: 'bg-shell-pink/60 text-shell-ink',
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-body text-[10px] font-semibold lowercase tracking-[0.12em] ${
        colors[status] ?? colors.open
      }`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  profile: {
    firstName: string | null;
    role: string | null;
    points: number;
  };
  tasks: InsiderTask[];
  leaderboard: LeaderboardEntry[];
}

export function InsidersDashboard({ profile, tasks, leaderboard }: Props) {
  const activeTasks = tasks.filter((t) => ['assigned', 'open'].includes(t.status));
  const submittedTasks = tasks.filter((t) => t.status === 'submitted');
  const completedTasks = tasks.filter((t) =>
    ['approved', 'rejected'].includes(t.status),
  );

  return (
    <main className="min-h-dvh bg-shell-base">
      {/* header */}
      <header className="border-b border-shell-ink/10 bg-shell-base/90 backdrop-blur-md">
        <nav className="mx-auto flex w-full max-w-[480px] items-center justify-between px-6 py-4">
          <Link href="/" className="font-heading text-xl lowercase tracking-tight text-shell-accent">
            after5
          </Link>
          <Link
            href="/home"
            className="rounded-full border-2 border-shell-ink/15 px-4 py-1.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-ink/30 active:scale-95"
          >
            your profile
          </Link>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[480px] px-6 py-10">
        {/* greeting */}
        <div className="mb-9 flex flex-wrap items-center gap-4">
          <div>
            <h1 className="font-heading text-3xl lowercase text-shell-ink">
              hey{profile.firstName ? ` ${profile.firstName.toLowerCase()}` : ''}
            </h1>
            <p className="mt-1 font-body text-sm text-shell-ink/65">
              your insider dashboard
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {roleBadge(profile.role)}
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 font-body text-sm font-semibold text-shell-ink ring-1 ring-shell-ink/10">
              <Trophy className="h-3.5 w-3.5 text-shell-accent" />
              {profile.points} pts
            </span>
          </div>
        </div>

        {/* your tasks */}
        <section className="mb-11">
          <h2 className="mb-5 font-heading text-xl lowercase text-shell-ink">
            your tasks
          </h2>

          {activeTasks.length === 0 && submittedTasks.length === 0 && (
            <div className="rounded-3xl border-2 border-shell-ink/10 bg-white p-8 text-center font-body text-sm text-shell-ink/65">
              nothing assigned yet. check back soon — we drop new tasks often.
            </div>
          )}

          <div className="space-y-3">
            {[...activeTasks, ...submittedTasks].map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>

        {/* leaderboard */}
        <section className="mb-11">
          <h2 className="mb-5 font-heading text-xl lowercase text-shell-ink">
            leaderboard
          </h2>
          {leaderboard.length === 0 ? (
            <div className="rounded-3xl border-2 border-shell-ink/10 bg-white p-8 text-center font-body text-sm text-shell-ink/65">
              be the first to rack up points.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-3xl border-2 border-shell-ink/10">
              <table className="w-full font-body text-sm">
                <thead>
                  <tr className="border-b border-shell-ink/10 bg-shell-pink/40 text-left font-body text-[11px] font-semibold lowercase tracking-[0.12em] text-shell-ink/60">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">insider</th>
                    <th className="px-4 py-3">role</th>
                    <th className="px-4 py-3 text-right">tasks</th>
                    <th className="px-4 py-3 text-right">points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-shell-ink/10">
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.id} className="bg-white">
                      <td className="px-4 py-3 text-shell-ink/50 [font-variant-numeric:tabular-nums]">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3 font-medium lowercase text-shell-ink">
                        {(entry.first_name ?? 'anonymous').toLowerCase()}
                      </td>
                      <td className="px-4 py-3">{roleBadge(entry.insider_role)}</td>
                      <td className="px-4 py-3 text-right text-shell-ink/65 [font-variant-numeric:tabular-nums]">
                        {entry.tasks_completed}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-shell-ink [font-variant-numeric:tabular-nums]">
                        {entry.insider_points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* completed contributions */}
        {completedTasks.length > 0 && (
          <section>
            <h2 className="mb-5 font-heading text-xl lowercase text-shell-ink">
              your contributions
            </h2>
            <div className="space-y-2">
              {completedTasks.map((task) => {
                const Icon = TASK_ICONS[task.task_type] ?? Star;
                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-2xl border-2 border-shell-ink/10 bg-white/70 px-4 py-3"
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-shell-accent" />
                    <span className="flex-1 font-body text-sm lowercase text-shell-ink">{task.title}</span>
                    {statusBadge(task.status)}
                    <span className="font-body text-xs text-shell-ink/50 [font-variant-numeric:tabular-nums]">
                      +{task.points_reward} pts
                    </span>
                    {task.completed_at && (
                      <LocalTime
                        iso={task.completed_at}
                        opts={{ dateStyle: 'medium' }}
                        className="font-body text-xs text-shell-ink/50"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* footer */}
      <footer className="mx-auto w-full max-w-[480px] px-6 pb-16 pt-2">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 font-body text-xs lowercase text-shell-ink/45">
          <Link href="/about" className="hover:text-shell-ink">about</Link>
          <Link href="/privacy" className="hover:text-shell-ink">privacy</Link>
          <Link href="/terms" className="hover:text-shell-ink">terms</Link>
          <a href="mailto:hello@tryafter5.app" className="hover:text-shell-ink">hello@tryafter5.app</a>
        </div>
      </footer>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Task card with submission form
// ---------------------------------------------------------------------------

function TaskCard({ task }: { task: InsiderTask }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(task.status === 'submitted');

  const Icon = TASK_ICONS[task.task_type] ?? Star;
  const label = TASK_LABELS[task.task_type] ?? task.task_type;

  async function handleSubmit() {
    setSubmitting(true);
    try {
      // POST submission to the task
      await fetch('/api/insiders/submit-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: task.id, notes }),
      });
      setSubmitted(true);
      setExpanded(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-3xl border-2 border-shell-ink/10 bg-white p-5 shadow-fun">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-shell-pink text-shell-accent">
          <Icon className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-body text-[10px] font-semibold lowercase tracking-[0.12em] text-shell-ink/50">
              {label}
            </span>
            {statusBadge(submitted ? 'submitted' : task.status)}
            <span className="ml-auto font-body text-xs font-semibold text-shell-accent">
              +{task.points_reward} pts
            </span>
          </div>
          <h3 className="mt-1 font-heading text-base lowercase text-shell-ink">
            {task.title}
          </h3>
          {task.description && (
            <p className="mt-1 font-body text-sm leading-relaxed text-shell-ink/65">
              {task.description}
            </p>
          )}
          {task.venue_name && (
            <p className="mt-2 inline-flex items-center gap-1 font-body text-xs text-shell-accent">
              <MapPin className="h-3 w-3" />
              {task.venue_name}
            </p>
          )}
        </div>
      </div>

      {/* mark complete / submission */}
      {!submitted && task.status === 'assigned' && (
        <div className="mt-4 border-t border-shell-ink/10 pt-3">
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1.5 font-body text-sm font-medium lowercase text-shell-accent transition-colors hover:text-shell-ink"
            >
              <CheckCircle2 className="h-4 w-4" />
              mark complete
              <ChevronDown className="h-3 w-3" />
            </button>
          ) : (
            <div className="space-y-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="notes on what you did..."
                className="w-full rounded-2xl border-2 border-shell-ink/15 bg-white px-3 py-2 font-body text-sm text-shell-ink placeholder:text-shell-ink/40 focus:border-shell-accent focus:outline-none focus:ring-4 focus:ring-shell-accent/20"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-full bg-shell-accent px-4 py-1.5 font-body text-sm font-semibold lowercase text-white transition hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                >
                  {submitting ? (
                    <HeartLoader size={14} color="currentColor" accessibilityLabel="submitting" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  submit
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="rounded-full border-2 border-shell-ink/15 px-4 py-1.5 font-body text-sm font-semibold lowercase text-shell-ink transition hover:border-shell-ink/30 active:scale-95"
                >
                  cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {submitted && (
        <p className="mt-3 font-body text-xs lowercase text-emerald-700">
          submitted — pending review
        </p>
      )}
    </div>
  );
}

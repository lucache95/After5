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
  Loader2,
  ChevronDown,
} from 'lucide-react';
import type { InsiderTask, LeaderboardEntry } from './page';
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
  visit_venue: 'Visit venue',
  rate_date: 'Rate date',
  take_photo: 'Take photo',
  improve_copy: 'Improve copy',
  business_outreach: 'Business outreach',
};

function roleBadge(role: string | null) {
  const colors: Record<string, string> = {
    scout: 'bg-blue-100 text-blue-900 ring-blue-200',
    tester: 'bg-amber-100 text-amber-950 ring-amber-200',
    curator: 'bg-emerald-100 text-emerald-900 ring-emerald-200',
    ambassador: 'bg-violet-100 text-violet-900 ring-violet-200',
  };
  const tone = colors[role ?? ''] ?? 'bg-gray-100 text-gray-900 ring-gray-200';
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${tone}`}
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
    open: 'bg-gray-50 text-gray-800',
  };
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
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
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/90 backdrop-blur-md">
        <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-3 md:px-10">
          <Link
            href="/"
            className="font-display text-base font-semibold tracking-tight text-text"
          >
            After5
          </Link>
          <Link
            href="/account"
            className="rounded-pill border border-border px-3 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface hover:text-text"
          >
            Dashboard
          </Link>
        </nav>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-12 md:px-10 md:py-16">
        {/* Greeting */}
        <div className="mb-10 flex flex-wrap items-center gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-text md:text-4xl">
              Hey{profile.firstName ? ` ${profile.firstName}` : ''}
            </h1>
            <p className="mt-1 text-sm text-secondary">
              Your Insider dashboard
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {roleBadge(profile.role)}
            <span className="inline-flex items-center gap-1 rounded-pill bg-surface px-3 py-1.5 text-sm font-semibold text-text ring-1 ring-border">
              <Trophy className="h-3.5 w-3.5 text-accent" />
              {profile.points} pts
            </span>
          </div>
        </div>

        {/* Your Tasks */}
        <section className="mb-12">
          <h2 className="mb-5 font-display text-xl font-bold tracking-[-0.02em] text-text">
            Your tasks
          </h2>

          {activeTasks.length === 0 && submittedTasks.length === 0 && (
            <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-secondary">
              No tasks assigned yet. Check back soon -- we add new tasks regularly.
            </div>
          )}

          <div className="space-y-3">
            {[...activeTasks, ...submittedTasks].map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>

        {/* Leaderboard */}
        <section className="mb-12">
          <h2 className="mb-5 font-display text-xl font-bold tracking-[-0.02em] text-text">
            Leaderboard
          </h2>
          {leaderboard.length === 0 ? (
            <div className="rounded-card border border-border bg-surface p-8 text-center text-sm text-secondary">
              Be the first to earn points!
            </div>
          ) : (
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Insider</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3 text-right">Tasks</th>
                    <th className="px-4 py-3 text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leaderboard.map((entry, i) => (
                    <tr key={entry.id} className="bg-background">
                      <td className="px-4 py-3 text-muted [font-variant-numeric:tabular-nums]">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-text">
                        {entry.first_name ?? 'Anonymous'}
                      </td>
                      <td className="px-4 py-3">{roleBadge(entry.insider_role)}</td>
                      <td className="px-4 py-3 text-right text-secondary [font-variant-numeric:tabular-nums]">
                        {entry.tasks_completed}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-text [font-variant-numeric:tabular-nums]">
                        {entry.insider_points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Completed Contributions */}
        {completedTasks.length > 0 && (
          <section>
            <h2 className="mb-5 font-display text-xl font-bold tracking-[-0.02em] text-text">
              Your contributions
            </h2>
            <div className="space-y-2">
              {completedTasks.map((task) => {
                const Icon = TASK_ICONS[task.task_type] ?? Star;
                return (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 rounded-card border border-border bg-surface/50 px-4 py-3"
                  >
                    <Icon className="h-4 w-4 flex-shrink-0 text-accent" />
                    <span className="flex-1 text-sm text-text">{task.title}</span>
                    {statusBadge(task.status)}
                    <span className="text-xs text-muted [font-variant-numeric:tabular-nums]">
                      +{task.points_reward} pts
                    </span>
                    {task.completed_at && (
                      <LocalTime
                        iso={task.completed_at}
                        opts={{ dateStyle: 'medium' }}
                        className="text-xs text-muted"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-8 text-center text-xs text-muted">
        <Link
          href="/"
          className="underline decoration-border hover:text-text hover:decoration-text"
        >
          tryafter5.app
        </Link>
        {' '}
        &middot; Curated date plans for Kelowna couples
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
    <div className="rounded-card border border-border bg-background p-5 shadow-[0_4px_12px_-6px_rgba(0,0,0,0.08)]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              {label}
            </span>
            {statusBadge(submitted ? 'submitted' : task.status)}
            <span className="ml-auto text-xs font-semibold text-accent">
              +{task.points_reward} pts
            </span>
          </div>
          <h3 className="mt-1 font-display text-base font-semibold text-text">
            {task.title}
          </h3>
          {task.description && (
            <p className="mt-1 text-sm leading-relaxed text-secondary">
              {task.description}
            </p>
          )}
          {task.venue_name && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-accent">
              <MapPin className="h-3 w-3" />
              {task.venue_name}
            </p>
          )}
        </div>
      </div>

      {/* Mark Complete / Submission */}
      {!submitted && task.status === 'assigned' && (
        <div className="mt-4 border-t border-border pt-3">
          {!expanded ? (
            <button
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent transition-colors hover:text-text"
            >
              <CheckCircle2 className="h-4 w-4" />
              Mark complete
              <ChevronDown className="h-3 w-3" />
            </button>
          ) : (
            <div className="space-y-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Add any notes about what you did..."
                className="w-full rounded-card border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-accent px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  Submit
                </button>
                <button
                  onClick={() => setExpanded(false)}
                  className="rounded-pill border border-border px-4 py-1.5 text-sm font-medium text-secondary transition-colors hover:bg-surface hover:text-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {submitted && (
        <p className="mt-3 text-xs text-emerald-700">
          Submitted -- pending review
        </p>
      )}
    </div>
  );
}

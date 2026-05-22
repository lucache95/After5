// /insiders — auth-gated Insider contributor dashboard.
// Redirects to /login if not authenticated, to /join if not an approved insider.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { InsidersDashboard } from './InsidersDashboard';

export const dynamic = 'force-dynamic';

export interface InsiderTask {
  id: string;
  created_at: string;
  task_type: string;
  title: string;
  description: string | null;
  venue_id: string | null;
  venue_name: string | null;
  points_reward: number;
  status: string;
  submitted_at: string | null;
  submission_notes: string | null;
  completed_at: string | null;
}

export interface LeaderboardEntry {
  id: string;
  first_name: string | null;
  insider_role: string | null;
  insider_points: number;
  tasks_completed: number;
}

export default async function InsidersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?next=/insiders');
  }

  const admin = createAdminClient();

  // Fetch the user's profile
  const { data: profile } = await admin
    .from('profiles')
    .select('id, first_name, insider_role, insider_points, insider_approved_at')
    .eq('id', user.id)
    .single();

  if (!profile?.insider_role) {
    redirect('/join');
  }

  // Fetch tasks assigned to this insider
  const { data: rawTasks } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string, opts: { ascending: boolean }) => Promise<{
            data: Array<{
              id: string;
              created_at: string;
              task_type: string;
              title: string;
              description: string | null;
              venue_id: string | null;
              points_reward: number;
              status: string;
              submitted_at: string | null;
              submission_notes: string | null;
              completed_at: string | null;
            }> | null;
          }>;
        };
      };
    };
  })
    .from('insider_tasks')
    .select(
      'id, created_at, task_type, title, description, venue_id, points_reward, status, submitted_at, submission_notes, completed_at',
    )
    .eq('assigned_to', user.id)
    .order('created_at', { ascending: false });

  // Enrich tasks with venue names
  const tasks: InsiderTask[] = [];
  const venueIds = new Set(
    (rawTasks ?? []).filter((t) => t.venue_id).map((t) => t.venue_id!),
  );
  let venueNames: Record<string, string> = {};
  if (venueIds.size > 0) {
    const { data: venues } = await admin
      .from('places')
      .select('id, name')
      .in('id', [...venueIds]);
    venueNames = Object.fromEntries(
      (venues ?? []).map((v) => [v.id, v.name]),
    );
  }
  for (const t of rawTasks ?? []) {
    tasks.push({
      ...t,
      venue_name: t.venue_id ? venueNames[t.venue_id] ?? null : null,
    });
  }

  // Leaderboard: top 10 insiders by points
  const { data: topInsiders } = await admin
    .from('profiles')
    .select('id, first_name, insider_role, insider_points')
    .not('insider_role', 'is', null)
    .order('insider_points', { ascending: false })
    .limit(10);

  // Count completed tasks per leaderboard insider
  const leaderboard: LeaderboardEntry[] = [];
  for (const ins of topInsiders ?? []) {
    const { count } = await (admin as unknown as {
      from: (t: string) => {
        select: (cols: string, opts: { count: string; head: boolean }) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => Promise<{
              count: number | null;
            }>;
          };
        };
      };
    })
      .from('insider_tasks')
      .select('*', { count: 'exact', head: true })
      .eq('assigned_to', ins.id)
      .eq('status', 'approved');

    leaderboard.push({
      ...ins,
      tasks_completed: count ?? 0,
    });
  }

  return (
    <InsidersDashboard
      profile={{
        firstName: profile.first_name,
        role: profile.insider_role,
        points: profile.insider_points,
      }}
      tasks={tasks}
      leaderboard={leaderboard}
    />
  );
}

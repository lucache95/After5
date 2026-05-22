// POST /api/insiders/submit-task — insider marks a task as completed.
// Validates ownership, updates task status, and awards points to the profile.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  // Authenticate the user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Verify the user has an insider role
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, insider_role, insider_points')
    .eq('id', user.id)
    .single();

  if (!profile?.insider_role) {
    return NextResponse.json({ error: 'not_an_insider' }, { status: 403 });
  }

  // Parse request body
  let body: { task_id?: string; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const taskId = body.task_id;
  if (typeof taskId !== 'string' || !taskId) {
    return NextResponse.json({ error: 'missing_task_id' }, { status: 400 });
  }

  // Fetch the task and validate ownership
  const { data: task } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          single: () => Promise<{
            data: {
              id: string;
              assigned_to: string;
              status: string;
              points_reward: number;
            } | null;
          }>;
        };
      };
    };
  })
    .from('insider_tasks')
    .select('id, assigned_to, status, points_reward')
    .eq('id', taskId)
    .single();

  if (!task) {
    return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  }

  if (task.assigned_to !== user.id) {
    return NextResponse.json({ error: 'not_your_task' }, { status: 403 });
  }

  if (task.status !== 'assigned' && task.status !== 'open') {
    return NextResponse.json({ error: 'task_not_submittable' }, { status: 409 });
  }

  const now = new Date().toISOString();

  // Update the task: status → submitted
  const { error: updateError } = await (admin as unknown as {
    from: (t: string) => {
      update: (row: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  })
    .from('insider_tasks')
    .update({
      status: 'submitted',
      submitted_at: now,
      submission_notes: body.notes || null,
    })
    .eq('id', taskId);

  if (updateError) {
    console.error('[submit-task] update failed', updateError);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  // Award points to the profile
  const newPoints = (profile.insider_points ?? 0) + task.points_reward;
  await admin
    .from('profiles')
    .update({ insider_points: newPoints })
    .eq('id', user.id);

  return NextResponse.json({
    ok: true,
    task: {
      id: task.id,
      status: 'submitted',
      submitted_at: now,
      points_awarded: task.points_reward,
    },
  });
}

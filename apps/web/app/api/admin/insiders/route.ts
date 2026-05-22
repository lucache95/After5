// PATCH /api/admin/insiders — approve or reject an Insider application.
// On approve: updates application status, sets insider_role + insider_approved_at
// on the matching profile, and sends the welcome email.

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendInsiderWelcomeEmail } from '@/lib/email/insider-welcome';

const VALID_ROLES = new Set(['scout', 'tester', 'curator', 'ambassador']);

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin('/admin/insiders');
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const applicationId = body.application_id;
  const action = body.action;
  const role = body.role as string | undefined;

  if (typeof applicationId !== 'string' || !applicationId) {
    return NextResponse.json({ error: 'missing_application_id' }, { status: 400 });
  }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch the application
  const { data: appData } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          single: () => Promise<{
            data: { id: string; email: string; first_name: string; status: string } | null;
          }>;
        };
      };
    };
  })
    .from('insider_applications')
    .select('id, email, first_name, status')
    .eq('id', applicationId)
    .single();

  if (!appData) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (appData.status !== 'pending') {
    return NextResponse.json({ error: 'already_reviewed' }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (action === 'reject') {
    // Update application status
    await (admin as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    })
      .from('insider_applications')
      .update({ status: 'rejected', reviewed_at: now })
      .eq('id', applicationId);

    return NextResponse.json({ ok: true, action: 'rejected' });
  }

  // Approve flow
  const assignedRole = role && VALID_ROLES.has(role) ? role : 'scout';

  // Update application
  await (admin as unknown as {
    from: (t: string) => {
      update: (row: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{ error: unknown }>;
      };
    };
  })
    .from('insider_applications')
    .update({ status: 'approved', reviewed_at: now })
    .eq('id', applicationId);

  // Find the profile by email and set insider fields
  const { data: profiles } = await admin
    .from('profiles')
    .select('id')
    .eq('email', appData.email)
    .limit(1);

  if (profiles && profiles.length > 0) {
    await admin
      .from('profiles')
      .update({
        insider_role: assignedRole,
        insider_approved_at: now,
      })
      .eq('id', profiles[0].id);
  }

  // Send welcome email (best-effort, don't block on failure)
  try {
    await sendInsiderWelcomeEmail({
      to: appData.email,
      firstName: appData.first_name,
      role: assignedRole,
    });
  } catch (err) {
    console.error('[admin/insiders] welcome email failed', err);
  }

  return NextResponse.json({ ok: true, action: 'approved', role: assignedRole });
}

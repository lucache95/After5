import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { buildPlanEmail } from '@/lib/email/plan-pdf';
import { normalizeSubscribeInput, upsertSubscriber } from '@/lib/create/subscribe';
import type { Itinerary } from '../../../../../supabase/functions/generate-plan/types';

// Email the FULL plan as a PDF (locked decision #3 — the full plan is the carrot).
// Server-renders the existing PlanPDFDocument to a buffer and attaches it to a
// Resend email, then captures the email via the shared upsertSubscriber helper.
export async function POST(req: Request) {
  let body: { email?: string; first_name?: string | null; city?: string | null; itinerary?: Itinerary; itinerary_id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const n = normalizeSubscribeInput({ email: body.email, first_name: body.first_name, city: body.city, source: 'create_pdf' });
  if (!n.valid) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  if (!body.itinerary?.title) return NextResponse.json({ error: 'itinerary_required' }, { status: 400 });

  // Server-render the existing PDF document to a buffer.
  const [{ renderToBuffer }, { PlanPDFDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('@/components/itinerary/PlanPDFDocument'),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdf = await renderToBuffer(PlanPDFDocument({ itinerary: body.itinerary }) as any);

  const { subject, html, text } = buildPlanEmail({ firstName: n.first_name, itineraryTitle: body.itinerary.title });
  await sendEmail({
    to: n.email, subject, html, text, tag: 'create_pdf',
    attachments: [{ filename: 'after5-date-plan.pdf', content: pdf }],
  });

  const admin = createAdminClient();
  await upsertSubscriber(admin, n, {
    userAgent: req.headers.get('user-agent'),
    itineraryIds: body.itinerary_id ? [body.itinerary_id] : [],
  });
  return NextResponse.json({ ok: true });
}

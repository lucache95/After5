// supabase/functions/process-jobs/index.ts
// The scheduler runner (INTEGRATION-CONTRACT C1). Invoked every minute by
// /api/cron/process-jobs. Claims due jobs, dispatches by job.type, completes/fails.
// Service-role. Auth: header `x-jobs-secret: ${JOBS_RUNNER_SECRET}`. verify_jwt=false
// (config.toml) because this is service-to-service.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';
import { HANDLERS, type Job } from './handlers.ts';

const CLAIM_LIMIT = 50;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const expected = Deno.env.get('JOBS_RUNNER_SECRET');
  if (!expected || req.headers.get('x-jobs-secret') !== expected) return json({ error: 'unauthorized' }, 401);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  await supabase.rpc('requeue_stuck_jobs', {});
  const { data: claimed, error: claimErr } = await supabase.rpc('claim_due_jobs', { p_limit: CLAIM_LIMIT });
  if (claimErr) return json({ error: 'claim_failed', details: claimErr.message }, 500);
  const jobs = (claimed ?? []) as Job[];

  let done = 0, failed = 0;
  for (const job of jobs) {
    const handler = HANDLERS[job.type];
    try {
      if (!handler) throw new Error(`no handler for ${job.type}`);
      await handler(supabase, job);
      await supabase.rpc('complete_job', { p_id: job.id });
      done++;
    } catch (e) {
      // Isolate one job's recovery from the rest of the tick: if fail_job /
      // raise_admin_alert themselves throw (DB blip), don't abort the loop and
      // strand sibling jobs in 'running' for a full requeue grace window.
      try {
        await supabase.rpc('fail_job', { p_id: job.id, p_error: String(e) });
        // Safety jobs never fail silently — surface the failure to ops (C11.8).
        if (job.type === 'safety_checkin') {
          await supabase.rpc('raise_admin_alert', {
            p_kind: 'safety_job_failed', p_payload: { job_id: job.id, error: String(e) },
          });
        }
      } catch (_recoveryErr) {
        // Swallowed: requeue_stuck_jobs reclaims this job on a later tick.
      }
      failed++;
    }
  }
  return json({ claimed: jobs.length, done, failed });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } });
}

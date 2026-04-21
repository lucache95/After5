// Admin debug view of a single itinerary's generation_log audit trail.
// Not linked from anywhere — visit /admin/dates/<itinerary_id> directly.
// No auth (yet); URL is the secret. Add Vercel password protection if you
// want to gate this in prod.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

interface ItineraryAuditRow {
  id: string;
  slug: string | null;
  title: string | null;
  hook: string | null;
  template_id: string | null;
  total_cost_pp: number | null;
  total_duration_min: number | null;
  inputs: unknown;
  generation_log: unknown;
  generated_at: string;
  is_public: boolean;
  modifier_id: string | null;
  season: string | null;
  when_planned: string | null;
  planned_for_date: string | null;
  intent: string | null;
  built_by_name: string | null;
  built_by_neighborhood: string | null;
}

export const dynamic = 'force-dynamic';

export default async function AdminDateAuditPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select(
      'id, slug, title, hook, template_id, total_cost_pp, total_duration_min, inputs, generation_log, generated_at, is_public, modifier_id, season, when_planned, planned_for_date, intent, built_by_name, built_by_neighborhood',
    )
    .eq('id', id)
    .maybeSingle();

  if (!data) notFound();
  const row = data as unknown as ItineraryAuditRow;

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-content px-6 py-12 md:px-10 md:py-16">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          Admin · audit
        </p>
        <h1 className="font-display text-3xl font-bold leading-tight tracking-[-0.02em] text-text md:text-4xl">
          {row.title ?? '(untitled)'}
        </h1>
        {row.hook && <p className="mt-2 text-base text-secondary">{row.hook}</p>}

        <div className="mt-8 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Stat label="ID" value={row.id} mono />
          <Stat label="Slug" value={row.slug ?? '—'} mono />
          {row.slug && (
            <Stat
              label="Public URL"
              value={
                <Link
                  href={`/dates/${row.slug}`}
                  target="_blank"
                  className="text-text underline decoration-border decoration-1 underline-offset-[5px] hover:decoration-text"
                >
                  /dates/{row.slug}
                </Link>
              }
            />
          )}
          <Stat label="Template" value={row.template_id ?? '—'} mono />
          <Stat label="Modifier" value={row.modifier_id ?? '—'} mono />
          <Stat label="Generated" value={new Date(row.generated_at).toLocaleString()} />
          <Stat label="Season" value={row.season ?? '—'} />
          <Stat label="When planned" value={row.when_planned ?? '—'} />
          <Stat label="Planned for" value={row.planned_for_date ?? '—'} />
          <Stat label="Intent" value={row.intent ?? '—'} />
          <Stat label="Built by" value={row.built_by_name ?? '—'} />
          <Stat label="Neighborhood" value={row.built_by_neighborhood ?? '—'} />
          <Stat label="Public" value={row.is_public ? 'yes' : 'no'} />
          <Stat label="Total cost / pp" value={`$${Math.round(row.total_cost_pp ?? 0)}`} />
          <Stat label="Total duration" value={`${row.total_duration_min ?? 0} min`} />
        </div>

        <Section title="User inputs">
          <Pre value={row.inputs} />
        </Section>

        <Section title="Generation log">
          <Pre value={row.generation_log} />
        </Section>
      </div>
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={`mt-1 text-sm text-text ${mono ? 'font-mono break-all text-xs' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-12">
      <h2 className="mb-4 font-display text-xl font-semibold leading-tight text-text">{title}</h2>
      {children}
    </div>
  );
}

function Pre({ value }: { value: unknown }) {
  return (
    <pre className="overflow-auto rounded-card border border-border bg-surface p-5 font-mono text-xs leading-relaxed text-text">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

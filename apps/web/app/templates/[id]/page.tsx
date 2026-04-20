import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { AggregatorView, type DateCardData } from '@/components/AggregatorView';

export const revalidate = 3600;
const SITE = 'https://after5.app';

interface TemplateRow {
  id: string;
  name: string;
  duration_min: number;
  vibe: string[];
  slots: Array<{ types: string[] }>;
}

async function loadTemplate(id: string): Promise<TemplateRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('templates')
    .select('id, name, duration_min, vibe, slots')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  return (data ?? null) as TemplateRow | null;
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const t = await loadTemplate(id);
  if (!t) return {};
  const slotSummary = t.slots.map((s) => s.types[0]).join(' → ');
  return {
    title: `${t.name} — a Kelowna date template | After5`,
    description: `${t.name}: ${slotSummary}. ${Math.round(t.duration_min / 60 * 10) / 10} hr. See real plans built from this shape.`,
    alternates: { canonical: `${SITE}/templates/${t.id}` },
  };
}

export default async function TemplatePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const t = await loadTemplate(id);
  if (!t) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
    .eq('is_public', true)
    .eq('template_id', t.id)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(9);

  const dates = (data ?? []) as DateCardData[];
  const slotSummary = t.slots.map((s) => s.types[0].replace(/_/g, ' ')).join(' → ');
  const durHr = Math.round((t.duration_min / 60) * 10) / 10;

  return (
    <AggregatorView
      eyebrow={`Template · ${durHr} hr`}
      title={t.name}
      blurb={`The shape: ${slotSummary}. Built for ${t.vibe.join(', ')} vibes. Below are real dates assembled from this template.`}
      ctaHref="/plan"
      ctaLabel="Plan a date"
      datesHeading="Dates from this template"
      dates={dates}
    />
  );
}

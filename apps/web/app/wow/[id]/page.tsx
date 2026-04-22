import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { AggregatorView, type DateCardData } from '@/components/AggregatorView';

export const revalidate = 3600;
const SITE = 'https://tryafter5.app';

interface ModifierRow {
  id: string;
  label: string;
  body: string;
  difficulty: 'tame' | 'spicy' | 'chaos';
}

async function loadModifier(id: string): Promise<ModifierRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('modifiers')
    .select('id, label, body, difficulty')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle();
  return (data ?? null) as ModifierRow | null;
}

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await props.params;
  const m = await loadModifier(id);
  if (!m) return {};
  return {
    title: `${m.label} — a date Wow-Factor | After5`,
    description: m.body.slice(0, 160),
    alternates: { canonical: `${SITE}/wow/${m.id}` },
  };
}

export default async function ModifierPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const m = await loadModifier(id);
  if (!m) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from('itineraries')
    .select('id, slug, title, hook, total_cost_pp, total_duration_min, stops')
    .eq('is_public', true)
    .eq('modifier_id', m.id)
    .not('slug', 'is', null)
    .order('generated_at', { ascending: false })
    .limit(9);

  const dates = (data ?? []) as DateCardData[];
  const difficultyLabel =
    m.difficulty === 'tame' ? 'Easy mode' : m.difficulty === 'spicy' ? 'Spicy' : 'Full chaos';

  return (
    <AggregatorView
      eyebrow={`Wow-Factor · ${difficultyLabel}`}
      title={m.label}
      blurb={m.body}
      ctaHref="/plan"
      ctaLabel="Plan a date with this twist"
      datesHeading={`Dates that use "${m.label}"`}
      dates={dates}
      emptyNote={`No dates with this Wow-Factor yet — generate one and it might land here.`}
    />
  );
}
